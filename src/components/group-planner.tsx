"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { createPlan } from "@/app/actions";
import { CopyLink } from "@/components/copy-link";
import { draftEnd, draftToInput, emptyDraft, PlanFormFields, withStart, type PlanDraft } from "@/components/plan-form-fields";
import { WeekCalendar } from "@/components/week-calendar";
import { computeSegments } from "@/lib/availability";
import type { CalendarMember } from "@/lib/calendar-data";
import type { CalendarPlan } from "@/lib/plans";

type Props = {
  groupId: string;
  members: CalendarMember[];
  viewerId: string;
  weekOffset: number;
  plans: CalendarPlan[];
};

// The group calendar plus the "propose a time" panel. Clicking the calendar
// opens the panel at that time; the panel outlines its range on the calendar.
export function GroupPlanner({ groupId, members, viewerId, weekOffset, plans }: Props) {
  // The plan being proposed (null = panel closed).
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  // Set once a plan is created, so the panel shows its link.
  const [shareCode, setShareCode] = useState<string | null>(null);

  // Clicking a time: move the proposal there, keeping what's been typed.
  // Right after creating a plan, it starts a fresh one instead. Dragging a
  // range also sets its length.
  function pick(start: Date, durationMinutes?: number) {
    const next = draft && !shareCode ? withStart(draft, start) : emptyDraft(start);
    setDraft(durationMinutes ? { ...next, durationMinutes } : next);
    setShareCode(null);
  }

  function openAtNextHour() {
    const next = new Date();
    next.setHours(next.getHours() + 1, 0, 0, 0);
    pick(next);
  }

  function close() {
    setShareCode(null);
    setDraft(null);
  }

  return (
    <div className="flex flex-col gap-4">
      {draft ? (
        <ProposePanel
          groupId={groupId}
          members={members}
          viewerId={viewerId}
          draft={draft}
          onChange={setDraft}
          shareCode={shareCode}
          onCreated={setShareCode}
          onClose={close}
        />
      ) : (
        <div>
          <button
            onClick={openAtNextHour}
            className="rounded-lg bg-black px-4 py-2 font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            Propose a time
          </button>
          <span className="ml-3 text-sm text-zinc-500">or pick a time on the calendar</span>
        </div>
      )}

      <WeekCalendar
        members={members}
        viewerId={viewerId}
        weekOffset={weekOffset}
        variant="group"
        onPickTime={pick}
        onPickRange={(start, end) => pick(start, Math.round((end.getTime() - start.getTime()) / 60_000))}
        selection={draft && !shareCode ? { start: draft.start, end: draftEnd(draft) } : null}
        plans={plans}
      />
    </div>
  );
}

function ProposePanel({
  groupId,
  members,
  viewerId,
  draft,
  onChange,
  shareCode,
  onCreated,
  onClose,
}: {
  groupId: string;
  members: CalendarMember[];
  viewerId: string;
  draft: PlanDraft;
  onChange: (draft: PlanDraft) => void;
  shareCode: string | null;
  onCreated: (shareCode: string) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();

  // Who's busy at any point during the (first) proposed time, using the same
  // math as the heat map.
  const connected = members.filter((m) => m.busy !== null);
  const busyIds = new Set(
    computeSegments(
      connected.map((m) => ({ memberId: m.id, busy: m.busy! })),
      draft.start.getTime(),
      draftEnd(draft).getTime(),
    ).flatMap((s) => s.busyMemberIds),
  );
  const busyNames = connected
    .filter((m) => busyIds.has(m.id))
    .map((m) => (m.id === viewerId ? "You" : m.name));
  const firstOnly = draft.repeat ? " (checked for the first one)" : "";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createPlan(groupId, draftToInput(draft));
      if ("error" in result) setError(result.error);
      else onCreated(result.shareCode);
    });
  }

  const panelClass = "flex flex-col gap-3 rounded-xl border border-zinc-300 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-950";

  if (shareCode) {
    return (
      <div className={panelClass}>
        <p className="font-medium">Plan created! Text this link to your group chat:</p>
        <CopyLink path={`/p/${shareCode}`} label="Plan link" />
        <div className="flex gap-4 text-sm">
          <Link href={`/p/${shareCode}`} className="underline">
            Open plan page
          </Link>
          <button onClick={onClose} className="text-zinc-500 underline">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={panelClass}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Propose a time</h2>
        <button type="button" onClick={onClose} className="text-sm text-zinc-500 underline">
          Cancel
        </button>
      </div>

      <PlanFormFields draft={draft} onChange={onChange} />

      <p className={busyNames.length ? "text-sm text-amber-700 dark:text-amber-400" : "text-sm text-emerald-700 dark:text-emerald-400"}>
        {connected.length === 0
          ? "No one's calendar is connected, so we can't check availability."
          : busyNames.length === 0
            ? `✓ Everyone's free then${firstOnly}.`
            : `Busy during some or all of this${firstOnly}: ${busyNames.join(", ")}`}
      </p>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
        >
          {saving ? "Creating…" : "Create plan"}
        </button>
      </div>
    </form>
  );
}
