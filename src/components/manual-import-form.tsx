"use client";

import { importManualEvidenceAction } from "@/app/actions";
import { Button, Field } from "@/components/ui";
import { useActionState, useState } from "react";

/**
 * Each option names the portfolio section the item will land in, so the choice
 * is obvious at import time rather than a surprise on the public page.
 */
const KINDS = [
  { value: "role", label: "Role / position → Experience" },
  { value: "project", label: "Project → Projects" },
  { value: "article", label: "Article, post, or talk → Writing & talks" },
  { value: "publication", label: "Publication → Publications" },
  { value: "certification", label: "Certification → Credentials" },
  { value: "achievement", label: "Achievement / award → Achievements" },
];

const SOURCES = [
  { value: "manual", label: "Other" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "hashnode", label: "Hashnode" },
  { value: "devpost", label: "Devpost" },
  { value: "notion", label: "Notion" },
  { value: "gdrive", label: "Google Drive / credential" },
  { value: "youtube", label: "YouTube" },
];

export function ManualImportForm() {
  const [sourceLabel, setSourceLabel] = useState("manual");
  const [state, action, pending] = useActionState(
    async (_prev: { error?: string; ok?: boolean } | null, formData: FormData) =>
      importManualEvidenceAction(formData),
    null
  );

  return (
    <form action={action} className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="block text-sm sm:col-span-1">
        <span className="text-ink-soft">Type &amp; destination section</span>
        <select
          name="kind"
          className="mt-1.5 w-full rounded-2xl border border-ink/12 bg-white/80 px-3.5 py-2.5 text-sm"
          defaultValue="achievement"
        >
          {KINDS.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="text-ink-soft">Original source label</span>
        <select
          name="sourceLabel"
          value={sourceLabel}
          onChange={(e) => setSourceLabel(e.target.value)}
          className="mt-1.5 w-full rounded-2xl border border-ink/12 bg-white/80 px-3.5 py-2.5 text-sm"
        >
          {SOURCES.map((source) => (
            <option key={source.value} value={source.value}>
              {source.label}
            </option>
          ))}
        </select>
      </label>
      <Field name="title" label="Title" required placeholder="Best AI Project — Hackathon X" />
      <Field name="issuer" label="Issuer / org" placeholder="AWS, MLH, university…" />
      <Field name="date" label="Date" type="date" />
      <Field
        name="url"
        label="Evidence URL"
        placeholder={sourceLabel === "linkedin" ? "https://www.linkedin.com/posts/…" : "https://"}
      />
      <div className="sm:col-span-2">
        <Field
          name="summary"
          label="What can you prove?"
          textarea
          placeholder="Only facts you can back with the link or document."
        />
      </div>
      {sourceLabel === "linkedin" ? (
        <p className="text-xs text-ink-soft sm:col-span-2">
          LinkedIn does not let third-party apps read your posts or profile history, so paste the permalink and the
          facts yourself. It will be curated and filed like any other evidence.
        </p>
      ) : null}
      {state?.error ? <p className="text-sm text-[#9b2c2c] sm:col-span-2">{state.error}</p> : null}
      {state?.ok ? <p className="text-sm text-pine sm:col-span-2">Imported. Review it in the queue.</p> : null}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Importing…" : "Import evidence"}
        </Button>
      </div>
    </form>
  );
}
