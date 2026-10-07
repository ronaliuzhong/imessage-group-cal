"use client";

import { useState } from "react";
import { deleteAccount } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";

// Two steps, since deleting can't be undone.
export function DeleteAccountButton() {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className="self-start text-sm text-red-600 underline hover:text-red-700 dark:text-red-400">
        Delete account
      </button>
    );
  }
  return (
    <form action={deleteAccount} className="flex flex-col gap-2 rounded-lg border border-red-300 p-3 text-sm dark:border-red-800">
      <p>
        This deletes your Coucal account: your groups (unless others are still in them), your answers, and
        the Coucal calendar in your Google Calendar. It can&apos;t be undone.
      </p>
      <div className="flex gap-3">
        <SubmitButton pendingLabel="Deleting…" className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700">
          Delete my account
        </SubmitButton>
        <button type="button" onClick={() => setConfirming(false)} className="text-zinc-500 underline">
          Cancel
        </button>
      </div>
    </form>
  );
}
