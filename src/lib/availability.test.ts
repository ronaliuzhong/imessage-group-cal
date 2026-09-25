import { describe, expect, it } from "vitest";
import { computeSegments } from "./availability";

// Helper: a timestamp on a fixed test day, e.g. at("09:30").
const at = (hhmm: string) => Date.parse(`2026-10-01T${hhmm}:00Z`);
const block = (start: string, end: string) => ({
  start: new Date(at(start)).toISOString(),
  end: new Date(at(end)).toISOString(),
});
// Shorthand for readable expectations: [start, end, busy ids].
const simplify = (segments: ReturnType<typeof computeSegments>) =>
  segments.map((s) => [new Date(s.start).toISOString().slice(11, 16), new Date(s.end).toISOString().slice(11, 16), s.busyMemberIds]);

describe("computeSegments", () => {
  it("returns one all-free segment when nobody is busy", () => {
    const result = computeSegments([{ memberId: "a", busy: [] }], at("08:00"), at("12:00"));
    expect(simplify(result)).toEqual([["08:00", "12:00", []]]);
  });

  it("splits around one person's meeting", () => {
    const result = computeSegments(
      [{ memberId: "a", busy: [block("09:00", "10:00")] }],
      at("08:00"),
      at("12:00"),
    );
    expect(simplify(result)).toEqual([
      ["08:00", "09:00", []],
      ["09:00", "10:00", ["a"]],
      ["10:00", "12:00", []],
    ]);
  });

  it("tracks overlapping meetings from different people", () => {
    const result = computeSegments(
      [
        { memberId: "a", busy: [block("09:00", "11:00")] },
        { memberId: "b", busy: [block("10:00", "12:00")] },
      ],
      at("08:00"),
      at("13:00"),
    );
    expect(simplify(result)).toEqual([
      ["08:00", "09:00", []],
      ["09:00", "10:00", ["a"]],
      ["10:00", "11:00", ["a", "b"]],
      ["11:00", "12:00", ["b"]],
      ["12:00", "13:00", []],
    ]);
  });

  it("merges back-to-back meetings for the same person", () => {
    const result = computeSegments(
      [{ memberId: "a", busy: [block("09:00", "10:00"), block("10:00", "11:00")] }],
      at("08:00"),
      at("12:00"),
    );
    expect(simplify(result)).toEqual([
      ["08:00", "09:00", []],
      ["09:00", "11:00", ["a"]],
      ["11:00", "12:00", []],
    ]);
  });

  it("clips busy blocks that extend past the range", () => {
    const result = computeSegments(
      [{ memberId: "a", busy: [block("06:00", "09:00"), block("11:00", "15:00")] }],
      at("08:00"),
      at("12:00"),
    );
    expect(simplify(result)).toEqual([
      ["08:00", "09:00", ["a"]],
      ["09:00", "11:00", []],
      ["11:00", "12:00", ["a"]],
    ]);
  });

  it("ignores busy blocks entirely outside the range", () => {
    const result = computeSegments(
      [{ memberId: "a", busy: [block("01:00", "02:00")] }],
      at("08:00"),
      at("12:00"),
    );
    expect(simplify(result)).toEqual([["08:00", "12:00", []]]);
  });

  it("keeps segments contiguous with no gaps", () => {
    const result = computeSegments(
      [
        { memberId: "a", busy: [block("08:15", "09:45"), block("13:00", "14:00")] },
        { memberId: "b", busy: [block("09:00", "13:30")] },
        { memberId: "c", busy: [] },
      ],
      at("08:00"),
      at("18:00"),
    );
    expect(result[0].start).toBe(at("08:00"));
    expect(result.at(-1)!.end).toBe(at("18:00"));
    for (let i = 1; i < result.length; i++) expect(result[i].start).toBe(result[i - 1].end);
  });
});
