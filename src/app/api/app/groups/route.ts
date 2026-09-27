import { groupSummary, jsonBody, jsonError, withAppUser } from "@/lib/app-api";
import { createAutoNamedGroupFor, createGroupFor } from "@/lib/groups";

// POST: "Start Group Cal in this chat". Body: { "name": "Roommates" }, or
// { "autoName": true } for one-on-one chats (named from members' first names).
// → { "group": { id, name, autoNamed, inviteCode, joinUrl } }
export async function POST(request: Request) {
  return withAppUser(request, async (user) => {
    const body = await jsonBody(request);
    const group =
      body?.autoName === true
        ? await createAutoNamedGroupFor(user.id)
        : await createGroupFor(user.id, typeof body?.name === "string" ? body.name : "");
    if (!group) return jsonError("Give the group a name.", 400);
    return Response.json({ group: await groupSummary(group) }, { status: 201 });
  });
}
