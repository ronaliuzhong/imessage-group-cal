# Group Cal roadmap

Group Cal lets a group of friends see when they're all free, using everyone's
Google Calendar (free/busy only, never event details), and propose plans in
that free time.

## The group chat is the social graph

iMessage group chats already are the social graph Group Cal needs.
**Whoever is in a given thread is who we show availability for.** There is
no separate "add friends" flow and no friend list.

- **Keep:** the backend engine (calendar sync, overlap calculation, event
  creation). It's the core either way.
- **Out of scope (not deferred):** a standalone app for browsing or switching
  between friends, with its own social features or personal profiles.
- **The web app** only needs to onboard people (connect Google Calendar) and
  support proposing plans and glancing at availability for the members of a
  specific group or plan.
- **"Who's free right now"** at-a-glance view: always for one group's
  members, never a global friend list.

## Long-term vision: one app, several faces

The end goal is **one native iOS app**, not separate builds. Every face uses
the same backend and is scoped to a group:

1. **An iMessage App Extension** (like GamePigeon). The main experience:
   availability and plans shown as an interactive bubble inside a group chat.
2. **A widget** (WidgetKit). A group's availability at a glance on the home
   or lock screen, e.g. "Sam is free until 3pm" or today's overlap.
3. **The app you open from the home screen.** Kept minimal: setup (connect
   Google Calendar) and whatever the other faces need. No friend browsing.

All of them are separate targets in **one Xcode project with one App Store
listing**. They share data through an **App Group**, so they all read the
same synced calendar data instead of each fetching its own.

## Phases

| Phase | What | Status |
|---|---|---|
| 1 | **Web app**: the real engine, plus onboarding and group planning in a browser | Live on Vercel |
| 2 | **iMessage App Extension**: native Swift, same backend | Not started |
| 3 | **Widget + minimal home-screen app**: same backend again | Not started |

## Known limitations (for onboarding design later)

- Someone's availability only shows up if they've connected Google Calendar
  at least once.
- Once Phase 2 exists, only people with the app installed see the
  interactive bubble. Android users and anyone who hasn't installed it see
  a fallback (text and a link) instead.
- So the feature's value in each group depends on how many members finish
  setup. Onboarding should be designed with this in mind.

## Links now, bubbles in Phase 2

In Phase 1, people copy group invite links and plan links from the website
and paste them into the group chat, because there's no extension yet. In
Phase 2 the extension replaces this:

- Proposing a plan drops an interactive bubble into the chat; people answer
  Going / Can't make it right in the bubble.
- The bubble also works as the invite: using it puts you in that chat's
  group, so there's no separate invite link.
- Each bubble carries a web link behind it. Anyone without the app
  (including Android) gets that link, which opens today's plan and join
  pages. So those pages stay, as the fallback.

## iMessage extension: "Waiting for..." section

The overlap/glance view in the iMessage extension includes a **"Waiting
for..."** list of group members whose availability is missing:

- (a) in the thread but haven't installed the app, or
- (b) have the app but haven't connected Google Calendar yet.

Incomplete data is shown openly, so whoever is looking can see who's
missing and nudge them, instead of the overlap being silently wrong.

**To check when building Phase 2:** Apple doesn't tell iMessage extensions
who is in a chat. It gives anonymous IDs, not names or phone numbers.
- (b) works fully: once someone opens the extension, their ID can be linked
  to their Group Cal account.
- (a) may only be possible as a count ("2 people haven't set up Group Cal")
  in the extension's own screens. Message bubbles can show a participant's
  name using their ID, which may let the bubble name them. Work this out
  early in Phase 2.

The web app already does a version of (b): the group page lists members
whose calendar isn't connected.

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
