import { dateFromValue, jsonBody, jsonError, planSummary, repeatFromBody, withAppUser } from "@/lib/app-api";
import { prisma } from "@/lib/db";
import { updatePlanFor, type EditScope } from "@/lib/plan-edits";

// GET ?at=<ISO>: a plan, for when someone taps its bubble or taps it on the
// calendar. For repeating plans `at` picks the date (see planSummary).
// → { "plan": { ... } }
export async function GET(request: Request, ctx: RouteContext<"/api/app/plans/[code]">) {
  return withAppUser(request, async (user) => {
    const { code } = await ctx.params;
    const at = dateFromValue(new URL(request.url).searchParams.get("at"));
    const plan = await planSummary(code, user.id, at);
    if (!plan) return jsonError("This plan doesn't exist anymore.", 404);
    return Response.json({ plan });
  });
}

// PATCH: edit a plan from the iMessage extension. Body: { "title", "start"
// (ISO time), "durationMinutes", "location", "repeat" (or null) } (notes are
// kept unless sent). For repeating plans also "scope" ("this" | "following" |
// "all") and "occurrence" (the date being edited), like the website. Any
// group member can edit; everyone's Google Calendar is updated.
// → { "plan": { ... } } ("following" continues as a new plan with its own link).
export async function PATCH(request: Request, ctx: RouteContext<"/api/app/plans/[code]">) {
  return withAppUser(request, async (user) => {
    const { code } = await ctx.params;
    const body = await jsonBody(request);
    if (!body) return jsonError("Send the plan's details.", 400);

    const plan = await prisma.plan.findUnique({ where: { shareCode: code } });
    if (!plan) return jsonError("This plan doesn't exist anymore.", 404);
    const scope: EditScope = body.scope === "this" || body.scope === "following" ? body.scope : "all";
    const occurrence = dateFromValue(body.occurrence);

    const result = await updatePlanFor(user.id, plan.id, {
      title: String(body.title ?? ""),
      start: String(body.start ?? ""),
      durationMinutes: Number(body.durationMinutes),
      location: String(body.location ?? ""),
      notes: typeof body.notes === "string" ? body.notes : (plan.notes ?? ""),
      timeZone: typeof body.timeZone === "string" ? body.timeZone : plan.timeZone,
      repeat: repeatFromBody(body.repeat),
    }, scope, occurrence?.toISOString());
    if ("error" in result) {
      const status = result.error === "This plan can't be edited." ? 403 : 400;
      return jsonError(result.error, status);
    }
    // "This event" stays on that date; otherwise show the next date coming up.
    const at = scope === "this" ? occurrence : null;
    return Response.json({ plan: await planSummary(result.shareCode, user.id, at) });
  });
}
