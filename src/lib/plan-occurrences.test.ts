import { describe, expect, it } from "vitest";
import {
  describeChanges,
  findOccurrence,
  occurrenceToShow,
  remapByPosition,
  shiftWeekdays,
  resolvedOccurrencesBetween,
  responseFor,
  responsesFor,
  upcomingResolved,
  type ExceptionRow,
  type PlanDetails,
} from "./plan-occurrences";

// Weekly Thursday 7–9pm New York dinner, 4 times from Oct 15, 2026.
const plan: PlanDetails = {
  title: "Dinner",
  location: "Joe's",
  notes: null,
  start: new Date("2026-10-15T23:00:00Z"),
  end: new Date("2026-10-16T01:00:00Z"),
  timeZone: "America/New_York",
  repeatFreq: "WEEKLY",
  repeatInterval: 1,
  repeatWeekdays: [4],
  repeatUntil: null,
  repeatCount: 4,
};

const oct22 = new Date("2026-10-22T23:00:00Z");
const oct29 = new Date("2026-10-29T23:00:00Z");

const exception = (changes: Partial<ExceptionRow>): ExceptionRow => ({
  originalStart: oct22,
  cancelled: false,
  title: null,
  location: null,
  notes: null,
  start: null,
  end: null,
  ...changes,
});

const everything = [new Date("2026-01-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z")] as const;

describe("resolvedOccurrencesBetween", () => {
  it("lists every occurrence when nothing was changed", () => {
    const all = resolvedOccurrencesBetween(plan, [], ...everything);
    expect(all).toHaveLength(4);
    expect(all.every((o) => o.title === "Dinner" && o.location === "Joe's" && o.changes.length === 0)).toBe(true);
  });

  it("leaves out a cancelled date", () => {
    const all = resolvedOccurrencesBetween(plan, [exception({ cancelled: true })], ...everything);
    expect(all.map((o) => o.originalStart.toISOString())).not.toContain(oct22.toISOString());
    expect(all).toHaveLength(3);
  });

  it("applies a one-off change to just that date", () => {
    const moved = exception({
      title: "Tacos instead",
      location: "", // removed for this date
      start: new Date("2026-10-23T00:00:00Z"), // an hour later
      end: new Date("2026-10-23T02:00:00Z"),
    });
    const all = resolvedOccurrencesBetween(plan, [moved], ...everything);
    const changed = all.find((o) => o.originalStart.getTime() === oct22.getTime())!;
    expect(changed.title).toBe("Tacos instead");
    expect(changed.location).toBeNull();
    expect(changed.start.toISOString()).toBe("2026-10-23T00:00:00.000Z");
    expect(changed.changes).toEqual(["name", "time", "location"]);
    expect(all.filter((o) => o.title === "Dinner")).toHaveLength(3);
  });

  it("includes a date moved into the range and drops one moved out", () => {
    const movedToFriday = exception({
      start: new Date("2026-10-23T23:00:00Z"),
      end: new Date("2026-10-24T01:00:00Z"),
    });
    // Just Friday Oct 23 (New York time).
    const friday = resolvedOccurrencesBetween(
      plan,
      [movedToFriday],
      new Date("2026-10-23T04:00:00Z"),
      new Date("2026-10-24T04:00:00Z"),
    );
    expect(friday).toHaveLength(1);
    // Thursday Oct 22 no longer has it.
    const thursday = resolvedOccurrencesBetween(
      plan,
      [movedToFriday],
      new Date("2026-10-22T04:00:00Z"),
      new Date("2026-10-23T04:00:00Z"),
    );
    expect(thursday).toHaveLength(0);
  });
});

describe("describeChanges", () => {
  it("lists what's different in plain English", () => {
    expect(describeChanges(["location"])).toBe("location");
    expect(describeChanges(["time", "location"])).toBe("time and location");
    expect(describeChanges(["name", "time", "notes"])).toBe("name, time and notes");
  });

  it("counts only what was actually changed for that date", () => {
    const newNotes = resolvedOccurrencesBetween(plan, [exception({ notes: "Bring cash" })], ...everything);
    expect(newNotes.find((o) => o.originalStart.getTime() === oct22.getTime())!.changes).toEqual(["notes"]);
  });
});

describe("upcomingResolved / findOccurrence", () => {
  it("skips cancelled dates when listing what's next", () => {
    const next = upcomingResolved(plan, [exception({ cancelled: true })], new Date("2026-10-20T00:00:00Z"), 2);
    expect(next.map((o) => o.start.toISOString())).toEqual([oct29.toISOString(), "2026-11-06T00:00:00.000Z"]);
  });

  it("finds a date by its original start, but not a made-up or cancelled one", () => {
    expect(findOccurrence(plan, [], oct22)?.start).toEqual(oct22);
    expect(findOccurrence(plan, [], new Date("2026-10-22T22:00:00Z"))).toBeNull();
    expect(findOccurrence(plan, [exception({ cancelled: true })], oct22)).toBeNull();
  });
});

describe("occurrenceToShow", () => {
  it("shows the date asked for when it's real", () => {
    expect(occurrenceToShow(plan, [], oct29, new Date("2026-10-01T00:00:00Z")).start).toEqual(oct29);
  });

  it("otherwise shows the next date coming up, skipping cancelled ones", () => {
    const now = new Date("2026-10-20T00:00:00Z");
    expect(occurrenceToShow(plan, [], null, now).start).toEqual(oct22);
    expect(occurrenceToShow(plan, [exception({ cancelled: true })], new Date("bad"), now).start).toEqual(oct29);
  });

  it("falls back to the first date once everything's in the past", () => {
    expect(occurrenceToShow(plan, [], null, new Date("2027-06-01T00:00:00Z")).start).toEqual(plan.start);
  });
});

describe("responseFor / responsesFor", () => {
  const rsvps = [
    { userId: "ana", response: "GOING" as const },
    { userId: "ben", response: "GOING" as const },
  ];
  const occurrenceRsvps = [
    { userId: "ben", originalStart: oct22, response: "NOT_GOING" as const },
    { userId: "cam", originalStart: oct22, response: "GOING" as const },
  ];

  it("uses a person's answer for that date, else their answer to the whole plan", () => {
    expect(responseFor("ben", oct22, rsvps, occurrenceRsvps)).toBe("NOT_GOING");
    expect(responseFor("ben", oct29, rsvps, occurrenceRsvps)).toBe("GOING");
    expect(responseFor("cam", oct29, rsvps, occurrenceRsvps)).toBeNull();
  });

  it("works out who's going on each date", () => {
    const oct22Answers = responsesFor(oct22, rsvps, occurrenceRsvps);
    expect(oct22Answers.going.map((r) => r.userId).sort()).toEqual(["ana", "cam"]);
    expect(oct22Answers.notGoing.map((r) => r.userId)).toEqual(["ben"]);
    expect(responsesFor(oct29, rsvps, occurrenceRsvps).going.map((r) => r.userId)).toEqual(["ana", "ben"]);
  });
});

describe("remapByPosition / shiftWeekdays", () => {
  const rule = { start: plan.start, end: plan.end, timeZone: plan.timeZone, recurrence: { freq: "WEEKLY" as const, interval: 1, weekdays: [4], untilDate: null, count: 4 } };

  it("keeps each date in its place when the series moves an hour later", () => {
    const later = { ...rule, start: new Date("2026-10-16T00:00:00Z"), end: new Date("2026-10-16T02:00:00Z") };
    const map = remapByPosition(rule, later, [oct22, oct29]);
    expect(map.get(oct22.getTime())!.toISOString()).toBe("2026-10-23T00:00:00.000Z"); // 2nd Thursday, 8pm
    // 3rd Thursday is after the clocks change but still 8pm local.
    expect(map.get(oct29.getTime())!.toISOString()).toBe("2026-10-30T00:00:00.000Z");
  });

  it("gives null when the new series doesn't reach that far", () => {
    const shorter = { ...rule, recurrence: { ...rule.recurrence, count: 2 } };
    expect(remapByPosition(rule, shorter, [oct29]).get(oct29.getTime())).toBeNull();
  });

  it("moves weekdays by whole days, wrapping around the week", () => {
    expect(shiftWeekdays([6], 1)).toEqual([0]); // Sat → Sun
    expect(shiftWeekdays([1, 3], -1)).toEqual([0, 2]);
  });
});
