// Combines a plan's repeat rule with its one-off changes (PlanException) and
// per-date RSVPs (OccurrenceRsvp). Pure functions over plain data, so they're
// unit tested; the database-facing code lives in src/lib/plans.ts.

import {
  occurrencesBetween,
  upcomingOccurrences,
  type Frequency,
  type Recurrence,
  type RepeatRule,
} from "@/lib/recurrence";

// The plan fields that describe when it happens (a subset of the Plan row).
export type PlanTiming = {
  start: Date;
  end: Date;
  timeZone: string;
  repeatFreq: string | null;
  repeatInterval: number;
  repeatWeekdays: number[];
  repeatUntil: string | null;
  repeatCount: number | null;
};

export type PlanDetails = PlanTiming & { title: string; location: string | null; notes: string | null };

export type ExceptionRow = {
  originalStart: Date;
  cancelled: boolean;
  title: string | null;
  location: string | null;
  notes: string | null;
  start: Date | null;
  end: Date | null;
};

type Response = "GOING" | "NOT_GOING";

// Which details of a single date differ from the rest of the plan.
export type Change = "name" | "time" | "location" | "notes";

// One occurrence with any one-off changes applied.
export type ResolvedOccurrence = {
  originalStart: Date;
  start: Date;
  end: Date;
  title: string;
  location: string | null;
  notes: string | null;
  changes: Change[]; // empty = same as every other date
};

// "time", "time and location", "name, time and notes".
export function describeChanges(changes: Change[]): string {
  if (changes.length <= 1) return changes.join("");
  return `${changes.slice(0, -1).join(", ")} and ${changes.at(-1)}`;
}

export function recurrenceOf(plan: PlanTiming): Recurrence | null {
  if (!plan.repeatFreq) return null;
  return {
    freq: plan.repeatFreq as Frequency,
    interval: plan.repeatInterval,
    weekdays: plan.repeatWeekdays,
    untilDate: plan.repeatUntil,
    count: plan.repeatCount,
  };
}

export function ruleOf(plan: PlanTiming): RepeatRule {
  return { start: plan.start, end: plan.end, timeZone: plan.timeZone, recurrence: recurrenceOf(plan) };
}

// "" in an exception means "removed for this date"; null means "unchanged".
function override(value: string | null, planValue: string | null): string | null {
  if (value === null) return planValue;
  return value || null;
}

function resolve(
  plan: PlanDetails,
  o: { originalStart: Date; start: Date; end: Date },
  exception?: ExceptionRow,
): ResolvedOccurrence {
  const changes: Change[] = [];
  if (exception?.title != null) changes.push("name");
  if (exception?.start != null || exception?.end != null) changes.push("time");
  if (exception?.location != null) changes.push("location");
  if (exception?.notes != null) changes.push("notes");
  return {
    originalStart: o.originalStart,
    start: exception?.start ?? o.start,
    end: exception?.end ?? o.end,
    title: exception?.title ?? plan.title,
    location: override(exception?.location ?? null, plan.location),
    notes: override(exception?.notes ?? null, plan.notes),
    changes,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Occurrences overlapping [from, to), with one-off changes applied and
// cancelled dates left out.
export function resolvedOccurrencesBetween(
  plan: PlanDetails,
  exceptions: ExceptionRow[],
  from: Date,
  to: Date,
): ResolvedOccurrence[] {
  const byStart = new Map(exceptions.map((e) => [e.originalStart.getTime(), e]));
  // A one-off change can move a date by up to a day or so; look a little
  // wider, then keep only what really lands in the range.
  const wideFrom = new Date(from.getTime() - 2 * DAY_MS);
  const wideTo = new Date(to.getTime() + 2 * DAY_MS);
  return occurrencesBetween(ruleOf(plan), wideFrom, wideTo)
    .flatMap((o) => {
      const exception = byStart.get(o.originalStart.getTime());
      return exception?.cancelled ? [] : [resolve(plan, o, exception)];
    })
    .filter((o) => o.start < to && o.end > from);
}

// The next `limit` occurrences that haven't ended, changes applied.
export function upcomingResolved(
  plan: PlanDetails,
  exceptions: ExceptionRow[],
  now: Date,
  limit: number,
): ResolvedOccurrence[] {
  const byStart = new Map(exceptions.map((e) => [e.originalStart.getTime(), e]));
  const cancelled = exceptions.filter((e) => e.cancelled).length;
  // Fetch extra to make up for cancelled dates, then trim.
  return upcomingOccurrences(ruleOf(plan), now, limit + cancelled)
    .flatMap((o) => {
      const exception = byStart.get(o.originalStart.getTime());
      return exception?.cancelled ? [] : [resolve(plan, o, exception)];
    })
    .filter((o) => o.end > now)
    .slice(0, limit);
}

// A single occurrence by its original start, or null if the plan has no such
// date (or it was cancelled).
export function findOccurrence(
  plan: PlanDetails,
  exceptions: ExceptionRow[],
  originalStart: Date,
): ResolvedOccurrence | null {
  const t = originalStart.getTime();
  const match = occurrencesBetween(ruleOf(plan), new Date(t - 1), new Date(t + DAY_MS)).find(
    (o) => o.originalStart.getTime() === t,
  );
  if (!match) return null;
  const exception = exceptions.find((e) => e.originalStart.getTime() === t);
  return exception?.cancelled ? null : resolve(plan, match, exception);
}

// Someone's answer for one date: their answer for that date if they gave one,
// otherwise their answer to the whole plan.
export function responseFor(
  userId: string,
  originalStart: Date,
  rsvps: { userId: string; response: Response }[],
  occurrenceRsvps: { userId: string; originalStart: Date; response: Response }[],
): Response | null {
  const forDate = occurrenceRsvps.find(
    (r) => r.userId === userId && r.originalStart.getTime() === originalStart.getTime(),
  );
  return forDate?.response ?? rsvps.find((r) => r.userId === userId)?.response ?? null;
}

// Everyone's answer for one date.
export function responsesFor<
  A extends { userId: string; response: Response },
  B extends { userId: string; originalStart: Date; response: Response },
>(originalStart: Date, rsvps: A[], occurrenceRsvps: B[]): { going: (A | B)[]; notGoing: (A | B)[] } {
  const forDate = occurrenceRsvps.filter((r) => r.originalStart.getTime() === originalStart.getTime());
  const overridden = new Set(forDate.map((r) => r.userId));
  const all: (A | B)[] = [...rsvps.filter((r) => !overridden.has(r.userId)), ...forDate];
  return {
    going: all.filter((r) => r.response === "GOING"),
    notGoing: all.filter((r) => r.response === "NOT_GOING"),
  };
}

// Which date of a plan to show: the one asked for (e.g. from a link) if it's
// real, else the next one coming up, else (all past or cancelled) the first.
export function occurrenceToShow(
  plan: PlanDetails,
  exceptions: ExceptionRow[],
  requested: Date | null,
  now = new Date(),
): ResolvedOccurrence {
  if (requested && !Number.isNaN(requested.getTime())) {
    const found = findOccurrence(plan, exceptions, requested);
    if (found) return found;
  }
  const [next] = upcomingResolved(plan, exceptions, now, 1);
  if (next) return next;
  const [first] = upcomingOccurrences(ruleOf(plan), new Date(0), 1);
  return resolve(plan, first, exceptions.find((e) => e.originalStart.getTime() === first.originalStart.getTime()));
}

// When a whole series moves (e.g. 8am → 9am, or Saturdays → Sundays), the
// dates that had their own changes or RSVPs should move with it: the 1st
// date stays the 1st date. Maps each old date to the new date in the same
// position, or null if the new series is shorter.
export function remapByPosition(oldRule: RepeatRule, newRule: RepeatRule, dates: Date[]): Map<number, Date | null> {
  const result = new Map<number, Date | null>();
  if (dates.length === 0) return result;
  const latest = Math.max(...dates.map((d) => d.getTime()));
  const oldStarts = occurrencesBetween(oldRule, oldRule.start, new Date(latest + 1)).map((o) => o.originalStart.getTime());
  const newStarts = upcomingOccurrences(newRule, new Date(0), oldStarts.length).map((o) => o.originalStart);
  for (const date of dates) {
    const position = oldStarts.indexOf(date.getTime());
    result.set(date.getTime(), position >= 0 ? (newStarts[position] ?? null) : null);
  }
  return result;
}

// Weekdays moved by a number of days (e.g. Sat + 1 day = Sun).
export function shiftWeekdays(weekdays: number[], days: number): number[] {
  return [...new Set(weekdays.map((d) => (((d + days) % 7) + 7) % 7))].sort((a, b) => a - b);
}
