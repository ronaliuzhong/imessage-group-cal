// Checking what someone typed into the plan form, before it's saved. Used by
// the create and edit Server Actions; pure, so it's unit tested.

import {
  isValidTimeZone,
  localDate,
  localWeekday,
  MAX_COUNT,
  MAX_INTERVAL,
  seriesEnd,
  type Frequency,
} from "@/lib/recurrence";

export type RepeatInput = {
  freq: Frequency;
  interval: number;
  weekdays: number[]; // WEEKLY: 0 = Sunday … 6 = Saturday
  ends: "never" | "on" | "after";
  untilDate: string; // "YYYY-MM-DD", when ends = "on"
  count: number; // when ends = "after"
};

// What the browser sends. Everything is re-checked here: a Server Action is
// a public endpoint, so the form's own limits can't be trusted.
export type PlanInput = {
  title: string;
  start: string; // ISO timestamp
  durationMinutes: number;
  location: string;
  notes: string;
  timeZone: string; // the browser's timezone, e.g. "America/New_York"
  repeat: RepeatInput | null; // null = doesn't repeat
};

// Ready to save on a Plan row.
export type PlanFields = {
  title: string;
  location: string | null;
  notes: string | null;
  start: Date;
  end: Date;
  timeZone: string;
  repeatFreq: Frequency | null;
  repeatInterval: number;
  repeatWeekdays: number[];
  repeatUntil: string | null;
  repeatCount: number | null;
  seriesEnd: Date | null;
};

const MAX_PLAN_MINUTES = 24 * 60;
const FREQUENCIES: Frequency[] = ["DAILY", "WEEKLY", "MONTHLY"];

// Trims text and turns blank into null, capped at `max` characters.
function optionalText(value: unknown, max: number): string | null {
  const text = String(value ?? "").trim().slice(0, max);
  return text || null;
}

export function parsePlanInput(input: PlanInput): { fields: PlanFields } | { error: string } {
  const title = String(input?.title ?? "").trim().slice(0, 100);
  if (!title) return { error: "Give the plan a name." };

  const start = new Date(input.start);
  if (Number.isNaN(start.getTime())) return { error: "Pick a valid start time." };

  const minutes = Number(input.durationMinutes);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > MAX_PLAN_MINUTES) {
    return { error: "Pick a valid length." };
  }
  const end = new Date(start.getTime() + minutes * 60_000);
  const timeZone = isValidTimeZone(String(input.timeZone)) ? String(input.timeZone) : "UTC";

  const repeat = parseRepeat(input.repeat, start, timeZone);
  if ("error" in repeat) return repeat;

  const timing = { start, end, timeZone, ...repeat.fields };
  return {
    fields: {
      title,
      location: optionalText(input.location, 200),
      notes: optionalText(input.notes, 1000),
      ...timing,
      seriesEnd: seriesEnd({
        start,
        end,
        timeZone,
        recurrence: timing.repeatFreq && {
          freq: timing.repeatFreq,
          interval: timing.repeatInterval,
          weekdays: timing.repeatWeekdays,
          untilDate: timing.repeatUntil,
          count: timing.repeatCount,
        },
      }),
    },
  };
}

type RepeatFields = Pick<PlanFields, "repeatFreq" | "repeatInterval" | "repeatWeekdays" | "repeatUntil" | "repeatCount">;

const NO_REPEAT: RepeatFields = {
  repeatFreq: null,
  repeatInterval: 1,
  repeatWeekdays: [],
  repeatUntil: null,
  repeatCount: null,
};

function parseRepeat(repeat: RepeatInput | null, start: Date, timeZone: string): { fields: RepeatFields } | { error: string } {
  if (!repeat) return { fields: NO_REPEAT };
  if (!FREQUENCIES.includes(repeat.freq)) return { error: "Pick how often it repeats." };

  const interval = Number(repeat.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL) {
    return { error: `Repeat every 1 to ${MAX_INTERVAL}.` };
  }

  // The first date must be one of the repeat days. The form ensures this by
  // moving the start when you untick its day; this is a safety net for
  // anything else calling the action.
  const weekdays =
    repeat.freq === "WEEKLY"
      ? [...new Set([...(repeat.weekdays ?? []).map(Number), localWeekday(start, timeZone)])]
          .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
          .sort((a, b) => a - b)
      : [];

  let repeatUntil: string | null = null;
  let repeatCount: number | null = null;
  if (repeat.ends === "on") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(repeat.untilDate))) return { error: "Pick when it stops repeating." };
    if (repeat.untilDate < localDate(start, timeZone)) return { error: "It can't stop repeating before it starts." };
    repeatUntil = repeat.untilDate;
  } else if (repeat.ends === "after") {
    const count = Number(repeat.count);
    if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
      return { error: `Repeat between 1 and ${MAX_COUNT} times.` };
    }
    // "Repeat 1 time" is just a one-time plan.
    if (count === 1) return { fields: NO_REPEAT };
    repeatCount = count;
  } else if (repeat.ends !== "never") {
    return { error: "Pick when it stops repeating." };
  }

  return { fields: { repeatFreq: repeat.freq, repeatInterval: interval, repeatWeekdays: weekdays, repeatUntil, repeatCount } };
}

// Did the repeat pattern (not just the details) change? Used to refuse
// repeat changes when editing a single date.
type RepeatFieldsLoose = Omit<RepeatFields, "repeatFreq"> & { repeatFreq: string | null };

export function repeatChanged(a: RepeatFieldsLoose, b: RepeatFieldsLoose): boolean {
  return (
    a.repeatFreq !== b.repeatFreq ||
    a.repeatInterval !== b.repeatInterval ||
    a.repeatWeekdays.join() !== b.repeatWeekdays.join() ||
    a.repeatUntil !== b.repeatUntil ||
    a.repeatCount !== b.repeatCount
  );
}
