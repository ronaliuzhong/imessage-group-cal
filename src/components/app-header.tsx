import Link from "next/link";
import { SignOutButton } from "@/components/auth-buttons";

export function AppHeader({ userName }: { userName: string }) {
  return (
    <header className="flex items-center justify-between border-b border-zinc-200 pb-4 dark:border-zinc-800">
      <Link href="/" className="text-xl font-semibold tracking-tight">
        Group Cal
      </Link>
      <div className="flex items-center gap-4">
        <span className="text-sm text-zinc-600 dark:text-zinc-400">{userName}</span>
        <SignOutButton />
      </div>
    </header>
  );
}
