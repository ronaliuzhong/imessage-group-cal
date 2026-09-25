// GET /p/<code>/calendar.ics — the plan as a calendar file, for "Add to Apple
// Calendar". Same access rule as the plan page: anyone with the link.
import { icsFile } from "@/lib/plan-links";
import { getPlanByShareCode } from "@/lib/plans";

export async function GET(request: Request, { params }: RouteContext<"/p/[code]/calendar.ics">) {
  const { code } = await params;
  const plan = await getPlanByShareCode(code);
  if (!plan) return new Response("Plan not found", { status: 404 });

  if (plan.cancelledAt) return new Response("This plan was cancelled", { status: 410 });

  // Includes one-off changes: cancelled dates are left out, edited ones updated.
  const body = icsFile(
    { ...plan, url: new URL(`/p/${code}`, request.url).toString(), groupName: plan.group.name },
    plan.exceptions,
  );
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // "inline" lets iPhones show the "Add to Calendar" sheet right away
      // instead of saving a file to Downloads first.
      "Content-Disposition": 'inline; filename="plan.ics"',
      "Cache-Control": "no-store",
    },
  });
}
