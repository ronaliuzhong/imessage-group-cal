# Group Cal roadmap

Group Cal lets a group of friends see when they're all free, using everyone's
Google Calendar (free/busy only, never event details), and propose plans in
that free time.

## Long-term vision: one app, three faces

The end goal is **one native iOS app**, not three separate builds. It has
three "faces" that all share the same backend:

1. **The main app.** Open it directly, switch between friends and groups,
   view anyone's synced availability, propose times, and see history.
2. **An iMessage App Extension** (like GamePigeon). The same data, shown as
   an interactive bubble inside a group chat.
3. **A widget** (WidgetKit). Availability at a glance on the home or lock
   screen, e.g. "Sam is free until 3pm" or today's group overlap.

All three are separate targets in **one Xcode project with one App Store
listing**. They share data through an **App Group**, so they all read the
same synced calendar data instead of each fetching its own.

## Phases

| Phase | What | Status |
|---|---|---|
| 1 | **Web app**: the real engine; works for anyone with a browser | Live on Vercel |
| 2 | **iMessage App Extension**: native Swift, same backend | Not started |
| 3 | **Native app + widget**: same backend again | Not started |

### Phase 1 follow-ups

- Google OAuth verification (see below).
- Calendar drag: scroll the calendar while dragging near its top or bottom
  edge, and add handles to adjust a picked time range.

## Testing plan

The main round of testing happens on the native versions, but the web app
gets a light test first because it's the engine they all run on.

1. **Light web test:** 2–3 friends use the web app for real plans for about
   a week, to find backend bugs while they're cheap to fix in one place.
2. **Google verification**, started in the background (below).
3. **Phase 2 testers get the iMessage extension through TestFlight**
   (Apple's beta testing; up to 10,000 testers). Needs an Apple Developer
   account ($99/year) and Xcode.

Google's Testing-mode limits apply to the native apps too: they sign in with
the same Google project.

## Google verification

- **One review covers the web and native apps.** Google verifies the Google
  Cloud project, not each client. Changing the requested permissions, app
  name or logo means another review.
- Our calendar scopes are **sensitive, not restricted**: Google reviews them
  itself, with no paid outside security audit.
- **Testing mode** (now): at most 100 test users, each added by hand, and
  everyone's Google connection expires every 7 days.
- **Published but not yet verified:** anyone can sign in (no list) and
  connections stop expiring weekly, but people see an "unverified app"
  warning, and there's a 100-user cap.

Steps:

1. Buy a domain and connect it to Vercel (`.vercel.app` can't be verified
   as ours).
2. Add a public homepage and a privacy policy page on that domain. The
   policy must say exactly what Google data is used and why (free/busy
   only, never event details).
3. Verify the domain in Google Search Console.
4. Add the domain to the OAuth client's origins and redirect URIs.
5. Google Auth Platform → **Branding** (name, logo, homepage, privacy
   policy, authorized domain) and **Data Access** (each scope with a
   one-sentence reason).
6. Record a demo video (unlisted YouTube): the Google consent screen, then
   each permission in use.
7. **Audience → Publish app**, then submit in the **Verification Center**.
   Expect a few days to a few weeks, and follow-up emails.

## What this means for Phase 1

- Phases 2 and 3 reuse this backend, so keep logic on the server and shaped
  like an API a native app could call, not tied to the web pages.
- Plans are added to Google Calendar automatically when someone taps Going,
  so the iMessage extension never has to send people out of Messages.
