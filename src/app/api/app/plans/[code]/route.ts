import { jsonBody, jsonError, planSummary, withAppUser } from "@/lib/app-api";
import { prisma } from "@/lib/db";
import { updatePlanFor } from "@/lib/plan-edits";

// GET: a plan, for when someone taps its bubble. → { "plan": { ... } }
export async function GET(request: Request, ctx: RouteContext<"/api/app/plans/[code]">) {
  return withAppUser(request, async (user) => {
    const { code } = await ctx.params;
    const plan = await planSummary(code, user.id);
    if (!plan) return jsonError("This plan doesn't exist anymore.", 404);
    return Response.json({ plan });
  });
}

// PATCH: edit a plan from the iMessage extension. Body: { "title", "start"
// (ISO time), "durationMinutes", "location" } (notes are kept unless sent).
// Any group member can edit, like on the website; everyone's Google Calendar
// is updated. → { "plan": { ... } }. Repeating plans are edited on the website.
export async function PATCH(request: Request, ctx: RouteContext<"/api/app/plans/[code]">) {
  return withAppUser(request, async (user) => {
    const { code } = await ctx.params;
    const body = await jsonBody(request);
    if (!body) return jsonError("Send the plan's details.", 400);

    const plan = await prisma.plan.findUnique({ where: { shareCode: code } });
    if (!plan) return jsonError("This plan doesn't exist anymore.", 404);
    if (plan.repeatFreq) return jsonError("Repeating plans can be edited on the Group Cal website.", 409);

    const result = await updatePlanFor(user.id, plan.id, {
      title: String(body.title ?? ""),
      start: String(body.start ?? ""),
      durationMinutes: Number(body.durationMinutes),
      location: String(body.location ?? ""),
      notes: typeof body.notes === "string" ? body.notes : (plan.notes ?? ""),
      timeZone: typeof body.timeZone === "string" ? body.timeZone : plan.timeZone,
      repeat: null,
    });
    if ("error" in result) {
      const status = result.error === "This plan can't be edited." ? 403 : 400;
      return jsonError(result.error, status);
    }
    return Response.json({ plan: await planSummary(result.shareCode, user.id) });
  });
}
