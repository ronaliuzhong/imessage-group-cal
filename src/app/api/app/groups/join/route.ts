import { groupSummary, jsonBody, jsonError, withAppUser } from "@/lib/app-api";
import { joinGroupFor } from "@/lib/groups";

// POST: tapping an invite bubble. Body: { "inviteCode": "…" }
// → { "group": { id, name, inviteCode, joinUrl } }. Joining twice is fine.
export async function POST(request: Request) {
  return withAppUser(request, async (user) => {
    const body = await jsonBody(request);
    const inviteCode = typeof body?.inviteCode === "string" ? body.inviteCode : "";
    const group = inviteCode ? await joinGroupFor(user.id, inviteCode) : null;
    if (!group) return jsonError("This invite doesn't work anymore.", 404);
    return Response.json({ group: await groupSummary(group) });
  });
}
