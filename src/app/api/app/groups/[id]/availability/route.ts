import { groupSummary, jsonError, withAppUser } from "@/lib/app-api";
import { computeSegments } from "@/lib/availability";
import { loadMembersBusy } from "@/lib/calendar-data";
import { prisma } from "@/lib/db";
import { loadCalendarPlans, type CalendarPlan } from "@/lib/plans";

// Longest range the app can ask about at once, so nobody can make us query
// Google for a whole year.
const MAX_RANGE_MS = 8 * 24 * 60 * 60 * 1000;
// "Upcoming plans": the next few in the coming month.
const UPCOMING_MS = 30 * 24 * 60 * 60 * 1000;
const UPCOMING_COUNT = 5;

// Only what the app draws; `color` is the viewer's color for the group.
const appPlan = (p: CalendarPlan) => ({
  id: p.id,
  shareCode: p.shareCode,
  title: p.title,
  start: p.start,
  end: p.end,
  location: p.location,
  repeatLabel: p.repeatLabel,
  color: { hex: p.color.hex, text: p.color.text },
  goingCount: p.going.length,
  myResponse: p.myResponse,
});

// GET ?start=<ISO time>&end=<ISO time>: who's in the group and when they're
// busy, as consecutive segments (the same math as the website's heat map).
// The app picks the range, since only it knows the person's local "today".
//
// → { group, members: [{ id, name, isYou, connected }],
//     segments: [{ start, end, busyMemberIds }],
//     plans: [...in the range], upcoming: [...next few] }
// `connected: false` = we can't read their calendar; they're left out of the
// segments (the app lists them under "Waiting for...").
export async function GET(request: Request, ctx: RouteContext<"/api/app/groups/[id]/availability">) {
  return withAppUser(request, async (user) => {
    const { id } = await ctx.params;
    const params = new URL(request.url).searchParams;
    const start = new Date(params.get("start") ?? "");
    const end = new Date(params.get("end") ?? "");
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
      return jsonError("Send a start and end time.", 400);
    }
    if (end.getTime() - start.getTime() > MAX_RANGE_MS) {
      return jsonError("That time range is too long.", 400);
    }

    const group = await prisma.group.findUnique({
      where: { id },
      include: {
        members: {
          orderBy: { joinedAt: "asc" },
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    // Same answer for "not a member" and "no such group", like the website.
    if (!group || !group.members.some((m) => m.userId === user.id)) {
      return jsonError("Group not found.", 404);
    }

    const now = new Date();
    const [members, plans, soon] = await Promise.all([
      loadMembersBusy(group.members.map((m) => m.user), start, end),
      loadCalendarPlans({ viewerId: user.id, groupId: id, timeMin: start, timeMax: end }),
      loadCalendarPlans({ viewerId: user.id, groupId: id, timeMin: now, timeMax: new Date(now.getTime() + UPCOMING_MS) }),
    ]);
    const connected = members.filter((m) => m.busy !== null);
    const segments = computeSegments(
      connected.map((m) => ({ memberId: m.id, busy: m.busy! })),
      start.getTime(),
      end.getTime(),
    );

    return Response.json({
      group: await groupSummary(group),
      members: members.map((m) => ({ id: m.id, name: m.name, isYou: m.id === user.id, connected: m.busy !== null })),
      segments: segments.map((s) => ({
        start: new Date(s.start).toISOString(),
        end: new Date(s.end).toISOString(),
        busyMemberIds: s.busyMemberIds,
      })),
      // Plans (each date of repeating ones) drawn on the calendar, and the
      // next few coming up, in the same shape the website uses.
      plans: plans.map(appPlan),
      upcoming: soon
        .sort((a, b) => a.start.localeCompare(b.start))
        .slice(0, UPCOMING_COUNT)
        .map(appPlan),
    });
  });
}
