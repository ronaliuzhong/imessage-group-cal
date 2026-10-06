import { jsonBody, jsonError, planSummary, repeatFromBody, withAppUser } from "@/lib/app-api";
import { createPlanFor } from "@/lib/plan-writes";

// POST: propose a plan from the iMessage extension. Body:
// { "title", "start" (ISO time), "durationMinutes", "location"?, "timeZone",
//   "repeat"? (like the website's: { freq, interval, weekdays, ends,
//   untilDate, count }) } → { "plan": { ... } } (see planSummary).
export async function POST(request: Request, ctx: RouteContext<"/api/app/groups/[id]/plans">) {
  return withAppUser(request, async (user) => {
    const { id } = await ctx.params;
    const body = await jsonBody(request);
    if (!body) return jsonError("Send the plan's details.", 400);

    const result = await createPlanFor(user.id, id, {
      title: String(body.title ?? ""),
      start: String(body.start ?? ""),
      durationMinutes: Number(body.durationMinutes),
      location: String(body.location ?? ""),
      notes: String(body.notes ?? ""),
      timeZone: String(body.timeZone ?? ""),
      repeat: repeatFromBody(body.repeat),
    });
    if ("error" in result) {
      const status = result.error === "You're not in this group." ? 404 : 400;
      return jsonError(result.error, status);
    }
    return Response.json({ plan: await planSummary(result.plan.shareCode, user.id) }, { status: 201 });
  });
}
