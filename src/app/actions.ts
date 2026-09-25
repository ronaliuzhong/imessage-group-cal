"use server";

// Server Actions: functions the browser can trigger (usually from a <form>),
// but which run on the server. Next.js exposes each one as an endpoint that
// anyone could call directly, so every action checks who's signed in itself
// rather than trusting the page it came from.

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { removeUserFromPlan, syncPlanForEveryone, syncPlanForUser } from "@/lib/calendar-sync";
import { normalizeColor } from "@/lib/colors";
import { prisma } from "@/lib/db";
import { deleteEvent } from "@/lib/google";
import { parsePlanInput, repeatChanged, type PlanFields, type PlanInput } from "@/lib/plan-input";
import { carryOverDates, planAllEdit } from "@/lib/edit-all";
import { findOccurrence, ruleOf, shiftWeekdays } from "@/lib/plan-occurrences";
import { isOccurrenceStart, localDate, seriesEnd } from "@/lib/recurrence";
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
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  if (!name) return;
  // normalizeColor() falls back to the default for anything that isn't a color.
  const color = normalizeColor(String(formData.get("color") ?? ""));

  const group = await prisma.group.create({
    data: {
      name,
      color,
      // 16 random bytes ≈ 3.4×10^38 possibilities: impossible to guess.
      inviteCode: randomBytes(16).toString("base64url"),
      members: { create: { userId: user.id } },
    },
  });
  redirect(`/groups/${group.id}`);
}

export async function joinGroup(inviteCode: string) {
  const user = await requireUser();
  const group = await prisma.group.findUnique({ where: { inviteCode } });
  if (!group) notFound();

  // upsert = "insert, or do nothing if already a member" — so tapping the
  // link twice is harmless.
  await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId: group.id, userId: user.id } },
    create: { groupId: group.id, userId: user.id },
    update: {},
  });
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

// For repeating plans: which dates an edit or cancellation applies to.
export type EditScope = "this" | "following" | "all";

export async function createPlan(
  groupId: string,
  input: PlanInput,
): Promise<{ shareCode: string } | { error: string }> {
  const user = await requireUser();
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: user.id } },
  });
  if (!membership) return { error: "You're not in this group." };

  const parsed = parsePlanInput(input);
  if ("error" in parsed) return parsed;

  const plan = await prisma.plan.create({
    data: {
      ...parsed.fields,
      groupId,
      createdById: user.id,
      shareCode: randomBytes(12).toString("base64url"),
      // The organizer is presumably going to their own plan (all of it).
      rsvps: { create: { userId: user.id, response: "GOING" } },
    },
  });
  await syncPlanForUser(plan.id, user.id);
  revalidatePath(`/groups/${groupId}`);
  return { shareCode: plan.shareCode };
}

// A plan the signed-in user may change: it exists, isn't cancelled, and
// they're in its group (any member can edit or cancel).
async function editablePlan(planId: string, userId: string) {
  const plan = await prisma.plan.findUnique({ where: { id: planId }, include: { exceptions: true } });
  if (!plan || plan.cancelledAt) return null;
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: plan.groupId, userId } },
  });
  return membership ? plan : null;
}
type EditablePlan = NonNullable<Awaited<ReturnType<typeof editablePlan>>>;

// Parses the "which date" parameter and checks it's a real date of the plan.
function parseOccurrence(plan: EditablePlan, value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return findOccurrence(plan, plan.exceptions, date) ? date : null;
}

// "YYYY-MM-DD" minus one day.
function dayBefore(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

// Ends a repeating plan just before `splitAt` (for "this and following").
async function endPlanBefore(plan: EditablePlan, splitAt: Date) {
  const repeatUntil = dayBefore(localDate(splitAt, plan.timeZone));
  const timing = { ...plan, repeatUntil, repeatCount: null };
  await prisma.plan.update({
    where: { id: plan.id },
    data: { repeatUntil, repeatCount: null, seriesEnd: seriesEnd(ruleOf(timing)) },
  });
}

// Deletes one-off changes and per-date answers from `from` onward that no
// longer match a real date of the plan (e.g. after its time changed). The
// separate Google events of those answers are removed first.
async function dropStaleDates(planId: string, from: Date, stillValid: (originalStart: Date) => boolean) {
  const [exceptions, dateRsvps] = await Promise.all([
    prisma.planException.findMany({ where: { planId, originalStart: { gte: from } } }),
    prisma.occurrenceRsvp.findMany({ where: { planId, originalStart: { gte: from } } }),
  ]);
  const stale = (d: Date) => !stillValid(d);
  for (const r of dateRsvps.filter((r) => stale(r.originalStart))) {
    if (r.googleEventId) await deleteEvent(r.userId, r.googleEventId);
  }
  await prisma.planException.deleteMany({
    where: { planId, originalStart: { in: exceptions.filter((e) => stale(e.originalStart)).map((e) => e.originalStart) } },
  });
  await prisma.occurrenceRsvp.deleteMany({
    where: { planId, originalStart: { in: dateRsvps.filter((r) => stale(r.originalStart)).map((r) => r.originalStart) } },
  });
}

// Edits a plan. For repeating plans `scope` says which dates: just the one
// being viewed ("this"), it and every later one ("following"), or all.
// Afterwards everyone's Google Calendar is updated to match.
export async function updatePlan(
  planId: string,
  input: PlanInput,
  scope: EditScope = "all",
  occurrence?: string | null,
): Promise<{ shareCode: string } | { error: string }> {
  const user = await requireUser();
  const plan = await editablePlan(planId, user.id);
  if (!plan) return { error: "This plan can't be edited." };
  const parsed = parsePlanInput(input);
  if ("error" in parsed) return parsed;

  const originalStart = plan.repeatFreq ? parseOccurrence(plan, occurrence) : null;
  // Editing from the first date "and following" is the same as "all".
  const effectiveScope: EditScope =
    !plan.repeatFreq || !originalStart || (scope === "following" && originalStart.getTime() === plan.start.getTime())
      ? "all"
      : scope;

  if (effectiveScope === "this") {
    if (repeatChanged(parsed.fields, plan)) {
      return { error: "To change how it repeats, choose “This and following events” or “All events”." };
    }
    await saveOneDateEdit(plan, originalStart!, parsed.fields);
    await syncPlanForEveryone(plan.id);
    revalidatePath("/", "layout");
    return { shareCode: plan.shareCode };
  }

  if (effectiveScope === "following") {
    const shareCode = await splitPlan(plan, originalStart!, parsed.fields);
    revalidatePath("/", "layout");
    return { shareCode };
  }

  const problem = await editAllDates(plan, input, parsed.fields, originalStart);
  if (problem) return problem;
  await syncPlanForEveryone(plan.id);
  revalidatePath("/", "layout");
  return { shareCode: plan.shareCode };
}

// "Edit all events" (see src/lib/edit-all.ts for the rules): saves the new
// details for the whole plan, then moves or clears per-date changes and RSVPs.
async function editAllDates(
  plan: EditablePlan,
  input: PlanInput,
  form: PlanFields,
  originalStart: Date | null,
): Promise<{ error: string } | null> {
  const { input: allInput, edited, dayShift } = planAllEdit(plan, plan.exceptions, input, form, originalStart);
  const saved = parsePlanInput(allInput);
  if ("error" in saved) return saved;
  const fields = saved.fields;
  await prisma.plan.update({ where: { id: plan.id }, data: fields });

  // Did the repeat pattern itself change (not just move with the date)?
  const patternChanged = repeatChanged(fields, {
    ...plan,
    repeatWeekdays: plan.repeatFreq === "WEEKLY" ? shiftWeekdays(plan.repeatWeekdays, dayShift) : plan.repeatWeekdays,
  });
  const dateRsvps = await prisma.occurrenceRsvp.findMany({ where: { planId: plan.id } });
  const carried = carryOverDates(plan, { ...plan, ...fields }, plan.exceptions, dateRsvps, edited, patternChanged);

  // Answers for dates that no longer exist: take their separate events off
  // Google Calendar before forgetting them.
  for (const r of carried.droppedRsvps) if (r.googleEventId) await deleteEvent(r.userId, r.googleEventId);

  // Replace them all at once: the date is part of each row's identity, so
  // moving rows one by one could collide with each other.
  await prisma.$transaction([
    prisma.planException.deleteMany({ where: { planId: plan.id } }),
    prisma.planException.createMany({ data: carried.exceptions.map((e) => ({ ...e, planId: plan.id })) }),
    prisma.occurrenceRsvp.deleteMany({ where: { planId: plan.id } }),
    prisma.occurrenceRsvp.createMany({
      data: carried.dateRsvps.map((r) => ({
        planId: plan.id,
        userId: r.userId,
        originalStart: r.originalStart,
        response: r.response,
        googleEventId: r.googleEventId,
      })),
    }),
  ]);
  return null;
}

// "Edit this event": records how this one date differs from the plan.
async function saveOneDateEdit(plan: EditablePlan, originalStart: Date, fields: PlanFields) {
  const duration = plan.end.getTime() - plan.start.getTime();
  const changes = {
    title: fields.title !== plan.title ? fields.title : null,
    // "" = removed for this date; null = same as the plan.
    location: fields.location !== plan.location ? (fields.location ?? "") : null,
    notes: fields.notes !== plan.notes ? (fields.notes ?? "") : null,
    start: fields.start.getTime() !== originalStart.getTime() ? fields.start : null,
    end: fields.end.getTime() !== originalStart.getTime() + duration ? fields.end : null,
  };
  const where = { planId_originalStart: { planId: plan.id, originalStart } };
  if (Object.values(changes).every((v) => v === null)) {
    // Back to matching the plan: no exception needed.
    await prisma.planException.deleteMany({ where: { planId: plan.id, originalStart, cancelled: false } });
    return;
  }
  await prisma.planException.upsert({
    where,
    create: { planId: plan.id, originalStart, ...changes },
    update: changes,
  });
}

// "Edit this and following events": the plan stops just before this date and
// continues as a new plan with the new details (like Google Calendar). The
// new plan gets its own link; the old one points to it. Returns the new
// plan's share code.
async function splitPlan(plan: EditablePlan, splitAt: Date, fields: PlanFields): Promise<string> {
  await endPlanBefore(plan, splitAt);
  const continued = await prisma.plan.create({
    data: {
      ...fields,
      groupId: plan.groupId,
      createdById: plan.createdById,
      splitFromId: plan.id,
      shareCode: randomBytes(12).toString("base64url"),
    },
  });

  // Everyone's answer to the whole plan carries over to the rest of it.
  const rsvps = await prisma.rsvp.findMany({ where: { planId: plan.id } });
  await prisma.rsvp.createMany({
    data: rsvps.map((r) => ({ planId: continued.id, userId: r.userId, response: r.response })),
  });

  // One-off changes and per-date answers from here on move to the new plan
  // if their date still exists in it; otherwise they're dropped.
  const rule = ruleOf(fields);
  await dropStaleDates(plan.id, splitAt, (d) => isOccurrenceStart(rule, d));
  await prisma.planException.updateMany({
    where: { planId: plan.id, originalStart: { gte: splitAt } },
    data: { planId: continued.id },
  });
  await prisma.occurrenceRsvp.updateMany({
    where: { planId: plan.id, originalStart: { gte: splitAt } },
    data: { planId: continued.id },
  });

  // The old plan's events get shortened; the new plan's get added.
  await Promise.all([syncPlanForEveryone(plan.id), syncPlanForEveryone(continued.id)]);
  return continued.shareCode;
}

// Cancels a plan, or for repeating plans just this date / this date and
// every later one. Takes it off everyone's Google Calendar. Any member can.
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

  if (cancelAll) {
    await prisma.plan.update({ where: { id: plan.id }, data: { cancelledAt: new Date() } });
  } else if (scope === "this") {
    await prisma.planException.upsert({
      where: { planId_originalStart: { planId: plan.id, originalStart: originalStart! } },
      create: { planId: plan.id, originalStart: originalStart!, cancelled: true },
      update: { cancelled: true },
    });
  } else {
    await endPlanBefore(plan, originalStart!);
    await dropStaleDates(plan.id, originalStart!, () => false);
  }
  await syncPlanForEveryone(plan.id);
  revalidatePath("/", "layout");
  redirect(`/p/${plan.shareCode}`);
}

// Anyone signed in who has the plan link can RSVP, matching who can view it.
// For repeating plans, `occurrence` is the date being answered ("just this
// one"); leaving it out answers every date ("all of them"), replacing any
// per-date answers. Their Google Calendar is updated to match.
export async function setRsvp(planId: string, response: "GOING" | "NOT_GOING", occurrence?: string | null) {
  const user = await requireUser();
  if (response !== "GOING" && response !== "NOT_GOING") throw new Error("Invalid RSVP");
  const plan = await prisma.plan.findUnique({ where: { id: planId }, include: { exceptions: true } });
  if (!plan || plan.cancelledAt) return;

  const originalStart = plan.repeatFreq ? parseOccurrence(plan, occurrence) : null;
  if (originalStart) {
    await prisma.occurrenceRsvp.upsert({
      where: { planId_userId_originalStart: { planId, userId: user.id, originalStart } },
      create: { planId, userId: user.id, originalStart, response },
      update: { response },
    });
  } else {
    // "All of them" replaces any per-date answers, like Google Calendar.
    const dateRsvps = await prisma.occurrenceRsvp.findMany({ where: { planId, userId: user.id } });
    for (const r of dateRsvps) if (r.googleEventId) await deleteEvent(user.id, r.googleEventId);
    await prisma.occurrenceRsvp.deleteMany({ where: { planId, userId: user.id } });
    await prisma.rsvp.upsert({
      where: { planId_userId: { planId, userId: user.id } },
      create: { planId, userId: user.id, response },
      update: { response },
    });
  }
  await syncPlanForUser(planId, user.id);
  revalidatePath("/", "layout");
}
