import { appUserFrom } from "@/lib/app-auth";
import { viewerGroupColor, viewerPlanColor, type GroupColor } from "@/lib/colors";
import { prisma } from "@/lib/db";
import type { RepeatInput } from "@/lib/plan-input";
import { occurrenceToShow, responseFor, responsesFor, ruleOf } from "@/lib/plan-occurrences";
import { repeatLabel } from "@/lib/recurrence";
import { siteOrigin } from "@/lib/site";

// Helpers for the iPhone app's endpoints (src/app/api/app/). They answer in
// JSON; errors look like { "error": "…" }, with a message meant for people.

export type AppUserInfo = NonNullable<Awaited<ReturnType<typeof appUserFrom>>>;

export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// Runs `handler` with the signed-in app user, or answers 401.
export async function withAppUser(request: Request, handler: (user: AppUserInfo) => Promise<Response>) {
  const user = await appUserFrom(request);
  if (!user) return jsonError("Not signed in.", 401);
  return handler(user);
}

// The request's JSON body, or null if it isn't a JSON object.
export async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? body : null;
}

// What the app shows for a plan (and on its bubble), from `viewerId`'s side,
// or null if there's no such plan. Like the website, anyone signed in who has
// the plan's link can see it. For repeating plans it describes one date: `at`
// (its original start) if that's a real date, else the next one coming up,
// with that date's details, answers and the viewer's answer for it.
export async function planSummary(shareCode: string, viewerId: string, at?: Date | null) {
  const user = { select: { id: true, name: true, email: true } };
  const plan = await prisma.plan.findUnique({
    where: { shareCode },
    include: {
      group: { select: { id: true, name: true, color: true, members: { select: { userId: true, color: true } } } },
      exceptions: true,
      colors: { where: { userId: viewerId }, select: { color: true } },
      rsvps: { include: { user } },
      occurrenceRsvps: { include: { user } },
    },
  });
  if (!plan) return null;

  const shown = occurrenceToShow(plan, plan.exceptions, at ?? null);
  const { going, notGoing } = responsesFor(shown.originalStart, plan.rsvps, plan.occurrenceRsvps);
  const person = ({ user: u }: { user: { id: string; name: string | null; email: string } }) => ({
    id: u.id,
    name: u.name ?? u.email,
    isYou: u.id === viewerId,
  });
  const repeats = plan.repeatFreq !== null;
  const originalStart = shown.originalStart.toISOString();
  const membership = plan.group.members.find((m) => m.userId === viewerId);
  const shade = (c: GroupColor) => ({ id: c.id, name: c.name, hex: c.hex, text: c.text });
  return {
    id: plan.id,
    shareCode: plan.shareCode,
    title: shown.title,
    start: shown.start.toISOString(),
    end: shown.end.toISOString(),
    location: shown.location,
    notes: shown.notes,
    groupId: plan.group.id,
    groupName: plan.group.name,
    inGroup: membership !== undefined,
    // The viewer's color for this plan (their own pick, else their group
    // color), the group color to go back to, and whether they picked one.
    color: shade(viewerPlanColor(plan.group, membership, plan.colors[0])),
    groupColor: shade(viewerGroupColor(plan.group, membership)),
    hasOwnColor: plan.colors.length > 0,
    repeats,
    cancelled: plan.cancelledAt !== null,
    going: going.map(person),
    notGoing: notGoing.map(person),
    myResponse: responseFor(viewerId, shown.originalStart, plan.rsvps, plan.occurrenceRsvps),
    // Which date this is, and whether it's the plan's first (where "this and
    // following" means the same as "all").
    originalStart,
    isFirstDate: shown.originalStart.getTime() === plan.start.getTime(),
    // e.g. "Weekly on Thursday · 6 times"; and the settings, for editing.
    repeatLabel: repeatLabel(ruleOf(plan)),
    repeat: repeats
      ? {
          freq: plan.repeatFreq,
          interval: plan.repeatInterval,
          weekdays: plan.repeatWeekdays,
          ends: plan.repeatCount ? "after" : plan.repeatUntil ? "on" : "never",
          untilDate: plan.repeatUntil ?? "",
          count: plan.repeatCount ?? 10,
        }
      : null,
    // Goes behind the plan bubble: the extension recognizes it, and anyone
    // without the app gets the website's plan page (on this date).
    url: `${await siteOrigin()}/p/${plan.shareCode}${repeats ? `?at=${encodeURIComponent(originalStart)}` : ""}`,
  };
}

// A repeat setting from an app request, or null. parsePlanInput checks it
// properly; this only makes sure it has the right shape.
export function repeatFromBody(value: unknown): RepeatInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  return {
    freq: String(r.freq ?? "") as RepeatInput["freq"],
    interval: Number(r.interval),
    weekdays: Array.isArray(r.weekdays) ? r.weekdays.map(Number) : [],
    ends: String(r.ends ?? "never") as RepeatInput["ends"],
    untilDate: String(r.untilDate ?? ""),
    count: Number(r.count),
  };
}

// A date from an app request ("which date of a repeating plan"), or null.
export function dateFromValue(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// What the app needs to know about a group. `joinUrl` goes behind the invite
// bubble: the extension recognizes it, and anyone without the app gets the
// website's join page.
export async function groupSummary(group: { id: string; name: string; autoNamed: boolean; inviteCode: string }) {
  return {
    id: group.id,
    name: group.name,
    autoNamed: group.autoNamed,
    inviteCode: group.inviteCode,
    joinUrl: `${await siteOrigin()}/join/${group.inviteCode}`,
  };
}
