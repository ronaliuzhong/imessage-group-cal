"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { undoCancel } from "@/app/actions";

const SHOW_MS = 5000;
const noopSubscribe = () => () => {};
const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });

// The note shown after cancelling a plan, with "Undo" for 5 seconds.
export function CancelToast({
  undoId,
  title,
  scope,
  date,
}: {
  undoId: string;
  title: string;
  scope: "all" | "this" | "following";
  date: string | null; // ISO; which date was cancelled (repeating plans)
}) {
  const [phase, setPhase] = useState<"shown" | "undone" | "error" | "hidden">("shown");
  const [undoing, startTransition] = useTransition();
  // Dates are shown in the viewer's timezone, which only the browser knows.
  const dateLabel = useSyncExternalStore(
    noopSubscribe,
    () => (date ? dateFormat.format(new Date(date)) : ""),
    () => "",
  );

  // Take ?undo=… out of the address bar, so refreshing doesn't show the note
  // again. (replaceState changes the URL without reloading the page.)
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("undo");
    window.history.replaceState(window.history.state, "", url);
  }, []);

  // Hide after a few seconds, unless an undo is in progress.
  useEffect(() => {
    if (phase === "hidden" || undoing) return;
    const timer = setTimeout(() => setPhase("hidden"), phase === "shown" ? SHOW_MS : 3000);
    return () => clearTimeout(timer);
  }, [phase, undoing]);

  if (phase === "hidden") return null;

  const what =
    scope === "this" && dateLabel
      ? `“${title}” on ${dateLabel}`
      : scope === "following" && dateLabel
        ? `“${title}” from ${dateLabel} on`
        : `“${title}”`;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit max-w-[90vw] items-center gap-4 rounded-xl bg-zinc-900 px-4 py-3 text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
    >
      {phase === "shown" && (
        <>
          <span>Cancelled {what}.</span>
          <button
            type="button"
            disabled={undoing}
            onClick={() =>
              startTransition(async () => {
                const result = await undoCancel(undoId);
                setPhase("error" in result ? "error" : "undone");
              })
            }
            className="font-semibold text-emerald-400 hover:text-emerald-300 disabled:opacity-60 dark:text-emerald-700"
          >
            {undoing ? "Undoing…" : "Undo"}
          </button>
        </>
      )}
      {phase === "undone" && <span>Restored {what}.</span>}
      {phase === "error" && <span>It&apos;s too late to undo that.</span>}
    </div>
  );
}
