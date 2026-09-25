import { describe, expect, it } from "vitest";
import { googleCalendarUrl, icsFile, mapsUrl, planDescription, toCalendarTimestamp } from "./plan-links";

const plan = {
  id: "plan123",
  title: "Dinner at Joe's",
  start: new Date("2026-10-01T23:00:00Z"), // Thu Oct 1, 7pm New York
  end: new Date("2026-10-02T01:30:00Z"),
  url: "https://example.com/p/abc",
  groupName: "Roommates",
  location: null,
  notes: null,
  timeZone: "America/New_York",
  repeatFreq: null,
  repeatInterval: 1,
  repeatWeekdays: [],
  repeatUntil: null,
  repeatCount: null,
};

// Thursdays at 7pm New York time, 4 times.
const weekly = { ...plan, repeatFreq: "WEEKLY", repeatWeekdays: [4], repeatCount: 4 };

describe("planDescription", () => {
  it("puts notes first, then the group and link", () => {
    expect(planDescription({ ...plan, notes: "Bring snacks" })).toBe(
      "Bring snacks\n\nRoommates · Planned with Group Cal\nhttps://example.com/p/abc",
    );
    expect(planDescription(plan)).toBe("Roommates · Planned with Group Cal\nhttps://example.com/p/abc");
  });
});

describe("mapsUrl", () => {
  it("builds a Google Maps search for the location", () => {
    expect(new URL(mapsUrl("Joe's Pizza, 7 Carmine St")).searchParams.get("query")).toBe("Joe's Pizza, 7 Carmine St");
  });
});

describe("toCalendarTimestamp", () => {
  it("formats as compact UTC", () => {
    expect(toCalendarTimestamp(new Date("2026-10-01T23:05:09.123Z"))).toBe("20261001T230509Z");
  });
});

describe("googleCalendarUrl", () => {
  it("fills in title, times and a link back", () => {
    const url = new URL(googleCalendarUrl(plan));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("text")).toBe("Dinner at Joe's");
    expect(url.searchParams.get("dates")).toBe("20261001T230000Z/20261002T013000Z");
    expect(url.searchParams.get("details")).toBe("Roommates · Planned with Group Cal\nhttps://example.com/p/abc");
    expect(url.searchParams.has("location")).toBe(false);
    expect(url.searchParams.has("recur")).toBe(false);
  });

  it("includes the location and repeat rule when there is one", () => {
    const url = new URL(googleCalendarUrl({ ...weekly, location: "Joe's Pizza" }));
    expect(url.searchParams.get("location")).toBe("Joe's Pizza");
    expect(url.searchParams.get("recur")).toBe("RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TH;WKST=SU;COUNT=4");
    expect(url.searchParams.get("ctz")).toBe("America/New_York");
  });
});

describe("icsFile", () => {
  const ics = icsFile(plan, [], new Date("2026-09-25T00:00:00Z"));
  const unfold = (text: string) => text.replace(/\r\n /g, "");

  it("uses CRLF line endings throughout", () => {
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("contains the event times and a stable ID", () => {
    expect(ics).toContain("DTSTART:20261001T230000Z\r\n");
    expect(ics).toContain("DTEND:20261002T013000Z\r\n");
    expect(ics).toContain("UID:plan123@groupcal\r\n");
  });

  it("puts the group and link in the description, with the newline escaped", () => {
    expect(unfold(ics)).toContain("DESCRIPTION:Roommates · Planned with Group Cal\\nhttps://example.com/p/abc\r\n");
  });

  it("writes repeating plans in local time with the timezone and a repeat rule", () => {
    const repeating = icsFile(weekly);
    expect(repeating).toContain("DTSTART;TZID=America/New_York:20261001T190000\r\n");
    expect(repeating).toContain("DTEND;TZID=America/New_York:20261001T213000\r\n");
    expect(repeating).toContain("RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TH;WKST=SU;COUNT=4\r\n");
    expect(ics).not.toContain("RRULE");
  });

  it("leaves out cancelled dates and adds edited ones as their own entry", () => {
    const oct8 = new Date("2026-10-08T23:00:00Z");
    const oct15 = new Date("2026-10-15T23:00:00Z");
    const none = { title: null, location: null, notes: null, start: null, end: null };
    const out = unfold(
      icsFile(weekly, [
        { ...none, originalStart: oct8, cancelled: true },
        { ...none, originalStart: oct15, cancelled: false, title: "Tacos", start: new Date("2026-10-16T00:00:00Z") },
      ]),
    );
    expect(out).toContain("EXDATE;TZID=America/New_York:20261008T190000\r\n");
    expect(out).toContain("RECURRENCE-ID;TZID=America/New_York:20261015T190000\r\n");
    expect(out).toContain("DTSTART;TZID=America/New_York:20261015T200000\r\n"); // moved an hour later
    expect(out).toContain("SUMMARY:Tacos\r\n");
    expect(out.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it("includes the location only when set, escaped", () => {
    expect(icsFile({ ...plan, location: "Joe's, 7 Carmine St" })).toContain("LOCATION:Joe's\\, 7 Carmine St\r\n");
    expect(ics).not.toContain("LOCATION");
  });

  it("escapes special characters in the title", () => {
    const tricky = icsFile({ ...plan, title: "Tacos; drinks, then\nbowling \\o/" });
    expect(tricky).toContain("SUMMARY:Tacos\\; drinks\\, then\\nbowling \\\\o/\r\n");
  });

  it("folds long lines to at most 75 bytes, even with emoji", () => {
    const long = icsFile({ ...plan, title: "🎉".repeat(40) + " birthday party for everyone we know" });
    const encoder = new TextEncoder();
    for (const line of long.split("\r\n")) expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    expect(unfold(long)).toContain("SUMMARY:" + "🎉".repeat(40) + " birthday party");
  });
});
