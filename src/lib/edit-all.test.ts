import { describe, expect, it } from "vitest";
import { carryOverDates, planAllEdit } from "./edit-all";
import { parsePlanInput, type PlanInput } from "./plan-input";
import { resolvedOccurrencesBetween, type ExceptionRow, type PlanDetails } from "./plan-occurrences";
import { wallClockStamp } from "./recurrence";

const NY = "America/New_York";

// Breakfast every Saturday at 8am New York time at East Village, 3 times:
// Oct 3, 10, 17, 2026.
const plan: PlanDetails = {
  title: "Breakfast",
  location: "East Village",
  notes: null,
  start: new Date("2026-10-03T12:00:00Z"),
  end: new Date("2026-10-03T13:00:00Z"),
  timeZone: NY,
  repeatFreq: "WEEKLY",
  repeatInterval: 1,
  repeatWeekdays: [6],
  repeatUntil: null,
  repeatCount: 3,
};
const [sat1, sat2] = [new Date("2026-10-03T12:00:00Z"), new Date("2026-10-10T12:00:00Z")];

// The first Saturday was moved to Brooklyn on its own ("this event").
const brooklyn: ExceptionRow = {
  originalStart: sat1,
  cancelled: false,
  title: null,
  location: "Brooklyn",
  notes: null,
  start: null,
  end: null,
};

// What the edit form submits when opened on `date`, with some changes.
function formFor(date: Date, changes: Partial<PlanInput>): PlanInput {
  return {
    title: "Breakfast",
    start: date.toISOString(),
    durationMinutes: 60,
    location: date.getTime() === sat1.getTime() ? "Brooklyn" : "East Village",
    notes: "",
    timeZone: NY,
    repeat: { freq: "WEEKLY", interval: 1, weekdays: [6], ends: "after", untilDate: "", count: 3 },
    ...changes,
  };
}

// Runs "edit all events" and returns each date's location and local start.
function editAll(openedOn: Date, changes: Partial<PlanInput>, exceptions = [brooklyn]) {
  const input = formFor(openedOn, changes);
  const form = parsePlanInput(input);
  if ("error" in form) throw new Error(form.error);
  const { input: allInput, edited } = planAllEdit(plan, exceptions, input, form.fields, openedOn);
  const saved = parsePlanInput(allInput);
  if ("error" in saved) throw new Error(saved.error);
  const newPlan = { ...plan, ...saved.fields };
  const carried = carryOverDates(plan, newPlan, exceptions, [], edited, false);
  return resolvedOccurrencesBetween(newPlan, carried.exceptions, new Date(0), new Date("2027-01-01")).map((o) => ({
    location: o.location,
    at: wallClockStamp(o.start, NY),
  }));
}

describe("edit all events", () => {
  it("changing the location for all replaces the first Saturday's custom one", () => {
    expect(editAll(sat2, { location: "Park" })).toEqual([
      { location: "Park", at: "20261003T080000" },
      { location: "Park", at: "20261010T080000" },
      { location: "Park", at: "20261017T080000" },
    ]);
  });

  it("changing only the time keeps the first Saturday in Brooklyn", () => {
    expect(editAll(sat2, { start: "2026-10-10T13:00:00.000Z" })).toEqual([
      { location: "Brooklyn", at: "20261003T090000" },
      { location: "East Village", at: "20261010T090000" },
      { location: "East Village", at: "20261017T090000" },
    ]);
  });

  it("opening the Brooklyn date and changing only the time doesn't spread Brooklyn", () => {
    expect(editAll(sat1, { start: "2026-10-03T13:00:00.000Z" })).toEqual([
      { location: "Brooklyn", at: "20261003T090000" },
      { location: "East Village", at: "20261010T090000" },
      { location: "East Village", at: "20261017T090000" },
    ]);
  });

  it("moving a Saturday to Sunday moves the whole series to Sundays", () => {
    const sunday = editAll(sat2, {
      start: "2026-10-11T12:00:00.000Z",
      // The form auto-adds the new day to the repeat days.
      repeat: { freq: "WEEKLY", interval: 1, weekdays: [0, 6], ends: "after", untilDate: "", count: 3 },
    });
    expect(sunday.map((d) => d.at)).toEqual(["20261004T080000", "20261011T080000", "20261018T080000"]);
    expect(sunday[0].location).toBe("Brooklyn"); // still the 1st date's custom location
  });
});

describe("carryOverDates", () => {
  it("moves per-date RSVPs with their dates, and drops ones past the new end", () => {
    const later = { ...plan, start: new Date("2026-10-03T13:00:00Z"), end: new Date("2026-10-03T14:00:00Z"), repeatCount: 1, repeatFreq: null };
    const rsvps = [
      { userId: "ana", originalStart: sat1, response: "NOT_GOING" as const, googleEventId: null },
      { userId: "ben", originalStart: sat2, response: "GOING" as const, googleEventId: "evt" },
    ];
    const noEdits = { title: false, location: false, notes: false, time: true };
    const result = carryOverDates(plan, later, [], rsvps, noEdits, false);
    expect(result.dateRsvps).toEqual([{ ...rsvps[0], originalStart: new Date("2026-10-03T13:00:00Z") }]);
    expect(result.droppedRsvps.map((r) => r.userId)).toEqual(["ben"]);
  });

  it("forgets a per-date change once nothing about it differs any more", () => {
    const noEdits = { title: false, location: true, notes: false, time: false };
    expect(carryOverDates(plan, plan, [brooklyn], [], noEdits, false).exceptions).toEqual([]);
  });
});
