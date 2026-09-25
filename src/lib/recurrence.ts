// Repeating plans: pure date math, no database, so it's unit tested.
//
// The options mirror Google Calendar's "Custom recurrence": repeat every N
// days / weeks / months, on chosen weekdays (for weeks), ending never, on a
// date, or after N times. Occurrences happen at the same *local* time in the
// organizer's timezone, so a 7pm dinner stays at 7pm after the clocks change
// for daylight saving (the gap between occurrences isn't always a whole
// number of 24-hour days).
//
// Each occurrence is identified by its original start time ("originalStart"),
// like Google does. That's what per-date RSVPs and one-off edits refer to.

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY";

export type Recurrence = {
  freq: Frequency;
  interval: number; // every N days / weeks / months
  weekdays: number[]; // WEEKLY only: 0 = Sunday … 6 = Saturday
  untilDate: string | null; // last allowed local date, "YYYY-MM-DD"
  count: number | null; // total occurrences
};

export type RepeatRule = {
  start: Date; // first occurrence
  end: Date; // end of first occurrence
  timeZone: string; // IANA name, e.g. "America/New_York"
  recurrence: Recurrence | null; // null = happens once
};

export type Occurrence = { originalStart: Date; start: Date; end: Date };

export const MAX_INTERVAL = 30;
export const MAX_COUNT = 100;
// A safety net so a "never ends" daily plan can't loop forever.
const MAX_STEPS = 5000;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

// The wall-clock time a moment shows in a timezone.
function wallClock(date: Date, timeZone: string): WallClock {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, Number(p.value)]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

// "20261001T190000": a wall-clock time in the compact calendar-file format.
export function wallClockStamp(date: Date, timeZone: string): string {
  const w = wallClock(date, timeZone);
  return `${w.year}${pad(w.month)}${pad(w.day)}T${pad(w.hour)}${pad(w.minute)}${pad(w.second)}`;
}

// "2026-10-01": the local date of a moment in a timezone.
export function localDate(date: Date, timeZone: string): string {
  const w = wallClock(date, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

// Day of the week (0 = Sunday) of a moment, in a timezone.
export function localWeekday(date: Date, timeZone: string): number {
  const w = wallClock(date, timeZone);
  return new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
}

// How far ahead of UTC the timezone's clocks are at that moment, in ms.
function utcOffsetMs(date: Date, timeZone: string): number {
  const w = wallClock(date, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(date.getTime() / 1000) * 1000;
}

// The moment a local wall-clock time happens in a timezone. (`day` may run
// past the end of the month; Date.UTC rolls it over.)
function fromWallClock(w: WallClock, timeZone: string): Date {
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  // The offset depends on the answer (it differs either side of a DST
  // change), so guess, then refine once.
  let guess = asIfUtc - utcOffsetMs(new Date(asIfUtc), timeZone);
  guess = asIfUtc - utcOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

// The same local time-of-day, `days` later, in the given timezone.
export function addDaysInTimeZone(date: Date, days: number, timeZone: string): Date {
  const w = wallClock(date, timeZone);
  return new Date(fromWallClock({ ...w, day: w.day + days }, timeZone).getTime() + (date.getTime() % 1000));
}

// The last moment of a local date ("YYYY-MM-DD") in a timezone.
export function endOfLocalDate(date: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(fromWallClock({ year, month, day: day + 1, hour: 0, minute: 0, second: 0 }, timeZone).getTime() - 1000);
}

// Generates occurrence start times in order. Stops at the rule's own end, at
// `stopAfter` (a moment), or after MAX_STEPS candidates, whichever is first.
function* occurrenceStarts(rule: RepeatRule, stopAfter?: Date): Generator<Date> {
  const r = rule.recurrence;
  if (!r) {
    yield rule.start;
    return;
  }
  const w = wallClock(rule.start, rule.timeZone);
  const startDate = localDate(rule.start, rule.timeZone);
  const startWeekday = localWeekday(rule.start, rule.timeZone);
  const weekdays = [...new Set(r.weekdays)].sort((a, b) => a - b);
  let produced = 0;

  const candidate = (dayOffset: number, monthOffset = 0): Date | null => {
    if (monthOffset) {
      // Monthly: same day number. Months without it (e.g. the 31st in
      // April) are skipped, matching Google and the calendar standard.
      const monthIndex = w.month - 1 + monthOffset;
      const probe = new Date(Date.UTC(w.year, monthIndex, w.day));
      if (probe.getUTCDate() !== w.day) return null;
      return fromWallClock({ ...w, year: probe.getUTCFullYear(), month: probe.getUTCMonth() + 1 }, rule.timeZone);
    }
    return fromWallClock({ ...w, day: w.day + dayOffset }, rule.timeZone);
  };

  for (let step = 0; step < MAX_STEPS; step++) {
    // Candidates for this step, in time order.
    let batch: (Date | null)[];
    if (r.freq === "DAILY") {
      batch = [candidate(step * r.interval)];
    } else if (r.freq === "WEEKLY") {
      // Weeks run Sunday–Saturday. Step N covers the week N×interval weeks
      // after the start's week.
      const weekStartOffset = step * 7 * r.interval - startWeekday;
      batch = (weekdays.length ? weekdays : [startWeekday]).map((d) => candidate(weekStartOffset + d));
    } else {
      batch = [candidate(0, step * r.interval)];
    }

    for (const start of batch) {
      if (!start) continue;
      if (localDate(start, rule.timeZone) < startDate) continue; // earlier in the first week
      if (r.untilDate && localDate(start, rule.timeZone) > r.untilDate) return;
      if (stopAfter && start > stopAfter) return;
      yield start;
      produced++;
      if (r.count && produced >= r.count) return;
    }
  }
}

// Occurrences overlapping [from, to).
export function occurrencesBetween(rule: RepeatRule, from: Date, to: Date): Occurrence[] {
  const duration = rule.end.getTime() - rule.start.getTime();
  const result: Occurrence[] = [];
  for (const start of occurrenceStarts(rule, to)) {
    const end = new Date(start.getTime() + duration);
    if (start < to && end > from) result.push({ originalStart: start, start, end });
  }
  return result;
}

// The first `limit` occurrences that haven't ended by `after`.
export function upcomingOccurrences(rule: RepeatRule, after: Date, limit: number): Occurrence[] {
  const duration = rule.end.getTime() - rule.start.getTime();
  const result: Occurrence[] = [];
  for (const start of occurrenceStarts(rule)) {
    const end = new Date(start.getTime() + duration);
    if (end > after) result.push({ originalStart: start, start, end });
    if (result.length >= limit) break;
  }
  return result;
}

// Is `moment` exactly when one of the plan's occurrences starts?
export function isOccurrenceStart(rule: RepeatRule, moment: Date): boolean {
  for (const start of occurrenceStarts(rule, moment)) {
    if (start.getTime() === moment.getTime()) return true;
  }
  return false;
}

// When the last occurrence ends, or null if the plan repeats forever.
export function seriesEnd(rule: RepeatRule): Date | null {
  const r = rule.recurrence;
  if (r && !r.count && !r.untilDate) return null;
  let last = rule.start;
  for (const start of occurrenceStarts(rule)) last = start;
  return new Date(last.getTime() + (rule.end.getTime() - rule.start.getTime()));
}

// How many occurrences start before `moment`.
export function countBefore(rule: RepeatRule, moment: Date): number {
  let n = 0;
  for (const start of occurrenceStarts(rule, moment)) if (start < moment) n++;
  return n;
}

const RRULE_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

// The standard repeat rule text shared by Google Calendar and .ics files,
// e.g. "RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE;WKST=SU;COUNT=6".
export function rrule(rule: RepeatRule): string | null {
  const r = rule.recurrence;
  if (!r) return null;
  const parts = [`FREQ=${r.freq}`, `INTERVAL=${r.interval}`];
  if (r.freq === "WEEKLY") {
    const days = r.weekdays.length ? r.weekdays : [localWeekday(rule.start, rule.timeZone)];
    parts.push(`BYDAY=${[...new Set(days)].sort((a, b) => a - b).map((d) => RRULE_DAYS[d]).join(",")}`);
    // Our weeks start on Sunday; saying so keeps "every 2 weeks" in step.
    parts.push("WKST=SU");
  }
  if (r.count) parts.push(`COUNT=${r.count}`);
  // The standard wants UNTIL as a UTC time: the end of that local day.
  else if (r.untilDate) {
    parts.push(`UNTIL=${endOfLocalDate(r.untilDate, rule.timeZone).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
  }
  return `RRULE:${parts.join(";")}`;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FULL_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// "Weekly on Mon, Wed · 6 times", "Every 2 weeks on Thursday · until Dec 1",
// "Daily", "Monthly on day 15". Null if it doesn't repeat.
export function repeatLabel(rule: RepeatRule): string | null {
  const r = rule.recurrence;
  if (!r) return null;
  const unit = { DAILY: "day", WEEKLY: "week", MONTHLY: "month" }[r.freq];
  let text =
    r.interval === 1 ? { DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly" }[r.freq] : `Every ${r.interval} ${unit}s`;

  if (r.freq === "WEEKLY") {
    const days = [...new Set(r.weekdays.length ? r.weekdays : [localWeekday(rule.start, rule.timeZone)])].sort();
    const isWeekdays = days.join() === "1,2,3,4,5";
    text += isWeekdays
      ? " on weekdays"
      : ` on ${days.length === 1 ? FULL_DAY_NAMES[days[0]] : days.map((d) => DAY_NAMES[d]).join(", ")}`;
  } else if (r.freq === "MONTHLY") {
    text += ` on day ${Number(localDate(rule.start, rule.timeZone).slice(8))}`;
  }

  if (r.count) text += ` · ${r.count} times`;
  else if (r.untilDate) {
    const [y, m, d] = r.untilDate.split("-").map(Number);
    const until = new Date(Date.UTC(y, m - 1, d));
    text += ` · until ${until.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
  }
  return text;
}
