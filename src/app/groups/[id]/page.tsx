import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { CopyLink } from "@/components/copy-link";
import { GroupPlanner } from "@/components/group-planner";
import { LeaveGroupButton } from "@/components/leave-group-button";
import { LocalTimeRange } from "@/components/local-time";
import { GroupColorButton } from "@/components/group-color-button";
import { ReconnectNotice } from "@/components/reconnect-notice";
import { fetchWindow, loadMembersBusy, parseWeekOffset } from "@/lib/calendar-data";
import { viewerGroupColor } from "@/lib/colors";
import { prisma } from "@/lib/db";
import { loadCalendarPlans } from "@/lib/plans";
import { responsesFor, ruleOf, upcomingResolved } from "@/lib/plan-occurrences";
import { repeatLabel } from "@/lib/recurrence";
import { requireUser } from "@/lib/session";
import type { CancelSnapshot } from "@/app/actions";
import { CancelToast } from "@/components/cancel-toast";

export default async function GroupPage({ params, searchParams }: PageProps<"/groups/[id]">) {
  const viewer = await requireUser();
  const { id } = await params;
  const query = await searchParams;
  const weekOffset = parseWeekOffset(query.week);
  // Just cancelled something (?undo=…): show the note with "Undo".
  const undo =
    typeof query.undo === "string"
      ? await prisma.cancelUndo.findFirst({
          where: { id: query.undo, userId: viewer.id, plan: { groupId: id } },
          include: { plan: { select: { title: true } } },
        })
      : null;
  const undoSnapshot = undo?.snapshot as CancelSnapshot | undefined;

  const group = await prisma.group.findUnique({
    where: { id },
    include: {
      members: {
        orderBy: { joinedAt: "asc" },
        include: { user: { select: { id: true, name: true, email: true } } },
      },
      // Upcoming plans: not cancelled, with a date still to come (or no end).
      plans: {
        where: { cancelledAt: null, OR: [{ seriesEnd: null }, { seriesEnd: { gt: new Date() } }] },
        include: { exceptions: true, rsvps: true, occurrenceRsvps: true },
      },
    },
  });
  // Non-members get the same "not found" as a group that doesn't exist, so
  // the page doesn't even reveal whether a group ID is real.
  if (!group || !group.members.some((m) => m.userId === viewer.id)) notFound();

  const { timeMin, timeMax } = fetchWindow(weekOffset);
  const [members, calendarPlans] = await Promise.all([
    loadMembersBusy(group.members.map((m) => m.user), timeMin, timeMax),
    loadCalendarPlans({ viewerId: viewer.id, groupId: group.id, timeMin, timeMax }),
  ]);
  const viewerConnected = members.find((m) => m.id === viewer.id)?.busy !== null;
  const notConnected = members.filter((m) => m.busy === null && m.id !== viewer.id);
  const myColor = viewerGroupColor(group, group.members.find((m) => m.userId === viewer.id));
  // For repeating plans, list the next date it happens (skipping cancelled
  // ones), with who's going that day; soonest first.
  const now = new Date();
  const upcoming = group.plans
    .flatMap((plan) => {
      const [next] = upcomingResolved(plan, plan.exceptions, now, 1);
      if (!next) return [];
      const goingCount = responsesFor(next.originalStart, plan.rsvps, plan.occurrenceRsvps).going.length;
      return [{ plan, next, goingCount, label: repeatLabel(ruleOf(plan)) }];
    })
    .sort((a, b) => a.next.start.getTime() - b.next.start.getTime());

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <AppHeader userName={viewer.name} />
      {undo && undoSnapshot && (
        <CancelToast
          undoId={undo.id}
          title={undo.plan.title}
          scope={undoSnapshot.scope}
          date={undoSnapshot.scope === "all" ? null : undoSnapshot.originalStart}
        />
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <GroupColorButton groupId={group.id} color={myColor} />
            {group.name}
          </h1>
          <p className="text-sm text-zinc-500">
            {members.map((m) => (m.id === viewer.id ? "You" : m.name)).join(", ")}
          </p>
        </div>
        <div className="flex w-full max-w-md flex-col items-end gap-1">
          <CopyLink path={`/join/${group.inviteCode}`} label="Invite link" />
          <span className="text-xs text-zinc-500">Text it to your group chat. Anyone with the link can join.</span>
        </div>
      </div>

      {!viewerConnected && <ReconnectNotice redirectTo={`/groups/${group.id}`} />}
      {notConnected.length > 0 && (
        <p className="rounded-lg bg-zinc-100 px-4 py-2 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          Not included (calendar not connected):{" "}
          {notConnected.map((m) => m.name).join(", ")}. Ask them to open Group Cal and sign in again.
        </p>
      )}

      {upcoming.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Upcoming plans</h2>
          <ul className="flex flex-col gap-2">
            {upcoming.map(({ plan, next, goingCount, label }) => (
              <li key={plan.id}>
                <Link
                  href={label ? `/p/${plan.shareCode}?at=${encodeURIComponent(next.originalStart.toISOString())}` : `/p/${plan.shareCode}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 px-4 py-3 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  <div>
                    <div className="font-medium">{next.title}</div>
                    <div className="text-sm text-zinc-500">
                      {label && "Next: "}
                      <LocalTimeRange start={next.start.toISOString()} end={next.end.toISOString()} short />
                      {next.location && ` · ${next.location}`}
                    </div>
                    {label && <div className="text-xs text-zinc-500">↻ {label}</div>}
                  </div>
                  <span className="text-sm text-emerald-700 dark:text-emerald-400">
                    {goingCount} going{label && " next time"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <GroupPlanner
        groupId={group.id}
        members={members}
        viewerId={viewer.id}
        weekOffset={weekOffset}
        plans={calendarPlans}
      />

      <div className="flex justify-end border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <LeaveGroupButton groupId={group.id} isLastMember={members.length === 1} />
      </div>
    </main>
  );
}
