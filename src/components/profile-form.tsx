"use client";

import { updateProfileAction } from "@/app/actions";
import { Button, Field } from "@/components/ui";
import { useActionState } from "react";

type Profile = {
  name: string | null;
  slug: string;
  headline: string | null;
  bio: string | null;
  targetRole: string | null;
  location: string | null;
  publicPortfolio: boolean;
};

export function ProfileForm({ user }: { user: Profile }) {
  const [state, action, pending] = useActionState(
    async (_prev: { error?: string; ok?: boolean } | null, formData: FormData) =>
      updateProfileAction(formData),
    null
  );

  return (
    <form action={action} className="space-y-4">
      <Field name="name" label="Name" defaultValue={user.name || ""} />
      <Field name="slug" label="Public URL slug" defaultValue={user.slug} />
      <Field name="headline" label="Headline" defaultValue={user.headline || ""} placeholder="Backend engineer building evidence-backed systems" />
      <Field name="targetRole" label="Target role" defaultValue={user.targetRole || ""} placeholder="AI internship, backend engineering…" />
      <Field name="location" label="Location" defaultValue={user.location || ""} />
      <Field name="bio" label="Bio" textarea defaultValue={user.bio || ""} />
      <label className="flex items-center gap-2 text-sm text-ink-soft">
        <input type="checkbox" name="publicPortfolio" defaultChecked={user.publicPortfolio} />
        Public portfolio page
      </label>
      {state?.error ? <p className="text-sm text-[#9b2c2c]">{state.error}</p> : null}
      {state?.ok ? <p className="text-sm text-pine">Saved.</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}
