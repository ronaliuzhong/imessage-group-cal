import { CalendarNotConnectedError, getBusyBlocks, type BusyBlock } from "@/lib/google";

const DAY_MS = 24 * 60 * 60 * 1000;

// Everything the calendar component needs about one person. `busy` is null
// when we couldn't read their calendar (not connected, or access expired).
export type CalendarMember = { id: string; name: string; busy: BusyBlock[] | null };

// "?week=2" in the URL means two weeks from now. Anything odd becomes 0, and
// we cap it so nobody can make us query Google for the year 3000.
export function parseWeekOffset(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(n) && n >= 0 && n <= 52 ? n : 0;
}

// Which time range to ask Google about for a given week. The browser shows
// Sunday–Saturday in the viewer's timezone, but the server doesn't know that
// timezone (or even which local day it is — up to ±14h from UTC). So we fetch
// generously around "today": from 8 days before (covers the local Sunday, 0–6
// days back, plus timezone slack) to 3 days after (covers the end of the local
// Saturday). The browser then picks out exactly the days it displays.
export function fetchWindow(weekOffset: number) {
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  const base = todayUtc.getTime() + weekOffset * 7 * DAY_MS;
  return { timeMin: new Date(base - 8 * DAY_MS), timeMax: new Date(base + 3 * DAY_MS) };
}

// Fetches everyone's busy blocks in parallel. One person's broken connection
// shouldn't break the page for the whole group, so failures become busy: null.
export async function loadMembersBusy(
  users: { id: string; name: string | null; email: string }[],
  timeMin: Date,
  timeMax: Date,
): Promise<CalendarMember[]> {
  const results = await Promise.allSettled(
    users.map((user) => getBusyBlocks(user.id, timeMin, timeMax)),
  );
  return users.map((user, i) => {
    const result = results[i];
    if (result.status === "rejected" && !(result.reason instanceof CalendarNotConnectedError)) {
      console.error(`Couldn't load calendar for user ${user.id}:`, result.reason);
    }
    return {
      id: user.id,
      name: user.name ?? user.email,
      busy: result.status === "fulfilled" ? result.value : null,
    };
  });
}
