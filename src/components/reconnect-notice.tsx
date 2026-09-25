import { SignInButton } from "@/components/auth-buttons";

// Shown when we can't read the viewer's own calendar. Signing in again gets
// fresh tokens (see events.signIn in src/auth.ts).
export function ReconnectNotice({ redirectTo = "/" }: { redirectTo?: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950">
      <p>
        We can&apos;t see your calendar availability. Reconnect and make sure the &quot;See your
        availability&quot; box is checked on Google&apos;s screen.
      </p>
      <SignInButton label="Reconnect Google Calendar" redirectTo={redirectTo} />
    </div>
  );
}
