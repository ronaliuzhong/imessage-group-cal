import { dateFromValue, jsonBody, jsonError, planSummary, withAppUser } from "@/lib/app-api";
import { prisma } from "@/lib/db";
import { setPlanColorFor } from "@/lib/plan-writes";

// POST: your own color for a plan. Body: { "color": "<preset id or #rrggbb>" }
// or { "color": null } to go back to your group color; plus "occurrence" (the
// date on screen, for repeating plans). Only you see it, in Coucal and on your
// Google Calendar. → { "plan": { ... } }
export async function POST(request: Request, ctx: RouteContext<"/api/app/plans/[code]/color">) {
  return withAppUser(request, async (user) => {
    const { code } = await ctx.params;
    const body = await jsonBody(request);
    if (!body || !("color" in body)) return jsonError("Send a color (or null).", 400);
    const color = typeof body.color === "string" ? body.color : null;

    const plan = await prisma.plan.findUnique({ where: { shareCode: code }, select: { id: true } });
    if (!plan || !(await setPlanColorFor(user.id, plan.id, color))) {
      return jsonError("This plan doesn't exist anymore.", 404);
    }
    return Response.json({ plan: await planSummary(code, user.id, dateFromValue(body.occurrence)) });
  });
}
