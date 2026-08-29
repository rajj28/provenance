"use client";

import { signInAction, signUpAction } from "@/app/actions";
import { Button, Field } from "@/components/ui";
import { useActionState } from "react";

type State = { error?: string } | null;

export function SignInForm() {
  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => (await signInAction(formData)) ?? null,
    null
  );

  return (
    <form action={action} className="mt-8 space-y-4">
      <Field name="email" label="Email" type="email" required />
      <Field name="password" label="Password" type="password" required />
      {state?.error ? <p className="text-sm text-[#9b2c2c]">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

export function SignUpForm() {
  const [state, action, pending] = useActionState<State, FormData>(
    async (_prev, formData) => (await signUpAction(formData)) ?? null,
    null
  );

  return (
    <form action={action} className="mt-8 space-y-4">
      <Field name="name" label="Name" placeholder="Ada Lovelace" />
      <Field name="email" label="Email" type="email" required />
      <Field name="password" label="Password" type="password" required />
      {state?.error ? <p className="text-sm text-[#9b2c2c]">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
