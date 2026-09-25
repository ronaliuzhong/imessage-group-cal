"use client";

import { useTransition } from "react";
import { setCalendarIncluded } from "@/app/actions";
import type { UserCalendar } from "@/lib/google";

// Checklist of the user's Google calendars. Checked = counts as busy time.
// Only the user sees these names; groups only ever see busy/free.
export function CalendarSettings({ calendars }: { calendars: UserCalendar[] }) {
  // useTransition tracks the save-and-refresh so we can disable the boxes
  // while it's in flight.
  const [saving, startTransition] = useTransition();

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-medium">Your calendars</h2>
      <p className="text-sm text-zinc-500">
        Checked calendars count as busy. Friends never see these names.
      </p>
      <ul className={`flex flex-col gap-1.5 ${saving ? "opacity-60" : ""}`}>
        {calendars.map((calendar) => (
          <li key={calendar.id}>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 accent-emerald-600"
                defaultChecked={calendar.included}
                disabled={saving}
                onChange={(e) => {
                  const included = e.target.checked;
                  startTransition(() => setCalendarIncluded(calendar.id, included));
                }}
              />
              <span>
                {calendar.name}
                {calendar.primary && <span className="text-zinc-500"> (main)</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
