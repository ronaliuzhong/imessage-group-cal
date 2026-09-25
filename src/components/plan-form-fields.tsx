"use client";

import { useState } from "react";
import type { PlanInput, RepeatInput } from "@/lib/plan-input";
import { MAX_COUNT, MAX_INTERVAL, repeatLabel, type Frequency } from "@/lib/recurrence";

// What the plan form is editing. `start` is a Date so the calendar can
// outline the range as you change it.
export type PlanDraft = {
  title: string;
  start: Date;
  durationMinutes: number;
  location: string;
  notes: string;
  repeat: RepeatInput | null; // null = doesn't repeat
};

export function emptyDraft(start: Date): PlanDraft {
  return { title: "", start, durationMinutes: 60, location: "", notes: "", repeat: null };
}

export function draftEnd(draft: PlanDraft): Date {
  return new Date(draft.start.getTime() + draft.durationMinutes * 60_000);
}

// The browser's own timezone, e.g. "America/New_York".
function browserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// What gets sent to the server.
export function draftToInput(draft: PlanDraft): PlanInput {
  return {
    title: draft.title,
    start: draft.start.toISOString(),
    durationMinutes: draft.durationMinutes,
    location: draft.location,
    notes: draft.notes,
    timeZone: browserTimeZone(),
    repeat: draft.repeat,
  };
}

const DURATIONS = [30, 60, 90, 120, 180, 240, 360];

function durationLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

// "2026-10-01T19:30" in local time: the format <input type="datetime-local"> uses.
function toInputValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${toTimePart(date)}`;
}
function toTimePart(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
// "2026-10-01": a local date, the format <input type="date"> uses.
function toDateValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// The quick choices in the repeat menu, like Google Calendar's.
type Preset = "none" | "daily" | "weekly" | "weekdays" | "monthly" | "custom";

function presetRepeat(preset: Preset, start: Date): RepeatInput | null {
  const base = { interval: 1, weekdays: [] as number[], ends: "never" as const, untilDate: "", count: 10 };
  switch (preset) {
    case "daily":
      return { ...base, freq: "DAILY" };
    case "weekly":
      return { ...base, freq: "WEEKLY", weekdays: [start.getDay()] };
    case "weekdays":
      return { ...base, freq: "WEEKLY", weekdays: [1, 2, 3, 4, 5] };
    case "monthly":
      return { ...base, freq: "MONTHLY" };
    default:
      return null;
  }
}

// Which quick choice (if any) a repeat setting matches.
function presetOf(repeat: RepeatInput | null, start: Date): Preset {
  if (!repeat) return "none";
  for (const preset of ["daily", "weekly", "weekdays", "monthly"] as const) {
    const p = presetRepeat(preset, start)!;
    if (
      repeat.freq === p.freq &&
      repeat.interval === 1 &&
      repeat.ends === "never" &&
      [...repeat.weekdays].sort().join() === [...p.weekdays].sort().join()
    ) {
      return preset;
    }
  }
  return "custom";
}

// The weekdays a weekly repeat is on (none picked = just the start's day).
function selectedDays(repeat: RepeatInput, start: Date): number[] {
  return repeat.weekdays.length ? repeat.weekdays : [start.getDay()];
}

// Moves the draft's start. A quick repeat choice follows it, so "Weekly on
// Thursday" becomes "Weekly on Friday" if the start moves to a Friday. With
// custom weekdays, the new start's day gets added: the first date should
// always be one of the days it repeats on.
export function withStart(draft: PlanDraft, start: Date): PlanDraft {
  const preset = presetOf(draft.repeat, draft.start);
  let repeat = draft.repeat;
  if (preset !== "none" && preset !== "custom") {
    repeat = presetRepeat(preset, start);
  } else if (repeat?.freq === "WEEKLY" && !selectedDays(repeat, draft.start).includes(start.getDay())) {
    repeat = { ...repeat, weekdays: [...selectedDays(repeat, draft.start), start.getDay()] };
  }
  return { ...draft, start, repeat };
}

// Changes the repeat. If the start's day is no longer one of the weekly
// repeat days (e.g. you unticked it), the start moves to the next day that
// is, at the same time, so the first date fits the pattern.
function withRepeat(draft: PlanDraft, repeat: RepeatInput | null): PlanDraft {
  if (repeat?.freq !== "WEEKLY") return { ...draft, repeat };
  const days = selectedDays(repeat, draft.start);
  let start = draft.start;
  for (let i = 1; i <= 7 && !days.includes(start.getDay()); i++) {
    const s = draft.start;
    start = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i, s.getHours(), s.getMinutes());
  }
  return { ...draft, start, repeat };
}

// The plan form's fields, shared by "propose a time" and "edit plan". The
// parent owns the draft, so it can react as it changes (e.g. the calendar
// outline, or the "who's free" check).
export function PlanFormFields({
  draft,
  onChange,
  allowRepeatChange = true,
}: {
  draft: PlanDraft;
  onChange: (draft: PlanDraft) => void;
  allowRepeatChange?: boolean;
}) {
  const set = (changes: Partial<PlanDraft>) => onChange({ ...draft, ...changes });
  const inputClass = "rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700";
  // When editing, keep an unusual existing length selectable.
  const durations = DURATIONS.includes(draft.durationMinutes)
    ? DURATIONS
    : [...DURATIONS, draft.durationMinutes].sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-3">
      <input
        autoFocus
        required
        maxLength={100}
        value={draft.title}
        onChange={(e) => set({ title: e.target.value })}
        placeholder="What's the plan? e.g. Dinner at Joe's"
        aria-label="Plan name"
        className={inputClass}
      />

      <div className="flex flex-wrap gap-3">
        <input
          type="datetime-local"
          required
          value={toInputValue(draft.start)}
          onChange={(e) => {
            const picked = new Date(e.target.value);
            if (!Number.isNaN(picked.getTime())) onChange(withStart(draft, picked));
          }}
          aria-label="Start time"
          className={inputClass}
        />
        <select
          value={draft.durationMinutes}
          onChange={(e) => set({ durationMinutes: Number(e.target.value) })}
          aria-label="Length"
          className={inputClass}
        >
          {durations.map((minutes) => (
            <option key={minutes} value={minutes}>
              {durationLabel(minutes)}
            </option>
          ))}
        </select>
      </div>

      {allowRepeatChange && (
        <RepeatPicker start={draft.start} repeat={draft.repeat} onChange={(repeat) => onChange(withRepeat(draft, repeat))} />
      )}

      <input
        maxLength={200}
        value={draft.location}
        onChange={(e) => set({ location: e.target.value })}
        placeholder="Location (optional)"
        aria-label="Location"
        className={inputClass}
      />
      <textarea
        maxLength={1000}
        rows={2}
        value={draft.notes}
        onChange={(e) => set({ notes: e.target.value })}
        placeholder="Notes (optional), e.g. bring snacks"
        aria-label="Notes"
        className={`${inputClass} resize-y`}
      />
    </div>
  );
}

// "Doesn't repeat / Daily / Weekly on Thursday / Every weekday / Monthly on
// day 1 / Custom…", with Google Calendar's custom options underneath.
function RepeatPicker({
  start,
  repeat,
  onChange,
}: {
  start: Date;
  repeat: RepeatInput | null;
  onChange: (repeat: RepeatInput | null) => void;
}) {
  // Stays on "Custom…" once chosen, even if the settings happen to match a
  // quick choice, so the panel doesn't vanish mid-edit.
  const [custom, setCustom] = useState(() => presetOf(repeat, start) === "custom");
  const preset = custom ? "custom" : presetOf(repeat, start);
  const selectClass = "rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700";
  const summary =
    repeat &&
    repeatLabel({
      start,
      end: start,
      timeZone: browserTimeZone(),
      recurrence: {
        freq: repeat.freq,
        interval: repeat.interval,
        weekdays: repeat.freq === "WEEKLY" ? selectedDays(repeat, start) : [],
        untilDate: repeat.ends === "on" ? repeat.untilDate || null : null,
        count: repeat.ends === "after" ? repeat.count : null,
      },
    });

  return (
    <div className="flex flex-col gap-2">
      <select
        value={preset}
        aria-label="Repeat"
        className={`${selectClass} self-start`}
        onChange={(e) => {
          const choice = e.target.value as Preset;
          if (choice === "custom") {
            setCustom(true);
            // Start from what's set now (or "weekly on this day").
            onChange(repeat ?? presetRepeat("weekly", start));
          } else {
            setCustom(false);
            onChange(presetRepeat(choice, start));
          }
        }}
      >
        <option value="none">Doesn&apos;t repeat</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly on {WEEKDAY_NAMES[start.getDay()]}</option>
        <option value="weekdays">Every weekday (Monday to Friday)</option>
        <option value="monthly">Monthly on day {start.getDate()}</option>
        <option value="custom">Custom…</option>
      </select>

      {preset === "custom" && repeat && (
        <CustomRepeat start={start} repeat={repeat} onChange={onChange} />
      )}
      {summary && preset === "custom" && <p className="text-xs text-zinc-500">{summary}</p>}
    </div>
  );
}

function CustomRepeat({
  start,
  repeat,
  onChange,
}: {
  start: Date;
  repeat: RepeatInput;
  onChange: (repeat: RepeatInput) => void;
}) {
  const set = (changes: Partial<RepeatInput>) => onChange({ ...repeat, ...changes });
  const fieldClass = "rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700";
  const units: Record<Frequency, string> = { DAILY: "day", WEEKLY: "week", MONTHLY: "month" };
  const days = selectedDays(repeat, start);
  // A sensible default end date: three months after the start.
  const defaultUntil = toDateValue(new Date(start.getFullYear(), start.getMonth() + 3, start.getDate()));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2">
        <span>Repeat every</span>
        <input
          type="number"
          min={1}
          max={MAX_INTERVAL}
          value={repeat.interval}
          onChange={(e) => set({ interval: Math.max(1, Math.min(MAX_INTERVAL, Number(e.target.value) || 1)) })}
          aria-label="Repeat every"
          className={`${fieldClass} w-16`}
        />
        <select
          value={repeat.freq}
          onChange={(e) => set({ freq: e.target.value as Frequency })}
          aria-label="Unit"
          className={fieldClass}
        >
          {(Object.keys(units) as Frequency[]).map((freq) => (
            <option key={freq} value={freq}>
              {units[freq]}
              {repeat.interval > 1 ? "s" : ""}
            </option>
          ))}
        </select>
      </div>

      {repeat.freq === "WEEKLY" && (
        <div className="flex flex-col gap-1.5">
          <span>Repeat on</span>
          <div className="flex gap-1.5">
            {WEEKDAY_LETTERS.map((letter, day) => {
              const on = days.includes(day);
              // At least one day has to stay picked.
              const lastOne = on && days.length === 1;
              return (
                <button
                  key={day}
                  type="button"
                  aria-label={WEEKDAY_NAMES[day]}
                  aria-pressed={on}
                  disabled={lastOne}
                  title={lastOne ? "Pick another day first" : WEEKDAY_NAMES[day]}
                  onClick={() =>
                    // Unticking the start's day moves the start to the next
                    // picked day (see withRepeat).
                    set({ weekdays: on ? days.filter((d) => d !== day) : [...days, day] })
                  }
                  className={`h-8 w-8 rounded-full text-xs font-medium disabled:cursor-not-allowed ${
                    on
                      ? "bg-emerald-600 text-white"
                      : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200"
                  }`}
                >
                  {letter}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1">Ends</legend>
        <label className="flex items-center gap-2">
          <input type="radio" checked={repeat.ends === "never"} onChange={() => set({ ends: "never" })} />
          Never
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={repeat.ends === "on"}
            onChange={() => set({ ends: "on", untilDate: repeat.untilDate || defaultUntil })}
          />
          On
          <input
            type="date"
            value={repeat.untilDate || defaultUntil}
            min={toDateValue(start)}
            onChange={(e) => set({ ends: "on", untilDate: e.target.value })}
            aria-label="End date"
            className={fieldClass}
          />
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={repeat.ends === "after"} onChange={() => set({ ends: "after" })} />
          After
          <input
            type="number"
            min={1}
            max={MAX_COUNT}
            value={repeat.count}
            onChange={(e) =>
              set({ ends: "after", count: Math.max(1, Math.min(MAX_COUNT, Number(e.target.value) || 1)) })
            }
            aria-label="Number of times"
            className={`${fieldClass} w-16`}
          />
          times
        </label>
      </fieldset>
    </div>
  );
}
