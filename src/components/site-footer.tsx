import Link from "next/link";
import { CONTACT_EMAIL } from "@/lib/site";

// On every page: the privacy policy and a way to reach us (Google's review
// and the App Store look for both; the App Store's "Support URL" is the
// homepage).
export function SiteFooter() {
  return (
    <footer className="mx-auto mt-auto flex w-full max-w-6xl flex-wrap gap-x-4 gap-y-1 px-4 py-6 text-xs text-zinc-500 sm:px-6">
      <span>© Coucal</span>
      <Link href="/privacy" className="hover:text-zinc-900 hover:underline dark:hover:text-zinc-100">Privacy policy</Link>
      <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-zinc-900 hover:underline dark:hover:text-zinc-100">
        Contact: {CONTACT_EMAIL}
      </a>
    </footer>
  );
}
