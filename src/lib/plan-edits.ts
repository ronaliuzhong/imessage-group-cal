import { randomBytes } from "node:crypto";
import { syncPlanForEveryone } from "@/lib/calendar-sync";
import { prisma } from "@/lib/db";
import { carryOverDates, planAllEdit } from "@/lib/edit-all";
import { deleteEvent } from "@/lib/google";
import { parsePlanInput, repeatChanged, type PlanFields, type PlanInput } from "@/lib/plan-input";
import { ruleOf, shiftWeekdays } from "@/lib/plan-occurrences";
import { parseOccurrence } from "@/lib/plan-writes";
import { isOccurrenceStart, localDate, seriesEnd } from "@/lib/recurrence";

// Editing plans. Shared by the website's Server Actions and the iPhone app's
// endpoints, so both behave the same (including keeping everyone's Google
// Calendar in step).

// For repeating plans: which dates an edit or cancellation applies to.
export type EditScope = "this" | "following" | "all";

// A plan the signed-in user may change: it exists, isn't cancelled, and
// they're in its group (any member can edit or cancel).
export async function editablePlan(planId: string, userId: string) {
  const plan = await prisma.plan.findUnique({ where: { id: planId }, include: { exceptions: true } });
  if (!plan || plan.cancelledAt) return null;
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: plan.groupId, userId } },
  });
  return membership ? plan : null;
}
export type EditablePlan = NonNullable<Awaited<ReturnType<typeof editablePlan>>>;

// "YYYY-MM-DD" minus one day.
function dayBefore(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

// Ends a repeating plan just before `splitAt` (for "this and following").
export async function endPlanBefore(plan: EditablePlan, splitAt: Date) {
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
export async function dropStaleDates(planId: string, from: Date, stillValid: (originalStart: Date) => boolean) {
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
export async function updatePlanFor(
  userId: string,
  planId: string,
  input: PlanInput,
  scope: EditScope = "all",
  occurrence?: string | null,
): Promise<{ shareCode: string } | { error: string }> {
  const plan = await editablePlan(planId, userId);
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
    return { shareCode: plan.shareCode };
  }

  if (effectiveScope === "following") {
    const shareCode = await splitPlan(plan, originalStart!, parsed.fields);
    return { shareCode };
  }

  const problem = await editAllDates(plan, input, parsed.fields, originalStart);
  if (problem) return problem;
  await syncPlanForEveryone(plan.id);
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
