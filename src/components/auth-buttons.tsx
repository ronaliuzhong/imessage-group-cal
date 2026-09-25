import { signInWithGoogle, signOutAction } from "@/app/actions";

// `redirectTo` is where to land after Google sends the user back, e.g. an
// invite page, so they can finish joining.
export function SignInButton({ label, redirectTo = "/" }: { label: string; redirectTo?: string }) {
  return (
    <form action={signInWithGoogle.bind(null, redirectTo)}>
      <button className="rounded-lg bg-black px-4 py-2 font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200">
        {label}
      </button>
    </form>
  );
}

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button className="text-sm text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200">
        Sign out
      </button>
    </form>
  );
}
