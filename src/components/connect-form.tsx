"use client";

import { useActionState } from "react";
import { connectSourceAction } from "@/app/actions";
import { Button, Field } from "@/components/ui";
import type { SourceCatalogEntry } from "@/lib/sources/types";

export function ConnectForm({ source }: { source: SourceCatalogEntry }) {
  const [state, action, pending] = useActionState(
    async (_prev: { error?: string } | null, formData: FormData) => connectSourceAction(formData),
    null
  );

  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="sourceType" value={source.type} />
      {source.fields.map((field) => (
        <Field
          key={field.key}
          name={field.key}
          label={field.label}
          type={field.secret ? "password" : "text"}
          placeholder={field.placeholder}
        />
      ))}
      {state?.error ? <p className="text-sm text-[#9b2c2c]">{state.error}</p> : null}
      {state && "ok" in state && state.ok ? (
        <p className="text-sm text-pine">Connected. Sync is running.</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Connecting…" : "Connect"}
      </Button>
    </form>
  );
}
