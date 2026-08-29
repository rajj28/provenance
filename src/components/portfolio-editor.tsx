"use client";

import { updatePortfolioItemAction } from "@/app/actions";
import { Button, Field } from "@/components/ui";
import { useActionState } from "react";

type Item = {
  id: string;
  title: string;
  summary: string;
  description: string;
  role: string | null;
  impact: string | null;
  published: boolean;
};

export function PortfolioEditor({ item }: { item: Item }) {
  const [state, action, pending] = useActionState(
    async (_prev: { ok?: boolean } | null, formData: FormData) => updatePortfolioItemAction(formData),
    null
  );

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={item.id} />
      <Field name="title" label="Title" defaultValue={item.title} />
      <Field name="summary" label="Short summary" defaultValue={item.summary} />
      <Field name="description" label="Description" textarea defaultValue={item.description} />
      <Field name="role" label="Your role" defaultValue={item.role || ""} />
      <Field name="impact" label="Impact (only what evidence supports)" defaultValue={item.impact || ""} />
      <label className="flex items-center gap-2 text-sm text-ink-soft">
        <input type="checkbox" name="published" defaultChecked={item.published} />
        Published on public page
      </label>
      {state?.ok ? <p className="text-sm text-pine">Updated.</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save item"}
      </Button>
    </form>
  );
}
