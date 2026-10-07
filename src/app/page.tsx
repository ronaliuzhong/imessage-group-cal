import Link from "next/link";
import { auth } from "@/auth";
import { createGroup } from "@/app/actions";
import { AppHeader } from "@/components/app-header";
import { SignInButton } from "@/components/auth-buttons";
import { ReconnectNotice } from "@/components/reconnect-notice";
import { SubmitButton } from "@/components/submit-button";
import { WeekCalendar } from "@/components/week-calendar";
import { CalendarSettings } from "@/components/calendar-settings";
import { DeleteAccountButton } from "@/components/delete-account-button";
import { ColorPicker } from "@/components/color-picker";
import { viewerGroupColor } from "@/lib/colors";
import { fetchWindow, loadMembersBusy, parseWeekOffset } from "@/lib/calendar-data";
import { prisma } from "@/lib/db";
import { getGrantedScopes, listCalendars } from "@/lib/google";
import { loadCalendarPlans } from "@/lib/plans";

// A Server Component: runs on the server for each request, so it can read the
// session and talk to Google and the database directly.
export default async function Home({ searchParams }: PageProps<"/">) {
  const session = await auth();
  if (!session?.user?.id) return <Landing deleted={(await searchParams).deleted === "1"} />;

  const userId = session.user.id;
  const weekOffset = parseWeekOffset((await searchParams).week);
  const { timeMin, timeMax } = fetchWindow(weekOffset);

  // Both lookups are independent, so run them at the same time.
  const [user, memberships] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true, email: true } }),
    prisma.groupMember.findMany({
      where: { userId },
      include: { group: { include: { _count: { select: { members: true } } } } },
      orderBy: { joinedAt: "desc" },
    }),
  ]);
  // listCalendars is cached per request, so the busy lookup reuses this result.
  // If it fails (e.g. calendar not connected) the reconnect notice covers it.
  const [[me], calendars, scopes, plans] = await Promise.all([
    loadMembersBusy([user], timeMin, timeMax),
    listCalendars(userId).catch(() => undefined),
    getGrantedScopes(userId),
    loadCalendarPlans({ viewerId: userId, timeMin, timeMax, hideDeclined: true }),
  ]);
  // Permissions added after this person first signed in (or that they unticked).
  const missing = [
    !scopes.calendarList && "include your other calendars too (like classes or work)",
    !scopes.appCalendar && "add plans you're going to straight to your Google Calendar",
  ].filter(Boolean);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-3 py-4 sm:px-6 sm:py-8">
      <AppHeader userName={me.name} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold">Your week</h1>
          {me.busy && missing.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-700 dark:bg-amber-950">
              <div>
                <p>Reconnect Google so Coucal can:</p>
                <ul className="list-disc pl-5">
                  {missing.map((reason) => (
                    <li key={String(reason)}>{reason}</li>
                  ))}
                </ul>
              </div>
              <SignInButton label="Reconnect Google Calendar" />
            </div>
          )}
          {me.busy ? (
            <WeekCalendar
              members={[me]}
              viewerId={userId}
              weekOffset={weekOffset}
              variant="personal"
              plans={plans}
              showPlanGroup
            />
          ) : (
            <ReconnectNotice />
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">Your groups</h2>
          {memberships.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No groups yet. Create one, then text the invite link to your friends.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {memberships.map(({ group, color }) => (
                <li key={group.id}>
                  <Link
                    href={`/groups/${group.id}`}
                    className="block rounded-lg border border-zinc-200 border-l-4 px-4 py-3 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                    style={{ borderLeftColor: viewerGroupColor(group, { color }).hex }}
                  >
                    <div className="font-medium">{group.name}</div>
                    <div className="text-sm text-zinc-500">
                      {group._count.members} {group._count.members === 1 ? "member" : "members"}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <form action={createGroup} className="flex flex-col gap-2 rounded-lg border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
            <label htmlFor="group-name" className="text-sm font-medium">
              New group
            </label>
            <input
              id="group-name"
              name="name"
              required
              maxLength={60}
              placeholder="e.g. Roommates"
              className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
            />
            <ColorPicker name="color" />
            <SubmitButton
              pendingLabel="Creating…"
              className="rounded-lg bg-black px-4 py-2 font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
            >
              Create group
            </SubmitButton>
          </form>

          {calendars && <CalendarSettings calendars={calendars} />}

          <DeleteAccountButton />
        </aside>
      </div>
    </main>
  );
}

// The public homepage: what Coucal is, how it works, and exactly what it can
// see in someone's Google Calendar (Google's review checks for this).
function Landing({ deleted }: { deleted: boolean }) {
  const steps = [
    ["Connect Google Calendar", "Sign in with Google. Coucal sees when you're busy, never what your events are."],
    ["Start Coucal in a group chat", "Send the invite in iMessage, or share the group link. Friends join with one tap."],
    ["Pick a time everyone's free", "See the overlap at a glance, propose a plan, and it lands in everyone's calendar."],
  ];
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 py-12 sm:px-6 sm:py-20">
      {deleted && (
        <p className="rounded-lg bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-900">
          Your account was deleted. Thanks for trying Coucal.
        </p>
      )}
      <section className="flex flex-col gap-5">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Coucal</h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          See when your group chat is free, pulled straight from everyone&apos;s Google Calendar. No polls
          to fill out. Coucal only ever sees <strong>busy/free</strong> times, never what your events are.
        </p>
        <div>
          <SignInButton label="Sign in with Google" />
        </div>
        <p className="text-sm text-zinc-500">
          Coucal works in your web browser, and as an iMessage app on iPhone (in testing).
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">How it works</h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {steps.map(([title, text], i) => (
            <li key={title} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{i + 1}</div>
              <div className="mt-1 font-medium">{title}</div>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">What Coucal can see in your Google account</h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-zinc-600 dark:text-zinc-400">
          <li>When you&apos;re busy or free, from the calendars you own (not event names, places, notes or guests).</li>
          <li>The names of your calendars, shown only to you, so you can choose which ones count.</li>
          <li>A separate &quot;Coucal&quot; calendar it creates, where plans you&apos;re going to are added.</li>
        </ul>
        <p className="text-sm text-zinc-500">
          Details in our <Link href="/privacy" className="underline">privacy policy</Link>. You can delete your account at any time.
        </p>
      </section>
    </main>
  );
}
