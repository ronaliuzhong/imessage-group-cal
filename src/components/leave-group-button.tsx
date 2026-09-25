"use client";

import { leaveGroup } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";

// Asks for confirmation first, since leaving the last spot deletes the group.
export function LeaveGroupButton({ groupId, isLastMember }: { groupId: string; isLastMember: boolean }) {
  const message = isLastMember
    ? "You're the only member, so leaving will delete this group. Continue?"
    : "Leave this group? You can rejoin later with the invite link.";

  return (
    <form
      action={leaveGroup.bind(null, groupId)}
      onSubmit={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      <SubmitButton
        pendingLabel="Leaving…"
        className="text-sm text-red-600 underline hover:text-red-700 dark:text-red-400"
      >
        {isLastMember ? "Leave and delete group" : "Leave group"}
      </SubmitButton>
    </form>
  );
}
