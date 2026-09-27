import { appUserFrom } from "@/lib/app-auth";
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
