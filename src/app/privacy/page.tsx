import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy policy · Coucal",
  description: "What Coucal does with your information, including your Google Calendar data.",
};

// Coucal's privacy policy. Google's OAuth review and the App Store require
// one, and it must match what the code actually does (see src/lib/google.ts
// for the Google permissions, prisma/schema.prisma for what's stored, and
// src/lib/account.ts for deleting an account). Update it when those change.
const UPDATED = "October 7, 2026";

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12 sm:px-6 sm:py-16">
      <div>
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">← Coucal</Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Privacy policy</h1>
        <p className="text-sm text-zinc-500">Last updated {UPDATED}</p>
      </div>

      <Section title="The short version">
        <p>
          Coucal helps groups of friends find times when everyone is free. To do that it reads when you&apos;re
          busy from your Google Calendar, never what your events are, and it only shares those busy/free times
          with people in groups you join. We don&apos;t sell your information, show ads, or use it for anything
          other than running Coucal.
        </p>
      </Section>

      <Section title="What Coucal accesses in your Google account">
        <p>When you sign in with Google, Coucal asks for these permissions:</p>
        <ul>
          <li>
            <strong>Your name, email address and profile picture</strong>, to create your account and show your
            name to people in your groups.
          </li>
          <li>
            <strong>Free/busy information</strong> for your calendars: only the start and end times of busy
            periods. This permission cannot read event titles, descriptions, locations or guests, and Coucal never
            sees them.
          </li>
          <li>
            <strong>The list of your calendars</strong> (their names and whether you own them), so calendars you
            own count as busy time and you can choose which calendars count. Calendar names are shown only to you.
          </li>
          <li>
            <strong>Calendars that Coucal creates</strong>: Coucal creates one calendar named &quot;Coucal&quot; in
            your account and adds, updates and removes plans you&apos;re going to on it. It cannot read or change
            any of your other calendars or events.
          </li>
        </ul>
      </Section>

      <Section title="What we store">
        <ul>
          <li>Your account details from Google: name, email address, profile picture.</li>
          <li>
            The sign-in keys Google gives us so Coucal can check your free/busy times when a friend looks at a
            group. They&apos;re encrypted before they&apos;re stored.
          </li>
          <li>Your choices about which of your calendars count as busy.</li>
          <li>
            Groups you create or join, plans proposed in them (name, time, length, location and notes), and your
            answers (going or can&apos;t make it).
          </li>
          <li>The color you pick for a group or plan.</li>
          <li>
            On iPhone, a sign-in key for the Coucal app. Only a scrambled version is stored on our servers; the
            key itself stays in your iPhone&apos;s secure storage.
          </li>
        </ul>
        <p>
          We don&apos;t store your busy/free times: Coucal asks Google for them each time a group calendar is
          viewed.
        </p>
      </Section>

      <Section title="Who can see your information">
        <ul>
          <li>
            <strong>People in your groups</strong> can see your name and when you&apos;re busy or free (not what
            you&apos;re doing), and your answers to plans.
          </li>
          <li>
            <strong>Anyone with a plan&apos;s link</strong> can see that plan&apos;s details and who&apos;s going,
            like a shared event invitation.
          </li>
          <li>
            <strong>Service providers</strong> that run Coucal store or process data on our behalf: Vercel
            (hosting), Neon (database) and Google (sign-in and Google Calendar).
          </li>
        </ul>
        <p>We don&apos;t sell or rent your information, and we don&apos;t use it for advertising.</p>
      </Section>

      <Section title="Google API Services User Data Policy">
        <p>
          Coucal&apos;s use and transfer of information received from Google APIs adheres to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" className="underline">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. Google user data is used only to provide Coucal&apos;s
          features, is never transferred to others except as needed to run the service or as required by law, is
          never used for advertising, and is never read by people except with your permission, for security, or
          as required by law.
        </p>
      </Section>

      <Section title="Deleting your data">
        <p>
          You can delete your account at any time: on the website, sign in and choose <strong>Delete account</strong>
          {" "}at the bottom of the home page; in the iPhone app, use <strong>Delete account</strong> in the menu.
          This deletes your account and answers, removes the Coucal calendar from your Google Calendar, removes
          groups where you were the last member, and disconnects Coucal from your Google account. Plans you
          proposed in groups with other people stay for them, without your name.
        </p>
        <p>
          You can also remove Coucal&apos;s access at any time in your{" "}
          <a href="https://myaccount.google.com/permissions" className="underline">Google account settings</a>.
        </p>
      </Section>

      <Section title="Children">
        <p>Coucal isn&apos;t meant for children under 13, and we don&apos;t knowingly collect their information.</p>
      </Section>

      <Section title="Changes and contact">
        <p>
          If we change this policy, we&apos;ll update the date at the top. Questions, or a request about your data?
          Email <a href={`mailto:${CONTACT_EMAIL}`} className="underline">{CONTACT_EMAIL}</a>.
        </p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 text-zinc-700 dark:text-zinc-300 [&_li]:mt-1 [&_ul]:list-disc [&_ul]:pl-5">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
      {children}
    </section>
  );
}
