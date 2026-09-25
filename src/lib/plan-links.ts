// Builders for "add to calendar" links. Pure functions, so they're unit tested.

import { ruleOf, type ExceptionRow, type PlanDetails } from "@/lib/plan-occurrences";
import { rrule, wallClockStamp } from "@/lib/recurrence";

export type PlanForCalendar = PlanDetails & {
  id: string;
  url: string; // the plan page, included in the event description
  groupName: string;
};

// The event description, shared with the events we add to Google Calendar
// automatically: the notes first, then which group and a link.
export function planDescription(plan: { notes: string | null; groupName: string; url: string }): string {
  const footer = `${plan.groupName} · Planned with Group Cal\n${plan.url}`;
  return plan.notes ? `${plan.notes}\n\n${footer}` : footer;
}

// Opens the location in Google Maps (works on phones and computers).
export function mapsUrl(location: string): string {
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", location);
  return url.toString();
}

// 2026-10-01T23:00:00.000Z -> 20261001T230000Z (the compact UTC format both
// Google Calendar links and .ics files use; UTC means no timezone confusion).
export function toCalendarTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// Opens Google Calendar's "new event" screen with everything filled in; the
// person just taps Save. Needs no permissions from us. (One-off changes to
// single dates can't be expressed in this link, only the basic pattern.)
export function googleCalendarUrl(plan: PlanForCalendar): string {
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", plan.title);
  url.searchParams.set("dates", `${toCalendarTimestamp(plan.start)}/${toCalendarTimestamp(plan.end)}`);
  url.searchParams.set("details", planDescription(plan));
  if (plan.location) url.searchParams.set("location", plan.location);
  const repeat = rrule(ruleOf(plan));
  if (repeat) {
    url.searchParams.set("recur", repeat);
    // Repeats follow this timezone's clock, so daylight saving is handled.
    url.searchParams.set("ctz", plan.timeZone);
  }
  return url.toString();
}

// iCalendar text needs backslashes, semicolons, commas and newlines escaped.
function escapeIcsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// The format caps lines at 75 bytes; longer ones continue on the next line,
// which starts with a space. Splitting by bytes (not characters) matters for
// emoji and accented letters, which take several bytes each.
function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const pieces: string[] = [];
  let current = "";
  for (const char of line) {
    const limit = pieces.length === 0 ? 75 : 74; // continuation lines lose 1 byte to the space
    if (encoder.encode(current + char).length > limit) {
      pieces.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  pieces.push(current);
  return pieces.join("\r\n ");
}

// A standard .ics calendar file: Apple Calendar (and Outlook, and Google)
// open it as a one-tap "add event". For repeating plans, cancelled dates are
// left out (EXDATE) and edited dates get their own entry (RECURRENCE-ID).
export function icsFile(plan: PlanForCalendar, exceptions: ExceptionRow[] = [], now = new Date()): string {
  const repeat = rrule(ruleOf(plan));
  const tz = plan.timeZone;
  // Repeating plans are written in the organizer's local time with its
  // timezone name, so every repeat stays at the same local time across
  // daylight-saving changes. One-time plans just use UTC.
  const at = (name: string, date: Date) =>
    repeat ? `${name};TZID=${tz}:${wallClockStamp(date, tz)}` : `${name}:${toCalendarTimestamp(date)}`;

  const eventLines = (details: { title: string; location: string | null; notes: string | null }, extra: string[]) => [
    "BEGIN:VEVENT",
    // Stable ID: re-adding the same plan updates the event instead of duplicating it.
    `UID:${plan.id}@groupcal`,
    `DTSTAMP:${toCalendarTimestamp(now)}`,
    ...extra,
    `SUMMARY:${escapeIcsText(details.title)}`,
    ...(details.location ? [`LOCATION:${escapeIcsText(details.location)}`] : []),
    `DESCRIPTION:${escapeIcsText(planDescription({ ...plan, notes: details.notes }))}`,
    `URL:${plan.url}`,
    "END:VEVENT",
  ];

  const cancelled = repeat ? exceptions.filter((e) => e.cancelled) : [];
  const edited = repeat ? exceptions.filter((e) => !e.cancelled) : [];
  const duration = plan.end.getTime() - plan.start.getTime();

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Group Cal//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...eventLines(plan, [
      at("DTSTART", plan.start),
      at("DTEND", plan.end),
      ...(repeat ? [repeat] : []),
      ...cancelled.map((e) => at("EXDATE", e.originalStart)),
    ]),
    ...edited.flatMap((e) => {
      const start = e.start ?? e.originalStart;
      const end = e.end ?? new Date(start.getTime() + duration);
      return eventLines(
        {
          title: e.title ?? plan.title,
          location: e.location === null ? plan.location : e.location || null,
          notes: e.notes === null ? plan.notes : e.notes || null,
        },
        [at("RECURRENCE-ID", e.originalStart), at("DTSTART", start), at("DTEND", end)],
      );
    }),
    "END:VCALENDAR",
  ];
  // The spec requires CRLF line endings, including after the last line.
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
