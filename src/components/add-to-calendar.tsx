"use client";

import { useSyncExternalStore } from "react";
import { googleCalendarUrl } from "@/lib/plan-links";

const noopSubscribe = () => () => {};

// The plan, with dates as ISO strings since it comes from the server.
export type SerializedPlan = {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string | null;
  notes: string | null;
  timeZone: string;
  repeatFreq: string | null;
  repeatInterval: number;
  repeatWeekdays: number[];
  repeatUntil: string | null;
  repeatCount: number | null;
  shareCode: string;
  groupName: string;
};

// Manual "add to my calendar" buttons, for people who aren't signed in (or
// use Apple Calendar). Signed-in people get plans added automatically when
// they tap Going, so the Google button is hidden for them. Built in the
// browser so the link back to the plan uses whatever address this site is on.
export function AddToCalendar({ plan, includeGoogle }: { plan: SerializedPlan; includeGoogle: boolean }) {
  const origin = useSyncExternalStore(noopSubscribe, () => window.location.origin, () => "");
  const path = `/p/${plan.shareCode}`;
  const googleUrl = googleCalendarUrl({
    ...plan,
    start: new Date(plan.start),
    end: new Date(plan.end),
    url: origin + path,
  });

  const buttonClass =
    "rounded-lg border border-zinc-300 px-4 py-2 text-center font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900";
  return (
    <div className="flex flex-wrap gap-2">
      {includeGoogle && (
        <a href={googleUrl} target="_blank" rel="noopener noreferrer" className={buttonClass}>
          Add to Google Calendar
        </a>
      )}
      {/* A .ics file: iPhones and Macs open it straight into Apple Calendar. */}
      <a href={`${path}/calendar.ics`} className={buttonClass}>
        Add to Apple Calendar
      </a>
    </div>
  );
}
