import { cache } from "react";
import { prisma } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";

// The calendar permissions we request at sign-in. None can read the titles,
// locations, attendees or descriptions of anyone's own events, so the privacy
// rule is enforced by Google itself:
// - FREEBUSY: busy/free time ranges for a calendar.
// - CALENDAR_LIST: the list of calendars someone has (names and IDs only),
//   so we can include more than their main calendar.
// - APP_CALENDAR: create a separate "Group Cal" calendar in their account and
//   manage events on it — and ONLY on calendars this app created — so plans
//   they're going to appear in Google Calendar automatically.
export const FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
export const CALENDAR_LIST_SCOPE = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
export const APP_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export type BusyBlock = { start: string; end: string }; // ISO 8601 timestamps

export type UserCalendar = {
  id: string;
  name: string;
  primary: boolean;
  included: boolean; // does this calendar count as busy time?
};

// Thrown when we can't act on the user's behalf: they never granted calendar
// access, revoked it, or the refresh token expired (Google expires them after
// 7 days while the Cloud project is in "Testing" mode). The fix is always for
// that person to sign in again.
export class CalendarNotConnectedError extends Error {
  constructor(message = "Google Calendar is not connected") {
    super(message);
    this.name = "CalendarNotConnectedError";
  }
}

// Which of our permissions this person actually granted. Google's consent
// screen lets people untick checkboxes, so it may not be all of them.
export const getGrantedScopes = cache(async (userId: string) => {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
    select: { scope: true },
  });
  const scopes = account?.scope?.split(" ") ?? [];
  return {
    freeBusy: scopes.includes(FREEBUSY_SCOPE),
    calendarList: scopes.includes(CALENDAR_LIST_SCOPE),
    appCalendar: scopes.includes(APP_CALENDAR_SCOPE),
  };
});

// A valid access token plus what it's allowed to do. Wrapped in React's
// cache() so that within one page load we look this up (and refresh it) at
// most once per user, even if several functions need it.
const getConnection = cache(async (userId: string) => {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });
  const granted = await getGrantedScopes(userId);
  if (!account?.refresh_token || !granted.freeBusy) {
    throw new CalendarNotConnectedError();
  }
  const canListCalendars = granted.calendarList;

  // Reuse the current access token unless it expires within the next minute.
  const expiresAtMs = (account.expires_at ?? 0) * 1000;
  if (account.access_token && expiresAtMs > Date.now() + 60_000) {
    return { accessToken: decrypt(account.access_token), canListCalendars };
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: process.env.AUTH_GOOGLE_ID!,
      client_secret: process.env.AUTH_GOOGLE_SECRET!,
      grant_type: "refresh_token",
      refresh_token: decrypt(account.refresh_token),
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    if (data.error === "invalid_grant") throw new CalendarNotConnectedError();
    throw new Error(`Google token refresh failed: ${data.error ?? res.status}`);
  }

  await prisma.account.update({
    where: {
      provider_providerAccountId: {
        provider: "google",
        providerAccountId: account.providerAccountId,
      },
    },
    data: {
      access_token: encrypt(data.access_token),
      expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
      // Google usually omits a new refresh token here; keep the old one if so.
      ...(data.refresh_token && { refresh_token: encrypt(data.refresh_token) }),
    },
  });
  return { accessToken: data.access_token as string, canListCalendars };
});

// All of the user's calendars and whether each counts as busy time.
// Returns null if they didn't grant the calendar-list permission, in which
// case only their main calendar is used.
export const listCalendars = cache(async (userId: string): Promise<UserCalendar[] | null> => {
  const { accessToken, canListCalendars } = await getConnection(userId);
  if (!canListCalendars) return null;

  type Item = { id: string; summary?: string; summaryOverride?: string; accessRole: string; primary?: boolean };
  const items: Item[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${CALENDAR_API}/users/me/calendarList`);
    url.searchParams.set("fields", "nextPageToken,items(id,summary,summaryOverride,accessRole,primary)");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (res.status === 401) throw new CalendarNotConnectedError();
    if (!res.ok) throw new Error(`Google calendarList failed: ${res.status}`);
    const data: { items?: Item[]; nextPageToken?: string } = await res.json();
    items.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  const prefs = await prisma.calendarPreference.findMany({ where: { userId } });
  const choice = new Map(prefs.map((p) => [p.calendarId, p.included]));

  return items.map((item) => ({
    id: item.id,
    name: item.summaryOverride ?? item.summary ?? item.id,
    primary: Boolean(item.primary),
    // Default: calendars you own are your time. Calendars shared with you
    // (a coworker's), holidays and other subscriptions are not.
    included: choice.get(item.id) ?? (Boolean(item.primary) || item.accessRole === "owner"),
  }));
});

// Busy time ranges across all of the user's included calendars.
export async function getBusyBlocks(
  userId: string,
  timeMin: Date,
  timeMax: Date,
): Promise<BusyBlock[]> {
  const [{ accessToken }, calendars] = await Promise.all([
    getConnection(userId),
    listCalendars(userId),
  ]);
  const calendarIds = calendars
    ? calendars.filter((c) => c.included).map((c) => c.id)
    : ["primary"];
  if (calendarIds.length === 0) return [];

  const res = await fetch(`${CALENDAR_API}/freeBusy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      // Google accepts up to 50 calendars per request; nobody's hitting that.
      items: calendarIds.slice(0, 50).map((id) => ({ id })),
    }),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) throw new CalendarNotConnectedError();
  if (!res.ok) throw new Error(`Google freeBusy failed: ${res.status}`);

  const data: {
    calendars: Record<string, { busy?: BusyBlock[]; errors?: { reason: string }[] }>;
  } = await res.json();

  // Overlapping blocks from different calendars are fine: the availability
  // math treats "busy on any calendar" as busy.
  return Object.entries(data.calendars).flatMap(([calendarId, calendar]) => {
    if (calendar.errors?.length) {
      // One broken calendar (e.g. one that was just deleted) shouldn't hide the rest.
      console.warn(`freeBusy skipped calendar ${calendarId}: ${calendar.errors[0].reason}`);
      return [];
    }
    return calendar.busy ?? [];
  });
}

// ---------------------------------------------------------------------------
// Events on people's "Group Cal" calendar
//
// Small building blocks; src/lib/calendar-sync.ts decides what each person's
// calendar should contain and uses these to make it so. None of them throw:
// a calendar hiccup is logged and reported back, never allowed to break an
// RSVP or an edit.
// ---------------------------------------------------------------------------

// The shape of a Google Calendar event (just the fields we set).
export type EventBody = {
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
  start?: { dateTime: string; timeZone: string };
  end?: { dateTime: string; timeZone: string };
  recurrence?: string[];
  source?: { title: string; url: string };
};

// Returns the ID of this person's "Group Cal" calendar, creating it the first
// time. It's a separate calendar (not their main one) so it gets its own color
// in Google Calendar and can be hidden or deleted in one go.
async function getOrCreateAppCalendar(userId: string, accessToken: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { appCalendarId: true } });
  if (user.appCalendarId) return user.appCalendarId;

  const res = await fetch(`${CALENDAR_API}/calendars`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ summary: "Group Cal", description: "Plans you're going to, added by Group Cal." }),
  });
  if (!res.ok) throw new Error(`Couldn't create Group Cal calendar: ${res.status}`);
  const { id } = (await res.json()) as { id: string };
  await prisma.user.update({ where: { id: userId }, data: { appCalendarId: id } });
  return id;
}

// Calls the Calendar API for an event on this person's Group Cal calendar.
// Returns null if they haven't granted the permission or have no calendar yet.
async function eventRequest(userId: string, path: string, init: RequestInit): Promise<Response | null> {
  if (!(await getGrantedScopes(userId)).appCalendar) return null;
  const { appCalendarId } = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { appCalendarId: true },
  });
  if (!appCalendarId) return null;
  const { accessToken } = await getConnection(userId);
  return fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(appCalendarId)}/events${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  });
}

// Adds an event and returns its ID, or null if it couldn't.
export async function insertEvent(userId: string, body: EventBody): Promise<string | null> {
  try {
    if (!(await getGrantedScopes(userId)).appCalendar) return null;
    const { accessToken } = await getConnection(userId);
    const insert = (calendarId: string) =>
      fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    let res = await insert(await getOrCreateAppCalendar(userId, accessToken));
    // 404 = they deleted the Group Cal calendar in Google Calendar. Forget it,
    // make a new one, and try once more.
    if (res.status === 404) {
      await prisma.user.update({ where: { id: userId }, data: { appCalendarId: null } });
      res = await insert(await getOrCreateAppCalendar(userId, accessToken));
    }
    if (!res.ok) throw new Error(`events.insert failed: ${res.status}`);
    return ((await res.json()) as { id: string }).id;
  } catch (error) {
    console.error(`Couldn't add event for user ${userId}:`, error);
    return null;
  }
}

// Replaces an event entirely (PUT), so removed fields really go away. Returns
// false if the event is gone (they deleted it) or it otherwise failed.
export async function replaceEvent(userId: string, eventId: string, body: EventBody): Promise<boolean> {
  return writeEvent(userId, eventId, "PUT", body);
}

// Changes some fields of an event, e.g. one date of a repeating event.
export async function patchEvent(userId: string, eventId: string, body: EventBody): Promise<boolean> {
  return writeEvent(userId, eventId, "PATCH", body);
}

async function writeEvent(userId: string, eventId: string, method: "PUT" | "PATCH", body: EventBody) {
  try {
    const res = await eventRequest(userId, `/${encodeURIComponent(eventId)}`, { method, body: JSON.stringify(body) });
    if (!res || res.status === 404 || res.status === 410) return false;
    if (!res.ok) throw new Error(`events.${method.toLowerCase()} failed: ${res.status}`);
    return true;
  } catch (error) {
    console.error(`Couldn't update event for user ${userId}:`, error);
    return false;
  }
}

// Deletes an event (or one date of a repeating event). Already gone counts
// as success.
export async function deleteEvent(userId: string, eventId: string): Promise<void> {
  try {
    const res = await eventRequest(userId, `/${encodeURIComponent(eventId)}`, { method: "DELETE" });
    if (res && !res.ok && res.status !== 404 && res.status !== 410) {
      throw new Error(`events.delete failed: ${res.status}`);
    }
  } catch (error) {
    console.error(`Couldn't delete event for user ${userId}:`, error);
  }
}

// The ID of one date within a repeating event, found by when that date was
// originally meant to start. Null if there's no such date (e.g. it was
// already deleted from their calendar).
export async function findInstanceId(
  userId: string,
  recurringEventId: string,
  originalStart: Date,
): Promise<string | null> {
  try {
    const params = new URLSearchParams({ originalStart: originalStart.toISOString() });
    const res = await eventRequest(userId, `/${encodeURIComponent(recurringEventId)}/instances?${params}`, {
      method: "GET",
    });
    if (!res || !res.ok) return null;
    const data = (await res.json()) as { items?: { id: string; status?: string }[] };
    const instance = data.items?.find((i) => i.status !== "cancelled");
    return instance?.id ?? null;
  } catch (error) {
    console.error(`Couldn't look up event date for user ${userId}:`, error);
    return null;
  }
}
