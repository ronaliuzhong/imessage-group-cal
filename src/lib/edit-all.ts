// "Edit all events" for repeating plans: pure logic, no database, so it's
// unit tested. The rule: whatever was edited changes on every date,
// including dates that had their own one-off change to that detail; details
// that weren't touched keep any per-date changes. If the time moved, the
// whole series moves by the same amount, and per-date changes and RSVPs move
// with their dates (the 1st Saturday stays the 1st Saturday).

import type { PlanFields, PlanInput } from "@/lib/plan-input";
import {
  findOccurrence,
  remapByPosition,
  ruleOf,
  shiftWeekdays,
  type ExceptionRow,
  type PlanDetails,
} from "@/lib/plan-occurrences";
import { isOccurrenceStart, localDate, localWeekday } from "@/lib/recurrence";

export type Edited = { title: boolean; location: boolean; notes: boolean; time: boolean };

// Whole days between two local dates ("YYYY-MM-DD").
function daysBetween(from: string, to: string): number {
  const utc = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

const sameDays = (a: number[], b: number[]) => [...a].sort().join() === [...b].sort().join();
const duration = (x: { start: Date; end: Date }) => x.end.getTime() - x.start.getTime();

// Works out what "all events" should become. `form` is what the edit form
// submitted (already checked); `originalStart` is the date it was opened on.
// Returns the input to save for the whole plan, plus what was edited.
export function planAllEdit(
  plan: PlanDetails,
  exceptions: ExceptionRow[],
  input: PlanInput,
  form: PlanFields,
  originalStart: Date | null,
): { input: PlanInput; edited: Edited; dayShift: number } {
  // What the form was showing: the date being viewed, with its own changes.
  // Comparing against that (not the series) tells us what was really
  // edited, so opening a date with its own location and changing only the
  // time doesn't spread that location to every date.
  const shown = (originalStart && findOccurrence(plan, exceptions, originalStart)) || plan;
  const edited: Edited = {
    title: form.title !== shown.title,
    location: form.location !== shown.location,
    notes: form.notes !== shown.notes,
    time: form.start.getTime() !== shown.start.getTime() || duration(form) !== duration(shown),
  };

  // Move the whole series by however much this date was moved (like Google).
  const tz = plan.timeZone;
  const start = edited.time ? new Date(plan.start.getTime() + (form.start.getTime() - shown.start.getTime())) : plan.start;
  const dayShift = daysBetween(localDate(plan.start, tz), localDate(start, tz));

  // Moving by whole days moves the weekly repeat days too (Sat → Sun). The
  // form may already show the new day added, which counts as just moving.
  let repeat = input.repeat;
  if (repeat?.freq === "WEEKLY" && plan.repeatFreq === "WEEKLY" && dayShift !== 0) {
    const moved = shiftWeekdays(plan.repeatWeekdays, dayShift);
    const formDay = localWeekday(form.start, tz);
    if (
      sameDays(repeat.weekdays, plan.repeatWeekdays) ||
      sameDays(repeat.weekdays, moved) ||
      sameDays(repeat.weekdays, [...plan.repeatWeekdays, formDay])
    ) {
      repeat = { ...repeat, weekdays: moved };
    }
  }

  return {
    edited,
    dayShift,
    input: {
      ...input,
      start: start.toISOString(),
      durationMinutes: (edited.time ? duration(form) : duration(plan)) / 60_000,
      title: edited.title ? form.title : plan.title,
      location: (edited.location ? form.location : plan.location) ?? "",
      notes: (edited.notes ? form.notes : plan.notes) ?? "",
      timeZone: tz, // keep the organizer's timezone, whoever edits
      repeat,
    },
  };
}

type DateRsvp = { userId: string; originalStart: Date; response: "GOING" | "NOT_GOING"; googleEventId: string | null };

// Moves per-date changes and RSVPs to where their dates are now, clearing
// per-date values of the details that were edited for every date. If the
// repeat pattern itself changed, dates can't be matched up by position, so
// only ones whose date still exists are kept (like Google Calendar).
export function carryOverDates(
  oldPlan: PlanDetails,
  newPlan: PlanDetails,
  exceptions: ExceptionRow[],
  dateRsvps: DateRsvp[],
  edited: Edited,
  patternChanged: boolean,
): { exceptions: ExceptionRow[]; dateRsvps: DateRsvp[]; droppedRsvps: DateRsvp[] } {
  const newRule = ruleOf(newPlan);
  const positions = patternChanged
    ? null
    : remapByPosition(ruleOf(oldPlan), newRule, [...exceptions, ...dateRsvps].map((x) => x.originalStart));
  const newDateFor = (d: Date): Date | null =>
    positions ? (positions.get(d.getTime()) ?? null) : isOccurrenceStart(newRule, d) ? d : null;

  const keptExceptions = exceptions.flatMap((e) => {
    const originalStart = newDateFor(e.originalStart);
    if (!originalStart) return [];
    const kept: ExceptionRow = {
      originalStart,
      cancelled: e.cancelled,
      title: edited.title ? null : e.title,
      location: edited.location ? null : e.location,
      notes: edited.notes ? null : e.notes,
      start: edited.time ? null : e.start,
      end: edited.time ? null : e.end,
    };
    // Nothing left that differs from the series: no exception needed.
    const stillDifferent = [kept.title, kept.location, kept.notes, kept.start, kept.end].some((v) => v !== null);
    return kept.cancelled || stillDifferent ? [kept] : [];
  });

  const keptRsvps: DateRsvp[] = [];
  const droppedRsvps: DateRsvp[] = [];
  for (const r of dateRsvps) {
    const originalStart = newDateFor(r.originalStart);
    if (originalStart) keptRsvps.push({ ...r, originalStart });
    else droppedRsvps.push(r);
  }
  return { exceptions: keptExceptions, dateRsvps: keptRsvps, droppedRsvps };
}
