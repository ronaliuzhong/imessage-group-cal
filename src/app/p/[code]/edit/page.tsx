import Link from "next/link";
import { notFound } from "next/navigation";
import { EditPlanForm } from "@/components/edit-plan-form";
import { prisma } from "@/lib/db";
import type { RepeatInput } from "@/lib/plan-input";
import { occurrenceToShow, ruleOf } from "@/lib/plan-occurrences";
import { getPlanByShareCode } from "@/lib/plans";
import { countBefore } from "@/lib/recurrence";
import { requireUser } from "@/lib/session";

// /p/<code>/edit(?at=<date>): change or cancel a plan, or for repeating plans
// the date being viewed. Any member of the plan's group can.
export default async function EditPlanPage({ params, searchParams }: PageProps<"/p/[code]/edit">) {
  const user = await requireUser();
  const { code } = await params;
  const { at } = await searchParams;
  const plan = await getPlanByShareCode(code);
  if (!plan || plan.cancelledAt) notFound();

  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: plan.group.id, userId: user.id } },
  });
  if (!membership) notFound();

  const shown = occurrenceToShow(plan, plan.exceptions, typeof at === "string" ? new Date(at) : null);
  const repeating = Boolean(plan.repeatFreq);

  // The plan's repeat pattern as the form shows it. When editing from a later
  // date, "after N times" counts from that date (what "this and following"
  // would keep).
  const repeat: RepeatInput | null = plan.repeatFreq
    ? {
        freq: plan.repeatFreq as RepeatInput["freq"],
        interval: plan.repeatInterval,
        weekdays: plan.repeatWeekdays,
        ends: plan.repeatCount ? "after" : plan.repeatUntil ? "on" : "never",
        untilDate: plan.repeatUntil ?? "",
        count: plan.repeatCount
          ? Math.max(1, plan.repeatCount - countBefore(ruleOf(plan), shown.originalStart))
          : 10,
      }
    : null;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-8 sm:px-6 sm:py-16">
      <Link
        href={`/p/${code}${repeating ? `?at=${encodeURIComponent(shown.originalStart.toISOString())}` : ""}`}
        className="-mb-2 self-start text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        ← Back to plan
      </Link>
      <h1 className="text-2xl font-semibold">Edit plan</h1>
      <EditPlanForm
        planId={plan.id}
        code={code}
        occurrence={repeating ? shown.originalStart.toISOString() : null}
        initial={{
          title: shown.title,
          start: shown.start.toISOString(),
          durationMinutes: Math.round((shown.end.getTime() - shown.start.getTime()) / 60_000),
          location: shown.location ?? "",
          notes: shown.notes ?? "",
          repeat,
        }}
      />
    </main>
  );
}
