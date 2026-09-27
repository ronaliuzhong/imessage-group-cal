import { jsonError, planSummary, withAppUser } from "@/lib/app-api";

// GET: a plan, for when someone taps its bubble. → { "plan": { ... } }
export async function GET(request: Request, ctx: RouteContext<"/api/app/plans/[code]">) {
  return withAppUser(request, async (user) => {
    const { code } = await ctx.params;
    const plan = await planSummary(code, user.id);
    if (!plan) return jsonError("This plan doesn't exist anymore.", 404);
    return Response.json({ plan });
  });
}
