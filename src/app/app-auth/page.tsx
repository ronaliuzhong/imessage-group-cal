import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SignInButton } from "@/components/auth-buttons";
import { isValidChallenge } from "@/lib/app-auth";

// Where the iPhone app sends people to sign in (see src/lib/app-auth.ts). It
// opens in a browser window inside the app; after Google, the finish route
// hands control back to the app.
export default async function AppAuthPage({ searchParams }: PageProps<"/app-auth">) {
  const { challenge } = await searchParams;
  if (!isValidChallenge(challenge)) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold">This sign-in link doesn&apos;t work</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Close this window and try signing in from the app again.</p>
      </Shell>
    );
  }

  const finish = `/api/app/auth/finish?challenge=${challenge}`;
  if ((await auth())?.user?.id) redirect(finish);

  return (
    <Shell>
      <h1 className="text-2xl font-semibold">Sign in to Coucal</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Connect your Google Calendar so your group can see when you&apos;re free. We only ever
        see <strong>busy/free</strong> times, never what your events are.
      </p>
      <SignInButton label="Sign in with Google" redirectTo={finish} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-12 sm:px-6 sm:py-24">{children}</main>;
}
