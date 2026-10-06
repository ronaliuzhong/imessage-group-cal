import { dateFromValue, jsonBody, jsonError, planSummary, withAppUser } from "@/lib/app-api";
import { prisma } from "@/lib/db";
import { setRsvpFor } from "@/lib/plan-writes";

// POST: Going / Can't make it from the plan bubble. Body:
// { "response": "GOING" | "NOT_GOING" }, plus for repeating plans
// "occurrence" (the date shown) and "scope": "this" (just that date) or
// "all" (every date). → { "plan": { ... } }, updated. Adds the plan to (or
// removes it from) their Google Calendar, like the website.
export async function POST(request: Request, ctx: RouteContext<"/api/app/plans/[code]/rsvp">) {
  return withAppUser(request, async (user) => {
    const { code } = await ctx.params;
    const body = await jsonBody(request);
    const response = body?.response;
    if (response !== "GOING" && response !== "NOT_GOING") {
      return jsonError("Answer GOING or NOT_GOING.", 400);
    }

    const plan = await prisma.plan.findUnique({ where: { shareCode: code } });
    if (!plan) return jsonError("This plan doesn't exist anymore.", 404);
    if (plan.cancelledAt) return jsonError("This plan was cancelled.", 409);

    const occurrence = dateFromValue(body?.occurrence);
    const justThisOne = plan.repeatFreq !== null && body?.scope === "this" && occurrence !== null;
    await setRsvpFor(user.id, plan.id, response, justThisOne ? occurrence.toISOString() : null);
    return Response.json({ plan: await planSummary(code, user.id, occurrence) });
  });
}
