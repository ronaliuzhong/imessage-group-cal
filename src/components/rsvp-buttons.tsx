"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { setRsvp } from "@/app/actions";

type Response = "GOING" | "NOT_GOING";

const noopSubscribe = () => () => {};
const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });

// "Thu, Oct 1" in the viewer's own timezone (the server doesn't know it, so
// it renders a generic label until the browser takes over).
function useDateLabel(iso: string | null) {
  return useSyncExternalStore(
    noopSubscribe,
    () => (iso ? dateFormat.format(new Date(iso)) : ""),
    () => "this date",
  );
}

// Going / Can't make it. For repeating plans, tapping one asks whether it's
// for just this date or every date (like Google Calendar).
export function RsvpButtons({
  planId,
  occurrence,
  occurrenceStart,
  myResponse,
  answeredAll,
}: {
  planId: string;
  occurrence: string | null; // ISO original start of the date shown; null = not a repeating plan
  occurrenceStart: string | null; // ISO start of that date as it happens (after any one-off change)
  myResponse: Response | null; // your answer for the date shown
  answeredAll: boolean; // your answer comes from answering "all of them"
}) {
  const [asking, setAsking] = useState<Response | null>(null);
  const dateLabel = useDateLabel(occurrenceStart);
  const [saving, startTransition] = useTransition();

  function answer(response: Response, justThisOne: boolean) {
    setAsking(null);
    startTransition(() => setRsvp(planId, response, justThisOne ? occurrence : null));
  }

  function choose(response: Response) {
    if (occurrence) setAsking(response); // repeating: ask which dates
    else answer(response, false);
  }

  const button = (response: Response, label: string) => {
    const selected = myResponse === response;
    const style = selected
      ? response === "GOING"
        ? "border-emerald-600 bg-emerald-600 text-white"
        : "border-zinc-700 bg-zinc-700 text-white"
      : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900";
    return (
      <button
        type="button"
        disabled={saving}
        onClick={() => choose(response)}
        className={`rounded-lg border px-4 py-2 font-medium disabled:cursor-wait disabled:opacity-60 ${style}`}
      >
        {selected && "✓ "}
        {label}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        {button("GOING", "Going")}
        {button("NOT_GOING", "Can't make it")}
        {saving && <span className="self-center text-sm text-zinc-500">Saving…</span>}
      </div>

      {occurrence && myResponse && !asking && (
        <p className="text-xs text-zinc-500">
          {answeredAll ? "Your answer for every date." : `Your answer for ${dateLabel} only.`}
        </p>
      )}

      {asking && (
        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <p className="font-medium">{asking === "GOING" ? "Going to…" : "Can't make…"}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => answer(asking, true)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Just this one ({dateLabel})
            </button>
            <button
              type="button"
              onClick={() => answer(asking, false)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              All of them
            </button>
            <button type="button" onClick={() => setAsking(null)} className="px-2 text-zinc-500 underline">
              Never mind
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
