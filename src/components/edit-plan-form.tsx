"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelPlan, updatePlan, type EditScope } from "@/app/actions";
import { draftToInput, PlanFormFields, type PlanDraft } from "@/components/plan-form-fields";

// The plan's current details, with the start as an ISO string since it comes
// from the server.
export type EditablePlan = Omit<PlanDraft, "start"> & { start: string };

export function EditPlanForm({
  planId,
  code,
  occurrence,
  initial,
}: {
  planId: string;
  code: string;
  occurrence: string | null; // the date being edited (repeating plans only)
  initial: EditablePlan;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<PlanDraft>({ ...initial, start: new Date(initial.start) });
  const [error, setError] = useState<string | null>(null);
  // For repeating plans: which "which dates?" question is open, if any.
  const [asking, setAsking] = useState<"save" | "cancel" | null>(null);
  const [busy, startTransition] = useTransition();
  const repeating = occurrence !== null;
  const repeatChanged = JSON.stringify(draft.repeat) !== JSON.stringify(initial.repeat);

  function save(scope: EditScope) {
    setAsking(null);
    setError(null);
    startTransition(async () => {
      const result = await updatePlan(planId, draftToInput(draft), scope, occurrence);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      // "This and following" continues as a new plan with its own link.
      const sameDate = scope === "this" && occurrence ? `?at=${encodeURIComponent(occurrence)}` : "";
      router.push(`/p/${result.shareCode}${sameDate}`);
    });
  }

  function cancel(scope: EditScope) {
    setAsking(null);
    startTransition(() => cancelPlan(planId, scope, occurrence));
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (repeating) setAsking("save");
          else save("all");
        }}
        className="flex flex-col gap-3"
      >
        <PlanFormFields draft={draft} onChange={setDraft} />
        <p className="text-xs text-zinc-500">
          Saving updates the plan on the Google Calendar of everyone who&apos;s going.
        </p>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
          <Link href={`/p/${code}`} className="text-sm text-zinc-500 underline">
            Never mind
          </Link>
        </div>
      </form>

      {asking === "save" && (
        <ScopeQuestion
          title="Save changes to…"
          disableThis={repeatChanged}
          disableThisReason="Changes to how it repeats can't apply to just one date."
          onChoose={save}
          onClose={() => setAsking(null)}
        />
      )}

      <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
        {asking === "cancel" ? (
          <ScopeQuestion title="Cancel…" onChoose={cancel} onClose={() => setAsking(null)} destructive />
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (repeating) setAsking("cancel");
              else if (window.confirm("Cancel this plan for everyone? It'll be taken off everyone's Google Calendar.")) {
                cancel("all");
              }
            }}
            className="text-sm text-red-600 underline hover:text-red-700 disabled:opacity-60 dark:text-red-400"
          >
            {busy ? "Working…" : "Cancel this plan"}
          </button>
        )}
      </div>
    </div>
  );
}

// "This event / This and following events / All events", like Google Calendar.
function ScopeQuestion({
  title,
  onChoose,
  onClose,
  disableThis = false,
  disableThisReason,
  destructive = false,
}: {
  title: string;
  onChoose: (scope: EditScope) => void;
  onClose: () => void;
  disableThis?: boolean;
  disableThisReason?: string;
  destructive?: boolean;
}) {
  const [scope, setScope] = useState<EditScope>(disableThis ? "following" : "this");
  const options: { value: EditScope; label: string }[] = [
    { value: "this", label: "This event" },
    { value: "following", label: "This and following events" },
    { value: "all", label: "All events" },
  ];
  return (
    <div role="dialog" aria-label={title} className="flex flex-col gap-3 rounded-xl border border-zinc-300 p-4 dark:border-zinc-700">
      <p className="font-medium">{title}</p>
      <div className="flex flex-col gap-1.5 text-sm">
        {options.map((option) => {
          const disabled = option.value === "this" && disableThis;
          return (
            <label key={option.value} className={`flex items-center gap-2 ${disabled ? "text-zinc-400" : ""}`}>
              <input
                type="radio"
                name="scope"
                checked={scope === option.value}
                disabled={disabled}
                onChange={() => setScope(option.value)}
              />
              {option.label}
            </label>
          );
        })}
        {disableThis && disableThisReason && <p className="text-xs text-zinc-500">{disableThisReason}</p>}
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => onChoose(scope)}
          className={`rounded-lg px-4 py-1.5 font-medium text-white ${
            destructive ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"
          }`}
        >
          {destructive ? "Cancel them" : "OK"}
        </button>
        <button type="button" onClick={onClose} className="text-sm text-zinc-500 underline">
          Never mind
        </button>
      </div>
    </div>
  );
}
