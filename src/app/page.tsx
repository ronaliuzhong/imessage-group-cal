import Link from "next/link";
import { auth } from "@/auth";
import { createGroup } from "@/app/actions";
import { AppHeader } from "@/components/app-header";
import { SignInButton } from "@/components/auth-buttons";
import { ReconnectNotice } from "@/components/reconnect-notice";
import { SubmitButton } from "@/components/submit-button";
import { WeekCalendar } from "@/components/week-calendar";
import { CalendarSettings } from "@/components/calendar-settings";
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
  if (!session?.user?.id) return <Landing />;

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
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <AppHeader userName={me.name} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold">Your week</h1>
          {me.busy && missing.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-700 dark:bg-amber-950">
              <div>
                <p>Reconnect Google so Group Cal can:</p>
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
        </aside>
      </div>
    </main>
  );
}

function Landing() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">Group Cal</h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">
        See when your friends are free — pulled straight from everyone&apos;s Google Calendar.
        No polls to fill out. We only ever see <strong>busy/free</strong> times, never what
        your events are.
      </p>
      <SignInButton label="Sign in with Google" />
    </main>
  );
}
