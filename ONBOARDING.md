# Welcome to Group Cal

Group Cal shows a group of friends when they're all free, using everyone's
Google Calendar, and lets them propose plans in that free time. The group
chat is the social graph: whoever is in a group is who we show availability
for.

- **Now (Phase 1):** a web app, live on Vercel. It's the engine.
- **Next (Phase 2):** an iMessage App Extension in Swift, using the same
  backend.
- **Later (Phase 3):** a widget and a minimal home-screen app.

The full plan, including decisions and known limitations, is in
[ROADMAP.md](ROADMAP.md). Read it after this.

## Ground rules

These were decided on purpose. Please don't change them without talking to
the project owner first.

- **Privacy: free/busy only.** We never read the titles or details of
  anyone's own events. The Google permissions are `calendar.freebusy`,
  `calendar.calendarlist.readonly` (so every calendar someone owns counts;
  calendar names are shown only to their owner) and `calendar.app.created`
  (we write plans only into a "Group Cal" calendar that the app creates).
- **No friend system.** No friend lists, profiles or "add friends" flow.
  That's out of scope, not just postponed.
- **No emails or texts sent by the app.** People paste group and plan links
  into their group chat themselves (in Phase 2, the iMessage bubble replaces
  this).
- **Hosted database only** (Neon Postgres). Never a database that depends on
  someone's laptop.
- **Keep logic on the server,** shaped so the iPhone app can reuse it.

## Tech stack

- **Next.js 16** (App Router) with React and **Tailwind CSS v4**. This Next.js
  version has breaking changes from older ones; see [AGENTS.md](AGENTS.md).
  Its docs are in `node_modules/next/dist/docs/`.
- **Prisma 7** with **Neon Postgres**. The generated client lives in
  `src/generated/prisma` and isn't in git; `npm run build` regenerates it.
- **Auth.js** with Google sign-in. Google tokens are encrypted in the
  database (`src/lib/crypto.ts`).
- **Vitest** for unit tests.
- **Vercel** for hosting. Every push to `main` deploys to the live site.

## Getting set up

### 1. Accounts (the project owner does these for you)

- Add you as a collaborator on the GitHub repo.
- Add your Gmail address as a **test user** in the Google Cloud console. The
  Google app is in Testing mode, so only listed people can sign in.
- Create a **database for you** in Neon and send you its two connection
  strings (pooled and direct). Everyone gets their own development database,
  so nobody's testing clashes with anyone else's.
- Send you `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` through a password
  manager or another private channel. Never through git.

### 2. Get the code running

You need Node.js 22 or newer.

```sh
git clone https://github.com/ronaliuzhong/imessage-group-cal.git
cd imessage-group-cal
npm install
```

Create a file named `.env` in the project folder. It's ignored by git, so
it stays on your machine:

```sh
DATABASE_URL="…"          # your Neon database, pooled (host has "-pooler")
DIRECT_DATABASE_URL="…"   # your Neon database, direct (no "-pooler")
AUTH_SECRET="…"           # make your own: openssl rand -base64 32
TOKEN_ENCRYPTION_KEY="…"  # make your own: openssl rand -base64 32
AUTH_GOOGLE_ID="…"        # from the project owner
AUTH_GOOGLE_SECRET="…"    # from the project owner
```

Then set up your database's tables and start the app:

```sh
npx prisma migrate deploy   # creates the tables in your database
npm run dev                 # starts the app at http://localhost:3000
```

Open http://localhost:3000 and sign in with Google. Use port 3000: it's the
only local address Google is set up to accept.

### 3. Check that everything works

```sh
npm test            # unit tests (Vitest)
npx tsc --noEmit    # type-check
npm run lint        # ESLint
```

## Where things are

| Path | What it is |
|---|---|
| `src/app/page.tsx` | Home: your week, your groups, create a group |
| `src/app/groups/[id]/page.tsx` | A group: who's free, upcoming plans, propose a time |
| `src/app/p/[code]/` | A plan's page (the link people share), plus edit and `.ics` download |
| `src/app/join/[code]/` | Joining a group from an invite link |
| `src/app/actions.ts` | Server Actions: everything that changes data |
| `src/components/week-calendar.tsx` | The calendar grid (free/busy heat map, plans, click/drag to pick a time) |
| `src/lib/availability.ts` | Overlap math: who's free when |
| `src/lib/google.ts` | Talking to Google Calendar |
| `src/lib/calendar-sync.ts` | Keeping each person's "Group Cal" calendar in step with their plans |
| `src/lib/recurrence.ts`, `plan-occurrences.ts`, `edit-all.ts` | Repeating plans and "this / following / all" edits |
| `prisma/schema.prisma` | The database tables |

## Everyday workflow

- **Pushing to `main` puts your change live.** Vercel builds it and runs any
  new database migrations on the production database. Work on a branch and
  merge when it's ready.
- **Branches get preview deployments** on Vercel. They never run database
  migrations (only production builds do; see `vercel-build` in
  `package.json`), but they may use the production database for data, so
  be careful what you create in a preview.
- **Changing the database:** edit `prisma/schema.prisma`, then run
  `npx prisma migrate dev --name what_changed`. Commit the new folder in
  `prisma/migrations/`. The next deploy applies it to production.

## Gotchas

- **After changing the Prisma schema, restart `npm run dev`.** The running
  server keeps the old database client, and pages fail with "Cannot read
  properties of undefined".
- **Migrations use the direct database connection** (`DIRECT_DATABASE_URL`;
  see `prisma.config.ts`). Through the pooled one, Prisma's migration lock
  can get stuck.
- **Testing a production build locally** (`npm run build && npm start`)
  needs `AUTH_TRUST_HOST=true` for that command, or sign-in fails. Vercel
  doesn't need it.
- **Don't keep the project in an iCloud-synced folder** (like Desktop or
  Documents). iCloud creates "… 2" duplicate files that break the build.
- **Your first "Going" creates a "Group Cal" calendar** in your Google
  Calendar. The live site and your local copy use different databases, so
  you may end up with two. Renaming the local one "Group Cal (test)" helps.

## Phase 2 (iMessage extension) needs

- **Xcode**, which needs macOS 26.6 or newer.
- Later, the project's Apple Developer account, for running on real phones
  and TestFlight.
