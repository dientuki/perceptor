"use client";
import type React from "react";
import { startTransition } from "react";

type StatefulFormProps = Omit<
  React.FormHTMLAttributes<HTMLFormElement>,
  "action"
> & {
  action: (formData: FormData) => void;
};

// A <form action={fn}> whose fields survive a failed submit.
//
// React resets every uncontrolled field of a form it owns the action of as
// soon as that action settles — which is right after a successful save, and
// wrong after a refused one: the user sees the error message over the empty
// inputs they just filled in (login), or over the server's stale values
// instead of the edits they were trying to save (settings).
//
// Submitting from onSubmit and handing the FormData to the action inside a
// transition keeps useActionState's pending/state exactly as it is with
// `action={formAction}` — React just never claims the form, so it never
// resets it. Native validation (`required`) still runs first: the browser
// only fires submit once the form is valid.
export default function StatefulForm({
  action,
  onSubmit,
  ...rest
}: StatefulFormProps) {
  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>) => {
    onSubmit?.(event);
    if (event.defaultPrevented) return;

    event.preventDefault();
    // The submitter is passed through so a named submit button contributes
    // its name/value, exactly as a native submit would.
    const formData = new FormData(event.currentTarget, event.submitter);
    startTransition(() => action(formData));
  };

  return <form {...rest} onSubmit={handleSubmit} />;
}
