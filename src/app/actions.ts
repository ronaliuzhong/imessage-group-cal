"use server";

// Server Actions: functions the browser can trigger (usually from a <form>),
// but which run on the server. Next.js exposes each one as an endpoint that
// anyone could call directly, so every action checks who's signed in itself
// rather than trusting the page it came from.

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { removeUserFromPlan, syncPlanForEveryone, syncPlanForUser } from "@/lib/calendar-sync";
import { normalizeColor } from "@/lib/colors";
import { prisma } from "@/lib/db";
import { createGroupFor, joinGroupFor } from "@/lib/groups";
import { createPlanFor, parseOccurrence, setRsvpFor } from "@/lib/plan-writes";
import {
  dropStaleDates,
  editablePlan,
  endPlanBefore,
  updatePlanFor,
  type EditablePlan,
  type EditScope,
} from "@/lib/plan-edits";
import type { PlanInput } from "@/lib/plan-input";
import { requireUser } from "@/lib/session";

export async function signInWithGoogle(redirectTo: string) {
  await signIn("google", { redirectTo });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export async function createGroup(formData: FormData) {
  const user = await requireUser();
  const group = await createGroupFor(
    user.id,
    String(formData.get("name") ?? ""),
    String(formData.get("color") ?? ""),
  );
  if (!group) return;
  redirect(`/groups/${group.id}`);
}

export async function joinGroup(inviteCode: string) {
  const user = await requireUser();
  const group = await joinGroupFor(user.id, inviteCode);
  if (!group) notFound();
  redirect(`/groups/${group.id}`);
}

// Plans in a group that still have something coming up (or never end).
const upcomingIn = (groupId: string) => ({
  groupId,
  OR: [{ seriesEnd: null }, { seriesEnd: { gt: new Date() } }],
});

export async function leaveGroup(groupId: string) {
  const user = await requireUser();
  // Leaving means you're out of this group's upcoming plans too: take them off
  // your calendar and drop your answers. (Past plans are left alone.)
  const plans = await prisma.plan.findMany({ where: upcomingIn(groupId), select: { id: true } });
  for (const plan of plans) await removeUserFromPlan(plan.id, user.id);

  // deleteMany (rather than delete) doesn't error if they already left,
  // e.g. from another tab.
  await prisma.groupMember.deleteMany({ where: { groupId, userId: user.id } });
  // Last one out deletes the group. These two steps deliberately aren't
  // wrapped in a transaction: each commits on its own, so if the last two
  // members leave at the same moment, whichever runs second sees nobody left.
  await prisma.group.deleteMany({ where: { id: groupId, members: { none: {} } } });
  redirect("/");
}

// Sets the color *you* see a group in (a preset or a custom "#rrggbb"), and
// recolors that group's plans on your Google Calendar. Nobody else's changes.
export async function setMyGroupColor(groupId: string, value: string) {
  const user = await requireUser();
  const updated = await prisma.groupMember.updateMany({
    where: { groupId, userId: user.id },
    data: { color: normalizeColor(value) }, // anything unrecognized becomes the default
  });
  if (updated.count === 0) return; // not a member

  const plans = await prisma.plan.findMany({ where: upcomingIn(groupId), select: { id: true } });
  await Promise.all(plans.map((plan) => syncPlanForUser(plan.id, user.id)));
  revalidatePath("/", "layout");
}

export async function setCalendarIncluded(calendarId: string, included: boolean) {
  const user = await requireUser();
  if (typeof calendarId !== "string" || calendarId.length > 1024 || typeof included !== "boolean") {
    throw new Error("Invalid calendar setting");
  }
  // Only calendars that appear in the user's own Google calendar list are ever
  // queried, so saving a preference for some other ID would have no effect.
  await prisma.calendarPreference.upsert({
    where: { userId_calendarId: { userId: user.id, calendarId } },
    create: { userId: user.id, calendarId, included },
    update: { included },
  });
  // Re-render every page so calendars (home and groups) reflect the change.
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Plans
//
// Problems are returned (not thrown) from actions the forms call directly:
// in production Next.js hides thrown error messages from the browser, so a
// thrown "Give the plan a name" would never be seen.
// ---------------------------------------------------------------------------

export type { EditScope } from "@/lib/plan-edits";

export async function createPlan(
  groupId: string,
  input: PlanInput,
): Promise<{ shareCode: string } | { error: string }> {
  const user = await requireUser();
  const result = await createPlanFor(user.id, groupId, input);
  if ("error" in result) return { error: result.error };
  revalidatePath(`/groups/${groupId}`);
  return { shareCode: result.plan.shareCode };
}

// Edits a plan (see updatePlanFor in src/lib/plan-edits.ts), then refreshes
// the pages that show it.
export async function updatePlan(
  planId: string,
  input: PlanInput,
  scope: EditScope = "all",
  occurrence?: string | null,
): Promise<{ shareCode: string } | { error: string }> {
  const user = await requireUser();
  const result = await updatePlanFor(user.id, planId, input, scope, occurrence);
  if ("shareCode" in result) revalidatePath("/", "layout");
  return result;
}

// How long after cancelling "Undo" still works. The button only shows for 5
// seconds; the extra time allows for a slow connection.
const UNDO_WINDOW_MS = 2 * 60_000;

type SavedException = {
  originalStart: string;
  cancelled: boolean;
  title: string | null;
  location: string | null;
  notes: string | null;
  start: string | null;
  end: string | null;
};

// What a cancellation changed, saved so it can be undone.
export type CancelSnapshot =
  | { scope: "all" }
  | { scope: "this"; originalStart: string; previous: SavedException | null }
  | {
      scope: "following";
      originalStart: string;
      repeatUntil: string | null;
      repeatCount: number | null;
      seriesEnd: string | null;
      exceptions: SavedException[];
      dateRsvps: { userId: string; originalStart: string; response: "GOING" | "NOT_GOING" }[];
    };

const saveException = (e: EditablePlan["exceptions"][number]): SavedException => ({
  originalStart: e.originalStart.toISOString(),
  cancelled: e.cancelled,
  title: e.title,
  location: e.location,
  notes: e.notes,
  start: e.start?.toISOString() ?? null,
  end: e.end?.toISOString() ?? null,
});

const restoreException = (planId: string, e: SavedException) => ({
  planId,
  originalStart: new Date(e.originalStart),
  cancelled: e.cancelled,
  title: e.title,
  location: e.location,
  notes: e.notes,
  start: e.start ? new Date(e.start) : null,
  end: e.end ? new Date(e.end) : null,
});

// Cancels a plan, or for repeating plans just this date / this date and
// every later one. Takes it off everyone's Google Calendar. Any member can.
// Afterwards it goes back to the group's calendar, which offers "Undo".
export async function cancelPlan(planId: string, scope: EditScope = "all", occurrence?: string | null) {
  const user = await requireUser();
  const plan = await editablePlan(planId, user.id);
  if (!plan) return;

  const originalStart = plan.repeatFreq ? parseOccurrence(plan, occurrence) : null;
  const cancelAll =
    scope === "all" ||
    !plan.repeatFreq ||
    !originalStart ||
    (scope === "following" && originalStart.getTime() === plan.start.getTime());

  let snapshot: CancelSnapshot;
  if (cancelAll) {
    snapshot = { scope: "all" };
    await prisma.plan.update({ where: { id: plan.id }, data: { cancelledAt: new Date() } });
  } else if (scope === "this") {
    const previous = plan.exceptions.find((e) => e.originalStart.getTime() === originalStart!.getTime());
    snapshot = {
      scope: "this",
      originalStart: originalStart!.toISOString(),
      previous: previous ? saveException(previous) : null,
    };
    await prisma.planException.upsert({
      where: { planId_originalStart: { planId: plan.id, originalStart: originalStart! } },
      create: { planId: plan.id, originalStart: originalStart!, cancelled: true },
      update: { cancelled: true },
    });
  } else {
    // "This and following" also removes per-date changes and answers from
    // this date on, so save those too.
    const dateRsvps = await prisma.occurrenceRsvp.findMany({
      where: { planId: plan.id, originalStart: { gte: originalStart! } },
    });
    snapshot = {
      scope: "following",
      originalStart: originalStart!.toISOString(),
      repeatUntil: plan.repeatUntil,
      repeatCount: plan.repeatCount,
      seriesEnd: plan.seriesEnd?.toISOString() ?? null,
      exceptions: plan.exceptions.filter((e) => e.originalStart >= originalStart!).map(saveException),
      dateRsvps: dateRsvps.map((r) => ({
        userId: r.userId,
        originalStart: r.originalStart.toISOString(),
        response: r.response,
      })),
    };
    await endPlanBefore(plan, originalStart!);
    await dropStaleDates(plan.id, originalStart!, () => false);
  }

  // Clear out old undo records while we're here, then save this one.
  await prisma.cancelUndo.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - UNDO_WINDOW_MS) } } });
  const undo = await prisma.cancelUndo.create({ data: { planId: plan.id, userId: user.id, snapshot } });

  await syncPlanForEveryone(plan.id);
  revalidatePath("/", "layout");
  redirect(`/groups/${plan.groupId}?undo=${undo.id}`);
}

// Puts back whatever a cancellation changed, and re-adds it to everyone's
// Google Calendar. Only the person who cancelled, and only shortly after.
export async function undoCancel(undoId: string): Promise<{ ok: true } | { error: string }> {
  const user = await requireUser();
  const undo = await prisma.cancelUndo.findUnique({ where: { id: undoId } });
  if (!undo || undo.userId !== user.id || Date.now() - undo.createdAt.getTime() > UNDO_WINDOW_MS) {
    return { error: "It's too late to undo that." };
  }
  const planId = undo.planId;
  const snapshot = undo.snapshot as CancelSnapshot;

  if (snapshot.scope === "all") {
    await prisma.plan.update({ where: { id: planId }, data: { cancelledAt: null } });
  } else if (snapshot.scope === "this") {
    const originalStart = new Date(snapshot.originalStart);
    if (snapshot.previous) {
      const restored = restoreException(planId, snapshot.previous);
      await prisma.planException.update({
        where: { planId_originalStart: { planId, originalStart } },
        data: restored,
      });
    } else {
      await prisma.planException.deleteMany({ where: { planId, originalStart } });
    }
  } else {
    await prisma.plan.update({
      where: { id: planId },
      data: {
        repeatUntil: snapshot.repeatUntil,
        repeatCount: snapshot.repeatCount,
        seriesEnd: snapshot.seriesEnd ? new Date(snapshot.seriesEnd) : null,
      },
    });
    await prisma.planException.createMany({
      data: snapshot.exceptions.map((e) => restoreException(planId, e)),
      skipDuplicates: true,
    });
    // Their separate Google events were deleted; the sync below re-adds them.
    await prisma.occurrenceRsvp.createMany({
      data: snapshot.dateRsvps.map((r) => ({
        planId,
        userId: r.userId,
        originalStart: new Date(r.originalStart),
        response: r.response,
      })),
      skipDuplicates: true,
    });
  }

  await prisma.cancelUndo.delete({ where: { id: undoId } });
  await syncPlanForEveryone(planId);
  revalidatePath("/", "layout");
  return { ok: true };
}

// Anyone signed in who has the plan link can RSVP, matching who can view it.
// For repeating plans, `occurrence` is the date being answered ("just this
// one"); leaving it out answers every date ("all of them"), replacing any
// per-date answers. Their Google Calendar is updated to match.
export async function setRsvp(planId: string, response: "GOING" | "NOT_GOING", occurrence?: string | null) {
  const user = await requireUser();
  if (response !== "GOING" && response !== "NOT_GOING") throw new Error("Invalid RSVP");
  if (!(await setRsvpFor(user.id, planId, response, occurrence))) return;
  revalidatePath("/", "layout");
}
