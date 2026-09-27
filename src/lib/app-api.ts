import { appUserFrom } from "@/lib/app-auth";
import { prisma } from "@/lib/db";
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
// the plan's link can see it. Repeating plans are answered on the website, so
// for those `going` counts the "all of them" answers only.
export async function planSummary(shareCode: string, viewerId: string) {
  const plan = await prisma.plan.findUnique({
    where: { shareCode },
    include: {
      group: { select: { id: true, name: true, members: { select: { userId: true } } } },
      rsvps: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });
  if (!plan) return null;

  const person = (u: { id: string; name: string | null; email: string }) => ({
    id: u.id,
    name: u.name ?? u.email,
    isYou: u.id === viewerId,
  });
  const answered = (response: string) => plan.rsvps.filter((r) => r.response === response).map((r) => person(r.user));
  return {
    id: plan.id,
    shareCode: plan.shareCode,
    title: plan.title,
    start: plan.start.toISOString(),
    end: plan.end.toISOString(),
    location: plan.location,
    notes: plan.notes,
    groupId: plan.group.id,
    groupName: plan.group.name,
    inGroup: plan.group.members.some((m) => m.userId === viewerId),
    repeats: plan.repeatFreq !== null,
    cancelled: plan.cancelledAt !== null,
    going: answered("GOING"),
    notGoing: answered("NOT_GOING"),
    myResponse: plan.rsvps.find((r) => r.userId === viewerId)?.response ?? null,
    // Goes behind the plan bubble: the extension recognizes it, and anyone
    // without the app gets the website's plan page.
    url: `${await siteOrigin()}/p/${plan.shareCode}`,
  };
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
