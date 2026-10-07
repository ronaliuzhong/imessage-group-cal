import Link from "next/link";

// On every page: the privacy policy link Google's review and the App Store
// expect to find.
export function SiteFooter() {
  return (
    <footer className="mx-auto mt-auto flex w-full max-w-6xl gap-4 px-4 py-6 text-xs text-zinc-500 sm:px-6">
      <span>© Coucal</span>
      <Link href="/privacy" className="hover:text-zinc-900 hover:underline dark:hover:text-zinc-100">Privacy policy</Link>
    </footer>
  );
}
