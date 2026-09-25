"use client";

import { useState, useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

// Shows a full URL for this site and copies it for pasting into a group chat.
// The URL is built in the browser (the server doesn't know which address you
// used), so it's right on localhost and on the deployed site alike.
export function CopyLink({ path, label }: { path: string; label: string }) {
  const origin = useSyncExternalStore(noopSubscribe, () => window.location.origin, () => "");
  const url = origin + path;
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex w-full max-w-md gap-2">
      <input
        readOnly
        value={url}
        aria-label={label}
        onFocus={(e) => e.target.select()}
        className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
      />
      <button
        onClick={copy}
        className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700"
      >
        {copied ? "Copied!" : "Copy link"}
      </button>
    </div>
  );
}
