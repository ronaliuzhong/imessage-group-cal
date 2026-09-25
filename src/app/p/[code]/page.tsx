import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { AddToCalendar } from "@/components/add-to-calendar";
import { SignInButton } from "@/components/auth-buttons";
import { CopyLink } from "@/components/copy-link";
import { LocalTimeRange } from "@/components/local-time";
import { RsvpButtons } from "@/components/rsvp-buttons";
import { viewerGroupColor } from "@/lib/colors";
import { prisma } from "@/lib/db";
import { getGrantedScopes } from "@/lib/google";
import { mapsUrl } from "@/lib/plan-links";
import {
  describeChanges,
  occurrenceToShow,
  responseFor,
  responsesFor,
  ruleOf,
  upcomingResolved,
  type ResolvedOccurrence,
} from "@/lib/plan-occurrences";
import { getPlanByShareCode } from "@/lib/plans";
import { repeatLabel } from "@/lib/recurrence";

type Plan = NonNullable<Awaited<ReturnType<typeof getPlanByShareCode>>>;

// Controls the preview bubble when the link is pasted into iMessage and other
// chat apps (they read these "Open Graph" tags from the page).
export async function generateMetadata({ params }: PageProps<"/p/[code]">): Promise<Metadata> {
  const { code } = await params;
  const plan = await getPlanByShareCode(code);
  if (!plan) return { title: "Plan not found · Group Cal" };
  const description = plan.cancelledAt
    ? `This plan for ${plan.group.name} was cancelled.`
    : `A plan for ${plan.group.name}. Tap to see when, RSVP, and add it to your calendar.`;
  return {
    title: `${plan.title} · Group Cal`,
    description,
    openGraph: { title: plan.title, description, siteName: "Group Cal" },
  };
}

// The page a plan link opens. Anyone with the link can view it and add it to
// their calendar; signing in lets you RSVP and see who's going. Group members
// can also edit or cancel it.
export default async function PlanPage({ params, searchParams }: PageProps<"/p/[code]">) {
  const { code } = await params;
  const { at } = await searchParams;
  const [plan, session] = await Promise.all([getPlanByShareCode(code), auth()]);

  if (!plan) {
    return (
      <Card>
        <h1 className="text-2xl font-semibold">This plan link doesn&apos;t work</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          It may have been mistyped, or the group was deleted.
        </p>
        <Link href="/" className="underline">Go to Group Cal</Link>
      </Card>
    );
  }

  const viewerId = session?.user?.id;
  const isMember =
    viewerId &&
    (await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: plan.group.id, userId: viewerId } },
    }));
  const repeats = repeatLabel(ruleOf(plan));
  const shown = occurrenceToShow(plan, plan.exceptions, typeof at === "string" ? new Date(at) : null);
  const isPast = shown.end < new Date();
  // Members see their own color for the group; everyone else the starting one.
  const color = viewerGroupColor(plan.group, isMember || null);
  const atParam = repeats ? `?at=${encodeURIComponent(shown.originalStart.toISOString())}` : "";
  const continuedAs = plan.continuedAs[0];

  return (
    <Card>
      {/* Back to the group for members; otherwise to the home page (which
          shows the sign-in screen for signed-out visitors). */}
      <Link
        href={isMember ? `/groups/${plan.group.id}` : "/"}
        className="-mb-2 self-start text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        ← {isMember ? plan.group.name : "Group Cal"}
      </Link>
      <div className="flex items-center justify-between gap-4">
        <p className="flex items-center gap-2 text-sm uppercase tracking-wide text-zinc-500">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color.hex }} />
          {plan.group.name}
        </p>
        {isMember && !plan.cancelledAt && (
          <Link
            href={`/p/${code}/edit${atParam}`}
            className="text-sm text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Edit
          </Link>
        )}
      </div>
      <h1 className={`text-3xl font-semibold ${plan.cancelledAt ? "text-zinc-400 line-through" : ""}`}>
        {shown.title}
      </h1>

      {plan.cancelledAt && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          This plan was cancelled. It&apos;s been taken off everyone&apos;s Google Calendar.
        </p>
      )}
      {continuedAs && (
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          Later dates of this plan were changed and continue as{" "}
          <Link href={`/p/${continuedAs.shareCode}`} className="font-medium underline">
            {continuedAs.title}
          </Link>
          .
        </p>
      )}

      <div className="flex flex-col gap-1">
        <p className="text-lg">
          <LocalTimeRange start={shown.start.toISOString()} end={shown.end.toISOString()} />
        </p>
        {repeats && <p className="text-sm text-zinc-500">↻ {repeats}</p>}
        {shown.changes.length > 0 && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Just this date has a different {describeChanges(shown.changes)}.
          </p>
        )}
        {shown.location && (
          <a
            href={mapsUrl(shown.location)}
            target="_blank"
            rel="noopener noreferrer"
            className="self-start text-zinc-700 underline hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            📍 {shown.location}
          </a>
        )}
      </div>
      {shown.notes && <p className="whitespace-pre-line text-zinc-700 dark:text-zinc-300">{shown.notes}</p>}
      <p className="text-sm text-zinc-500">
        Proposed by {plan.createdBy.name ?? plan.createdBy.email}
        {isPast && " · This has already happened."}
      </p>

      {!plan.cancelledAt && (
        <PlanActions plan={plan} shown={shown} repeating={Boolean(repeats)} viewerId={viewerId} code={code} />
      )}
    </Card>
  );
}

// RSVP, other dates, add-to-calendar and share: everything you can do with a
// live plan.
async function PlanActions({
  plan,
  shown,
  repeating,
  viewerId,
  code,
}: {
  plan: Plan;
  shown: ResolvedOccurrence;
  repeating: boolean;
  viewerId?: string;
  code: string;
}) {
  const date = shown.originalStart;
  const myResponse = viewerId ? responseFor(viewerId, date, plan.rsvps, plan.occurrenceRsvps) : null;
  const mySeries = plan.rsvps.find((r) => r.userId === viewerId);
  const myDate = plan.occurrenceRsvps.find(
    (r) => r.userId === viewerId && r.originalStart.getTime() === date.getTime(),
  );
  const canAddToGoogle = viewerId ? (await getGrantedScopes(viewerId)).appCalendar : false;
  // On their Google Calendar: through the whole-plan event (unless they've
  // said no to this date), or as its own event.
  const onCalendar = Boolean(
    (mySeries?.response === "GOING" && mySeries.googleEventId && myDate?.response !== "NOT_GOING") ||
      myDate?.googleEventId,
  );
  const nameOf = (user: { id: string; name: string | null; email: string }) =>
    user.id === viewerId ? "You" : (user.name ?? user.email);
  const { going, notGoing } = responsesFor(date, plan.rsvps, plan.occurrenceRsvps);

  return (
    <>
      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <h2 className="font-medium">Are you going?</h2>
        {viewerId ? (
          <>
            <RsvpButtons
              planId={plan.id}
              occurrence={repeating ? date.toISOString() : null}
              occurrenceStart={shown.start.toISOString()}
              myResponse={myResponse}
              answeredAll={!myDate}
            />
            {myResponse === "GOING" && <CalendarStatus added={onCalendar} canAdd={canAddToGoogle} code={code} />}
            {!myResponse && canAddToGoogle && (
              <p className="text-sm text-zinc-500">Tap Going and it&apos;s added to your Google Calendar.</p>
            )}
          </>
        ) : (
          <SignInButton label="Sign in with Google to RSVP" redirectTo={`/p/${code}`} />
        )}

        {/* Names only for signed-in viewers, so a forwarded link doesn't
            show strangers who's in the group. */}
        {viewerId ? (
          <div className="flex flex-col gap-1 text-sm">
            <p className="text-emerald-700 dark:text-emerald-400">
              Going{repeating && " this time"} ({going.length}): {going.map((r) => nameOf(r.user)).join(", ") || "nobody yet"}
            </p>
            {notGoing.length > 0 && (
              <p className="text-zinc-600 dark:text-zinc-400">
                Can&apos;t make it ({notGoing.length}): {notGoing.map((r) => nameOf(r.user)).join(", ")}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {going.length} going{notGoing.length > 0 && ` · ${notGoing.length} can't make it`}
          </p>
        )}
      </section>

      {repeating && <OtherDates plan={plan} shown={shown} viewerId={viewerId} code={code} />}

      {/* Manual options: for people who aren't signed in, or who use Apple
          Calendar instead of Google. */}
      <section className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <h2 className="text-sm font-medium text-zinc-500">
          {viewerId ? "Add it somewhere else" : "Add it to your calendar"}
        </h2>
        <AddToCalendar
          includeGoogle={!viewerId || !canAddToGoogle}
          plan={{
            id: plan.id,
            title: plan.title,
            start: plan.start.toISOString(),
            end: plan.end.toISOString(),
            location: plan.location,
            notes: plan.notes,
            timeZone: plan.timeZone,
            repeatFreq: plan.repeatFreq,
            repeatInterval: plan.repeatInterval,
            repeatWeekdays: plan.repeatWeekdays,
            repeatUntil: plan.repeatUntil,
            repeatCount: plan.repeatCount,
            shareCode: plan.shareCode,
            groupName: plan.group.name,
          }}
        />
      </section>

      <section className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <h2 className="text-sm font-medium text-zinc-500">Share this plan</h2>
        <CopyLink path={`/p/${code}`} label="Plan link" />
      </section>
    </>
  );
}

// The next few dates of a repeating plan, each with your answer, so you can
// jump to any of them (and answer it on its own).
function OtherDates({
  plan,
  shown,
  viewerId,
  code,
}: {
  plan: Plan;
  shown: ResolvedOccurrence;
  viewerId?: string;
  code: string;
}) {
  const dates = upcomingResolved(plan, plan.exceptions, new Date(), 6);
  if (dates.length === 0) return null;
  const mark = { GOING: "✓ Going", NOT_GOING: "✗ Can't" } as const;

  return (
    <section className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <h2 className="text-sm font-medium text-zinc-500">Upcoming dates</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {dates.map((d) => {
          const response = viewerId ? responseFor(viewerId, d.originalStart, plan.rsvps, plan.occurrenceRsvps) : null;
          const current = d.originalStart.getTime() === shown.originalStart.getTime();
          return (
            <li key={d.originalStart.toISOString()}>
              <Link
                href={`/p/${code}?at=${encodeURIComponent(d.originalStart.toISOString())}`}
                className={`flex justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
                  current ? "bg-zinc-100 font-medium dark:bg-zinc-900" : ""
                }`}
              >
                <span>
                  <LocalTimeRange start={d.start.toISOString()} end={d.end.toISOString()} short />
                  {d.changes.length > 0 && (
                    <span className="text-amber-700 dark:text-amber-400"> · different {describeChanges(d.changes)}</span>
                  )}
                </span>
                {response && (
                  <span className={response === "GOING" ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500"}>
                    {mark[response]}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Whether "Going" actually landed on their Google Calendar, and what to do if not.
function CalendarStatus({ added, canAdd, code }: { added: boolean; canAdd: boolean; code: string }) {
  if (added) {
    return (
      <p className="text-sm text-emerald-700 dark:text-emerald-400">
        ✓ On your Google Calendar (in the &quot;Group Cal&quot; calendar).
      </p>
    );
  }
  if (!canAdd) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-zinc-600 dark:text-zinc-400">
          Reconnect Google to have plans added to your calendar automatically.
        </p>
        <SignInButton label="Reconnect Google Calendar" redirectTo={`/p/${code}`} />
      </div>
    );
  }
  return (
    <p className="text-sm text-amber-700 dark:text-amber-400">
      Couldn&apos;t add it to your Google Calendar. Tap Going again to retry.
    </p>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-8 sm:px-6 sm:py-16">{children}</main>;
}
