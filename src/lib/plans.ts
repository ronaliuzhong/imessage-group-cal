import { cache } from "react";
import { viewerGroupColor, type GroupColor } from "@/lib/colors";
import { prisma } from "@/lib/db";
import { resolvedOccurrencesBetween, responseFor, responsesFor, ruleOf } from "@/lib/plan-occurrences";
import { repeatLabel } from "@/lib/recurrence";

// One date of a plan, as the calendar component draws it (a repeating plan
// appears once per date). Dates are ISO strings because this crosses from
// server to browser.
export type CalendarPlan = {
  id: string; // unique per date: "<plan id>:<original start>"
  originalStart: string; // which date this is (for links to it)
  title: string;
  start: string;
  end: string;
  location: string | null;
  repeatLabel: string | null; // e.g. "Weekly on Thursday · 6 times"
  shareCode: string;
  groupName: string;
  color: GroupColor;
  going: { id: string; name: string }[];
  myResponse: "GOING" | "NOT_GOING" | null; // for this date
};

const userSelect = { select: { id: true, name: true, email: true } } as const;

// Dates in [timeMin, timeMax) of plans either in one group, or (no groupId)
// in every group the viewer belongs to. Cancelled plans and dates are left
// out. On the home page we also skip dates the viewer said they can't make;
// the group page shows everything.
export async function loadCalendarPlans({
  viewerId,
  groupId,
  timeMin,
  timeMax,
  hideDeclined = false,
}: {
  viewerId: string;
  groupId?: string;
  timeMin: Date;
  timeMax: Date;
  hideDeclined?: boolean;
}): Promise<CalendarPlan[]> {
  const plans = await prisma.plan.findMany({
    where: {
      cancelledAt: null,
      start: { lt: timeMax },
      OR: [{ seriesEnd: null }, { seriesEnd: { gt: timeMin } }],
      group: groupId ? { id: groupId } : { members: { some: { userId: viewerId } } },
    },
    orderBy: { start: "asc" },
    include: {
      group: {
        select: {
          name: true,
          color: true,
          // The viewer's own membership, for their personal color choice.
          members: { where: { userId: viewerId }, select: { color: true } },
        },
      },
      exceptions: true,
      rsvps: { include: { user: userSelect } },
      occurrenceRsvps: { include: { user: userSelect } },
    },
  });

  return plans.flatMap((plan) => {
    const label = repeatLabel(ruleOf(plan));
    const color = viewerGroupColor(plan.group, plan.group.members[0]);
    return resolvedOccurrencesBetween(plan, plan.exceptions, timeMin, timeMax).flatMap((o) => {
      const myResponse = responseFor(viewerId, o.originalStart, plan.rsvps, plan.occurrenceRsvps);
      if (hideDeclined && myResponse === "NOT_GOING") return [];
      const { going } = responsesFor(o.originalStart, plan.rsvps, plan.occurrenceRsvps);
      return [
        {
          id: `${plan.id}:${o.originalStart.toISOString()}`,
          originalStart: o.originalStart.toISOString(),
          title: o.title,
          start: o.start.toISOString(),
          end: o.end.toISOString(),
          location: o.location,
          repeatLabel: label,
          shareCode: plan.shareCode,
          groupName: plan.group.name,
          color,
          going: going.map((r) => ({ id: r.user.id, name: r.user.name ?? r.user.email })),
          myResponse,
        },
      ];
    });
  });
}

// Looks up a plan by the code in its share link. Wrapped in cache() because
// the plan page asks twice per request (once for the link-preview metadata,
// once for the page itself) and this makes it one database query.
export const getPlanByShareCode = cache((shareCode: string) =>
  prisma.plan.findUnique({
    where: { shareCode },
    include: {
      group: { select: { id: true, name: true, color: true } },
      createdBy: { select: { name: true, email: true } },
      exceptions: true,
      rsvps: { orderBy: { updatedAt: "asc" }, include: { user: userSelect } },
      occurrenceRsvps: { orderBy: { updatedAt: "asc" }, include: { user: userSelect } },
      // "This and following" edits: where this plan continues, if it was split.
      continuedAs: { select: { shareCode: true, title: true }, take: 1, orderBy: { createdAt: "desc" } },
    },
  }),
);
