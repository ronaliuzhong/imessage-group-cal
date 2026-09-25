"use client";

import { useFormStatus } from "react-dom";

// A form's submit button that disables itself while the form is being sent,
// so a double-click (or click + Enter) can't submit twice.
export function SubmitButton({
  children,
  pendingLabel,
  className,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className: string;
}) {
  const { pending } = useFormStatus(); // reports on the <form> this button is inside
  return (
    <button type="submit" disabled={pending} className={`${className} disabled:cursor-wait disabled:opacity-60`}>
      {pending ? pendingLabel : children}
    </button>
  );
}
