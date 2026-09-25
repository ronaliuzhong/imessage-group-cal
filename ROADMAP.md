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

- Google OAuth verification. Until then the app is in Testing mode: at most
  100 test users, each added by hand, and everyone's Google connection
  expires every 7 days.
- Calendar drag: scroll the calendar while dragging near its top or bottom
  edge, and add handles to adjust a picked time range.

## What this means for Phase 1

- Phases 2 and 3 reuse this backend, so keep logic on the server and shaped
  like an API a native app could call, not tied to the web pages.
- Plans are added to Google Calendar automatically when someone taps Going,
  so the iMessage extension never has to send people out of Messages.
