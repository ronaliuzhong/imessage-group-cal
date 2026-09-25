import { describe, expect, it } from "vitest";
import {
  addDaysInTimeZone,
  countBefore,
  endOfLocalDate,
  isOccurrenceStart,
  isValidTimeZone,
  localWeekday,
  occurrencesBetween,
  repeatLabel,
  rrule,
  seriesEnd,
  upcomingOccurrences,
  wallClockStamp,
  type Recurrence,
  type RepeatRule,
} from "./recurrence";

const NY = "America/New_York";

// Thursday Oct 15, 2026, 7–9pm New York time. US clocks fall back on
// Sunday Nov 1, 2026.
const start = new Date("2026-10-15T23:00:00Z");
const end = new Date("2026-10-16T01:00:00Z");

function rule(recurrence: Partial<Recurrence> | null, overrides: Partial<RepeatRule> = {}): RepeatRule {
  return {
    start,
    end,
    timeZone: NY,
    recurrence: recurrence && { freq: "WEEKLY", interval: 1, weekdays: [], untilDate: null, count: null, ...recurrence },
    ...overrides,
  };
}

// Local start stamps of the first `n` occurrences.
const stamps = (r: RepeatRule, n: number) =>
  upcomingOccurrences(r, new Date(0), n).map((o) => wallClockStamp(o.start, NY));

describe("addDaysInTimeZone", () => {
  it("keeps the same local time across the fall-back change", () => {
    const nextWeek = addDaysInTimeZone(new Date("2026-10-29T23:00:00Z"), 7, NY);
    expect(nextWeek.toISOString()).toBe("2026-11-06T00:00:00.000Z"); // 7pm EST
    expect(wallClockStamp(nextWeek, NY)).toBe("20261105T190000");
  });

  it("keeps the same local time across the spring-forward change", () => {
    const after = addDaysInTimeZone(new Date("2026-03-06T00:00:00Z"), 7, NY); // Thu Mar 5, 7pm EST
    expect(after.toISOString()).toBe("2026-03-12T23:00:00.000Z"); // 7pm EDT
  });
});

describe("weekly", () => {
  it("repeats on the start day by default, at 7pm local across DST", () => {
    expect(stamps(rule({ count: 4 }), 10)).toEqual([
      "20261015T190000",
      "20261022T190000",
      "20261029T190000",
      "20261105T190000",
    ]);
  });

  it("repeats on several weekdays, starting from the start date", () => {
    // Mon, Wed, Thu starting Thu Oct 15: the Mon/Wed of that week are before
    // the start, so the first is Thu Oct 15.
    expect(stamps(rule({ weekdays: [1, 3, 4], count: 5 }), 10)).toEqual([
      "20261015T190000",
      "20261019T190000",
      "20261021T190000",
      "20261022T190000",
      "20261026T190000",
    ]);
  });

  it("skips weeks for every-2-weeks plans", () => {
    expect(stamps(rule({ interval: 2, weekdays: [2, 4], count: 4 }), 10)).toEqual([
      "20261015T190000", // Thu (week of Oct 11)
      "20261027T190000", // Tue (week of Oct 25)
      "20261029T190000", // Thu
      "20261110T190000", // Tue (week of Nov 8)
    ]);
  });

  it("stops at the until date, including that day", () => {
    expect(stamps(rule({ untilDate: "2026-10-29" }), 10)).toEqual([
      "20261015T190000",
      "20261022T190000",
      "20261029T190000",
    ]);
  });
});

describe("daily and monthly", () => {
  it("repeats every N days", () => {
    expect(stamps(rule({ freq: "DAILY", interval: 3, count: 3 }), 10)).toEqual([
      "20261015T190000",
      "20261018T190000",
      "20261021T190000",
    ]);
  });

  it("repeats monthly on the same date, skipping months without it", () => {
    const jan31 = rule(
      { freq: "MONTHLY", count: 4 },
      { start: new Date("2027-02-01T00:00:00Z"), end: new Date("2027-02-01T01:00:00Z") }, // Sun Jan 31, 7pm EST
    );
    expect(stamps(jan31, 10)).toEqual([
      "20270131T190000",
      "20270331T190000", // no Feb 31
      "20270531T190000", // no Apr 31
      "20270731T190000", // no Jun 31
    ]);
  });
});

describe("one-time and never-ending plans", () => {
  it("has a single occurrence when it doesn't repeat", () => {
    expect(stamps(rule(null), 10)).toEqual(["20261015T190000"]);
    expect(seriesEnd(rule(null))).toEqual(end);
  });

  it("keeps going when it never ends, but only as far as asked", () => {
    const forever = rule({ freq: "DAILY" });
    expect(seriesEnd(forever)).toBeNull();
    expect(stamps(forever, 400)).toHaveLength(400);
    // 02:00 UTC is after each evening's 7–9pm New York dinner has ended, so
    // this range holds exactly the Oct 15, 16 and 17 dinners.
    const aYearLater = occurrencesBetween(forever, new Date("2027-10-15T02:00:00Z"), new Date("2027-10-18T02:00:00Z"));
    expect(aYearLater.map((o) => wallClockStamp(o.start, NY))).toEqual([
      "20271015T190000",
      "20271016T190000",
      "20271017T190000",
    ]);
  });
});

describe("occurrencesBetween / isOccurrenceStart / countBefore / seriesEnd", () => {
  const weekly = rule({ count: 4 });

  it("finds the occurrences inside a range", () => {
    const found = occurrencesBetween(weekly, new Date("2026-10-25T00:00:00Z"), new Date("2026-11-01T00:00:00Z"));
    expect(found.map((o) => wallClockStamp(o.start, NY))).toEqual(["20261029T190000"]);
  });

  it("recognizes real occurrence start times only", () => {
    expect(isOccurrenceStart(weekly, new Date("2026-10-22T23:00:00Z"))).toBe(true);
    expect(isOccurrenceStart(weekly, new Date("2026-10-22T22:00:00Z"))).toBe(false);
    expect(isOccurrenceStart(weekly, new Date("2026-11-12T00:00:00Z"))).toBe(false); // after the 4th
  });

  it("counts occurrences before a moment", () => {
    expect(countBefore(weekly, new Date("2026-10-29T23:00:00Z"))).toBe(2);
  });

  it("ends when the last occurrence ends", () => {
    expect(seriesEnd(weekly)!.toISOString()).toBe("2026-11-06T02:00:00.000Z");
  });
});

describe("rrule", () => {
  it("writes the standard repeat rule", () => {
    expect(rrule(rule({ count: 4 }))).toBe("RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TH;WKST=SU;COUNT=4");
    expect(rrule(rule({ interval: 2, weekdays: [3, 1] }))).toBe("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;WKST=SU");
    expect(rrule(rule({ freq: "DAILY", count: 3 }))).toBe("RRULE:FREQ=DAILY;INTERVAL=1;COUNT=3");
    expect(rrule(rule(null))).toBeNull();
  });

  it("writes UNTIL as the end of that local day in UTC", () => {
    // Oct 29 ends at 11:59:59pm EDT = 03:59:59 UTC on Oct 30.
    expect(rrule(rule({ untilDate: "2026-10-29" }))).toBe(
      "RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TH;WKST=SU;UNTIL=20261030T035959Z",
    );
    expect(endOfLocalDate("2026-10-29", NY).toISOString()).toBe("2026-10-30T03:59:59.000Z");
  });
});

describe("repeatLabel", () => {
  it("describes repeats in words", () => {
    expect(repeatLabel(rule({ count: 6 }))).toBe("Weekly on Thursday · 6 times");
    expect(repeatLabel(rule({ weekdays: [1, 2, 3, 4, 5] }))).toBe("Weekly on weekdays");
    expect(repeatLabel(rule({ interval: 2, weekdays: [1, 3], untilDate: "2026-12-01" }))).toBe(
      "Every 2 weeks on Mon, Wed · until Dec 1",
    );
    expect(repeatLabel(rule({ freq: "DAILY" }))).toBe("Daily");
    expect(repeatLabel(rule({ freq: "MONTHLY", interval: 3 }))).toBe("Every 3 months on day 15");
    expect(repeatLabel(rule(null))).toBeNull();
  });
});

describe("helpers", () => {
  it("knows the local weekday and valid timezones", () => {
    expect(localWeekday(start, NY)).toBe(4); // Thursday
    expect(localWeekday(start, "UTC")).toBe(4);
    expect(localWeekday(new Date("2026-10-16T02:00:00Z"), NY)).toBe(4); // still Thu in NY, Fri in UTC
    expect(isValidTimeZone(NY)).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });
});
