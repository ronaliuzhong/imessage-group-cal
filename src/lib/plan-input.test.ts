import { describe, expect, it } from "vitest";
import { parsePlanInput, repeatChanged, type PlanInput, type RepeatInput } from "./plan-input";

// Thursday Oct 1, 2026, 7pm New York time, 90 minutes.
const valid: PlanInput = {
  title: "  Dinner  ",
  start: "2026-10-01T23:00:00.000Z",
  durationMinutes: 90,
  location: "",
  notes: "   ",
  timeZone: "America/New_York",
  repeat: null,
};

const weekly: RepeatInput = { freq: "WEEKLY", interval: 1, weekdays: [], ends: "never", untilDate: "", count: 4 };

function fieldsOf(input: PlanInput) {
  const result = parsePlanInput(input);
  if ("error" in result) throw new Error(result.error);
  return result.fields;
}

describe("parsePlanInput", () => {
  it("cleans up a one-time plan", () => {
    const fields = fieldsOf(valid);
    expect(fields.title).toBe("Dinner");
    expect(fields.end.toISOString()).toBe("2026-10-02T00:30:00.000Z");
    expect(fields.location).toBeNull();
    expect(fields.notes).toBeNull();
    expect(fields.repeatFreq).toBeNull();
    expect(fields.seriesEnd).toEqual(fields.end);
  });

  it("always includes the start day for weekly plans", () => {
    // Picked Mon + Wed, but it starts on a Thursday.
    const fields = fieldsOf({ ...valid, repeat: { ...weekly, weekdays: [3, 1] } });
    expect(fields.repeatWeekdays).toEqual([1, 3, 4]);
  });

  it("handles each way of ending", () => {
    const never = fieldsOf({ ...valid, repeat: weekly });
    expect(never.repeatUntil).toBeNull();
    expect(never.repeatCount).toBeNull();
    expect(never.seriesEnd).toBeNull(); // repeats forever

    const until = fieldsOf({ ...valid, repeat: { ...weekly, ends: "on", untilDate: "2026-10-15" } });
    expect(until.repeatUntil).toBe("2026-10-15");
    expect(until.seriesEnd!.toISOString()).toBe("2026-10-16T00:30:00.000Z"); // Oct 15 dinner ends

    const after = fieldsOf({ ...valid, repeat: { ...weekly, ends: "after", count: 3 } });
    expect(after.repeatCount).toBe(3);
    expect(after.seriesEnd!.toISOString()).toBe("2026-10-16T00:30:00.000Z");
  });

  it("treats 'after 1 time' as not repeating", () => {
    expect(fieldsOf({ ...valid, repeat: { ...weekly, ends: "after", count: 1 } }).repeatFreq).toBeNull();
  });

  it("rejects bad input with a readable message", () => {
    expect(parsePlanInput({ ...valid, title: "   " })).toEqual({ error: "Give the plan a name." });
    expect(parsePlanInput({ ...valid, start: "not a date" })).toEqual({ error: "Pick a valid start time." });
    expect(parsePlanInput({ ...valid, durationMinutes: 0 })).toEqual({ error: "Pick a valid length." });
    expect(parsePlanInput({ ...valid, repeat: { ...weekly, interval: 0 } })).toEqual({ error: "Repeat every 1 to 30." });
    expect(parsePlanInput({ ...valid, repeat: { ...weekly, ends: "after", count: 500 } })).toEqual({
      error: "Repeat between 1 and 100 times.",
    });
    expect(parsePlanInput({ ...valid, repeat: { ...weekly, ends: "on", untilDate: "2026-09-01" } })).toEqual({
      error: "It can't stop repeating before it starts.",
    });
  });

  it("falls back to UTC for an unknown timezone and caps long text", () => {
    const fields = fieldsOf({ ...valid, timeZone: "Mars/Olympus", location: "x".repeat(500) });
    expect(fields.timeZone).toBe("UTC");
    expect(fields.location).toHaveLength(200);
  });
});

describe("repeatChanged", () => {
  it("notices changes to the repeat pattern only", () => {
    const a = fieldsOf({ ...valid, repeat: weekly });
    const b = fieldsOf({ ...valid, title: "Different", repeat: weekly });
    const c = fieldsOf({ ...valid, repeat: { ...weekly, interval: 2 } });
    expect(repeatChanged(a, b)).toBe(false);
    expect(repeatChanged(a, c)).toBe(true);
  });
});
