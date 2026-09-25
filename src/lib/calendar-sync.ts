// Keeps each person's "Group Cal" Google calendar in step with their plan
// RSVPs. Rather than tracking every little change, `syncPlanForUser` looks at
// what the database says they're going to and makes Google match:
//
// - Going to the whole plan: one event (a repeating one, if the plan repeats).
//   Dates they said they can't make are deleted from it, and one-off edits to
//   single dates are applied to those dates.
// - Going to only some dates: a separate one-off event for each of those.
//
// Every Google call here is best-effort (see src/lib/google.ts): a failure is
// logged and the rest carries on; the next sync tries again.

import { viewerGroupColor } from "@/lib/colors";
import { prisma } from "@/lib/db";
import {
  deleteEvent,
  findInstanceId,
  insertEvent,
  patchEvent,
  replaceEvent,
  type EventBody,
} from "@/lib/google";
import { planDescription } from "@/lib/plan-links";
import { findOccurrence, ruleOf, type ResolvedOccurrence } from "@/lib/plan-occurrences";
import { rrule } from "@/lib/recurrence";
import { siteOrigin } from "@/lib/site";

async function loadPlan(planId: string) {
  return prisma.plan.findUnique({
    where: { id: planId },
    include: { group: { select: { name: true, color: true } }, exceptions: true },
  });
}
type LoadedPlan = NonNullable<Awaited<ReturnType<typeof loadPlan>>>;

type EventContext = { plan: LoadedPlan; colorId: string; url: string };

// Fields shared by every event for this plan.
function common(ctx: EventContext, details: { title: string; location: string | null; notes: string | null }): EventBody {
  return {
    summary: details.title,
    description: planDescription({ notes: details.notes, groupName: ctx.plan.group.name, url: ctx.url }),
    // "" clears a location that was there before (PUT/PATCH).
    location: details.location ?? "",
    colorId: ctx.colorId,
    source: { title: "Group Cal", url: ctx.url },
  };
}

const at = (date: Date, timeZone: string) => ({ dateTime: date.toISOString(), timeZone });

// The whole plan: repeating if the plan repeats.
function seriesBody(ctx: EventContext): EventBody {
  const { plan } = ctx;
  const repeat = rrule(ruleOf(plan));
  return {
    ...common(ctx, plan),
    // Google needs the timezone to repeat an event at the same local time.
    start: at(plan.start, plan.timeZone),
    end: at(plan.end, plan.timeZone),
    ...(repeat && { recurrence: [repeat] }),
  };
}

// A single date, as a one-off event or as a change to one date of the series.
function occurrenceBody(ctx: EventContext, occurrence: ResolvedOccurrence): EventBody {
  return {
    ...common(ctx, occurrence),
    start: at(occurrence.start, ctx.plan.timeZone),
    end: at(occurrence.end, ctx.plan.timeZone),
  };
}

// Makes one person's Google Calendar match their RSVPs for one plan.
export async function syncPlanForUser(planId: string, userId: string): Promise<void> {
  const plan = await loadPlan(planId);
  if (!plan) return;
  const [rsvp, dateRsvps, membership] = await Promise.all([
    prisma.rsvp.findUnique({ where: { planId_userId: { planId, userId } } }),
    prisma.occurrenceRsvp.findMany({ where: { planId, userId } }),
    prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: plan.groupId, userId } },
      select: { color: true },
    }),
  ]);
  const ctx: EventContext = {
    plan,
    // Their own color for the group (the starting color if they aren't in it).
    colorId: viewerGroupColor(plan.group, membership).googleColorId,
    url: `${await siteOrigin()}/p/${plan.shareCode}`,
  };

  // A cancelled plan: nothing of it should be on their calendar.
  if (plan.cancelledAt) {
    if (rsvp?.googleEventId) await deleteEvent(userId, rsvp.googleEventId);
    for (const r of dateRsvps) if (r.googleEventId) await deleteEvent(userId, r.googleEventId);
    await prisma.rsvp.updateMany({ where: { planId, userId }, data: { googleEventId: null } });
    await prisma.occurrenceRsvp.updateMany({ where: { planId, userId }, data: { googleEventId: null } });
    return;
  }

  const setDateEvent = (originalStart: Date, googleEventId: string | null) =>
    prisma.occurrenceRsvp.update({
      where: { planId_userId_originalStart: { planId, userId, originalStart } },
      data: { googleEventId },
    });

  if (rsvp?.response === "GOING") {
    // --- Going to the whole plan: one (repeating) event. ---
    let seriesId = rsvp.googleEventId;
    // Refresh it with the latest details; if it's gone, add it again.
    if (!seriesId || !(await replaceEvent(userId, seriesId, seriesBody(ctx)))) {
      seriesId = await insertEvent(userId, seriesBody(ctx));
      await prisma.rsvp.update({ where: { planId_userId: { planId, userId } }, data: { googleEventId: seriesId } });
    }
    if (!seriesId) return; // couldn't reach their calendar; try again next time
    if (!plan.repeatFreq) return; // one-time plan: nothing more to do

    // One-off edits and cancellations of single dates.
    for (const exception of plan.exceptions) {
      const instanceId = await findInstanceId(userId, seriesId, exception.originalStart);
      if (!instanceId) continue;
      if (exception.cancelled) {
        await deleteEvent(userId, instanceId);
      } else {
        const occurrence = findOccurrence(plan, plan.exceptions, exception.originalStart);
        if (occurrence) await patchEvent(userId, instanceId, occurrenceBody(ctx, occurrence));
      }
    }

    // Their answers for single dates.
    for (const dateRsvp of dateRsvps) {
      const instanceId = await findInstanceId(userId, seriesId, dateRsvp.originalStart);
      if (dateRsvp.response === "NOT_GOING") {
        if (instanceId) await deleteEvent(userId, instanceId);
        if (dateRsvp.googleEventId) {
          await deleteEvent(userId, dateRsvp.googleEventId);
          await setDateEvent(dateRsvp.originalStart, null);
        }
      } else if (instanceId && dateRsvp.googleEventId) {
        // Covered by the series again: the separate event would be a duplicate.
        await deleteEvent(userId, dateRsvp.googleEventId);
        await setDateEvent(dateRsvp.originalStart, null);
      } else if (!instanceId) {
        // Going, but that date was deleted from the series earlier (they'd
        // said they couldn't make it): give them a separate event instead.
        await syncDateEvent(ctx, userId, dateRsvp, setDateEvent);
      }
    }
    return;
  }

  // --- Not going to the whole plan: remove the series event, if any. ---
  if (rsvp?.googleEventId) {
    await deleteEvent(userId, rsvp.googleEventId);
    await prisma.rsvp.update({ where: { planId_userId: { planId, userId } }, data: { googleEventId: null } });
  }
  // ...and give them a separate event for each date they're going to.
  for (const dateRsvp of dateRsvps) {
    if (dateRsvp.response === "GOING") {
      await syncDateEvent(ctx, userId, dateRsvp, setDateEvent);
    } else if (dateRsvp.googleEventId) {
      await deleteEvent(userId, dateRsvp.googleEventId);
      await setDateEvent(dateRsvp.originalStart, null);
    }
  }
}

// Adds or refreshes the separate event for one date they're going to (or
// removes it if that date no longer exists, e.g. it was cancelled).
async function syncDateEvent(
  ctx: EventContext,
  userId: string,
  dateRsvp: { originalStart: Date; googleEventId: string | null },
  setDateEvent: (originalStart: Date, googleEventId: string | null) => Promise<unknown>,
) {
  const occurrence = findOccurrence(ctx.plan, ctx.plan.exceptions, dateRsvp.originalStart);
  if (!occurrence) {
    if (dateRsvp.googleEventId) {
      await deleteEvent(userId, dateRsvp.googleEventId);
      await setDateEvent(dateRsvp.originalStart, null);
    }
    return;
  }
  const body = occurrenceBody(ctx, occurrence);
  if (dateRsvp.googleEventId && (await replaceEvent(userId, dateRsvp.googleEventId, body))) return;
  await setDateEvent(dateRsvp.originalStart, await insertEvent(userId, body));
}

// After a plan changes: sync everyone who has answered it. In parallel, so
// one slow calendar doesn't hold up the rest.
export async function syncPlanForEveryone(planId: string): Promise<void> {
  const [rsvps, dateRsvps] = await Promise.all([
    prisma.rsvp.findMany({ where: { planId }, select: { userId: true } }),
    prisma.occurrenceRsvp.findMany({ where: { planId }, select: { userId: true } }),
  ]);
  const userIds = [...new Set([...rsvps, ...dateRsvps].map((r) => r.userId))];
  await Promise.all(userIds.map((userId) => syncPlanForUser(planId, userId)));
}

// Takes a plan off someone's calendar entirely and forgets their answers
// (e.g. when they leave the group).
export async function removeUserFromPlan(planId: string, userId: string): Promise<void> {
  const [rsvp, dateRsvps] = await Promise.all([
    prisma.rsvp.findUnique({ where: { planId_userId: { planId, userId } } }),
    prisma.occurrenceRsvp.findMany({ where: { planId, userId } }),
  ]);
  if (rsvp?.googleEventId) await deleteEvent(userId, rsvp.googleEventId);
  for (const r of dateRsvps) if (r.googleEventId) await deleteEvent(userId, r.googleEventId);
  await prisma.rsvp.deleteMany({ where: { planId, userId } });
  await prisma.occurrenceRsvp.deleteMany({ where: { planId, userId } });
}
