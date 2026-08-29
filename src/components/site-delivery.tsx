"use client";

import {
  connectSiteAction,
  disconnectSiteAction,
  publishSiteNowAction,
  scanSiteContentAction,
  selectContentFileAction,
} from "@/app/actions";
import { Button, Field } from "@/components/ui";
import { useActionState, useState, useTransition } from "react";

type Target = {
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
  mode: string;
  strategy: string;
  lastPublishedAt: Date | null;
  lastCommitUrl: string | null;
  lastError: string | null;
};

/** The copy-paste snippet for option A. Works on any site, any framework. */
export function EmbedSnippet({ appUrl, slug }: { appUrl: string; slug: string }) {
  const [copied, setCopied] = useState(false);
  const snippet = `<div id="provenance"></div>\n<script src="${appUrl}/embed.js" data-slug="${slug}" data-styles="basic"></script>`;

  return (
    <div>
      <pre className="mt-3 overflow-x-auto rounded-2xl border border-ink/12 bg-white/70 p-3 text-xs leading-5">
        <code>{snippet}</code>
      </pre>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          className="text-xs text-copper-deep hover:underline"
          onClick={() => {
            navigator.clipboard?.writeText(snippet).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              },
              () => setCopied(false)
            );
          }}
        >
          {copied ? "Copied" : "Copy snippet"}
        </button>
        <a
          href={`${appUrl}/api/portfolio/${slug}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-ink-soft hover:text-ink"
        >
          View the raw JSON
        </a>
      </div>
      <p className="mt-2 text-xs text-ink-soft">
        Ships no styling of its own unless you ask for it. Every element has a stable <code>pv-</code> class, so your
        site&apos;s CSS controls how it looks. Drop <code>data-styles=&quot;basic&quot;</code> for zero CSS, or add{" "}
        <code>data-sections=&quot;projects,writing&quot;</code> to place sections separately.
      </p>
    </div>
  );
}

export function SiteRepoForm({ target }: { target: Target | null }) {
  const [state, action, pending] = useActionState(
    async (_prev: { error?: string; ok?: boolean } | null, formData: FormData) => connectSiteAction(formData),
    null
  );
  const [publishing, startPublish] = useTransition();
  const [publishResult, setPublishResult] = useState<{ message?: string; url?: string; error?: string } | null>(null);
  const [editing, setEditing] = useState(!target);

  if (target && !editing) {
    return (
      <div className="mt-3 space-y-2">
        <p className="text-sm">
          {target.owner}/{target.repo}
          <span className="text-ink-soft">
            {" "}
            · {target.branch} · {target.filePath}
          </span>
        </p>
        <p className="text-xs text-ink-soft">
          {target.strategy === "append"
            ? "Appends new rows to your existing content file."
            : "Manages a dedicated portfolio data file."}{" "}
          {target.mode === "pr" ? "Opens a pull request for each change." : "Commits straight to the branch."}{" "}
          {target.lastPublishedAt ? `Last published ${target.lastPublishedAt.toLocaleString()}.` : "Not published yet."}
        </p>
        {target.lastError ? <p className="text-xs text-[#9b2c2c]">Last error: {target.lastError}</p> : null}
        {target.lastCommitUrl ? (
          <a href={target.lastCommitUrl} target="_blank" rel="noreferrer" className="text-xs text-copper-deep">
            View last change on GitHub
          </a>
        ) : null}

        {publishResult?.error ? <p className="text-xs text-[#9b2c2c]">{publishResult.error}</p> : null}
        {publishResult?.message ? (
          <p className="text-xs text-pine">
            {publishResult.message}{" "}
            {publishResult.url ? (
              <a href={publishResult.url} target="_blank" rel="noreferrer" className="text-copper-deep">
                Open
              </a>
            ) : null}
          </p>
        ) : null}

        <ContentScanner currentPath={target.filePath} strategy={target.strategy} />

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            disabled={publishing}
            onClick={() =>
              startPublish(async () => {
                setPublishResult(null);
                setPublishResult(await publishSiteNowAction());
              })
            }
          >
            {publishing ? "Publishing…" : "Publish now"}
          </Button>
          <Button variant="ghost" onClick={() => setEditing(true)}>
            Change
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              startPublish(async () => {
                await disconnectSiteAction();
              })
            }
          >
            Disconnect
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="mt-3 grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field
          name="repo"
          label="Repository"
          required
          placeholder="your-name/your-site"
          defaultValue={target ? `${target.owner}/${target.repo}` : undefined}
        />
      </div>
      <Field name="branch" label="Branch" placeholder="main" defaultValue={target?.branch || "main"} />
      <Field
        name="filePath"
        label="File to write"
        placeholder="data/portfolio.json"
        defaultValue={target?.filePath || "data/portfolio.json"}
      />
      <label className="block text-sm sm:col-span-2">
        <span className="text-ink-soft">What should we write?</span>
        <select
          name="strategy"
          defaultValue={target?.strategy || "file"}
          className="mt-1.5 w-full rounded-2xl border border-ink/12 bg-white/80 px-3.5 py-2.5 text-sm"
        >
          <option value="file">Own a data file — we manage one portfolio.json, you wire it up once</option>
          <option value="append">Append to the file my site already uses — add rows, change nothing else</option>
        </select>
        <span className="mt-1 block text-xs text-ink-soft">
          Append mode reads your existing entries, copies their exact field names, and only ever adds new rows. It
          never edits or removes anything that is already there, and never touches your components.
        </span>
      </label>

      <label className="block text-sm">
        <span className="text-ink-soft">How to apply changes</span>
        <select
          name="mode"
          defaultValue={target?.mode || "pr"}
          className="mt-1.5 w-full rounded-2xl border border-ink/12 bg-white/80 px-3.5 py-2.5 text-sm"
        >
          <option value="pr">Open a pull request (review before it goes live)</option>
          <option value="commit">Commit straight to the branch</option>
        </select>
      </label>
      <div className="sm:col-span-2">
        <Field name="token" label="GitHub token with Contents: write" type="password" required placeholder="github_pat_…" />
      </div>
      <p className="text-xs text-ink-soft sm:col-span-2">
        Use a <strong>fine-grained</strong> token scoped to this one repository, with{" "}
        <strong>Contents: Read and write</strong> (and <strong>Pull requests: Read and write</strong> for PR mode).
        Stored encrypted and never shown again. This is separate from your GitHub source connection on purpose —
        reading your public activity and writing to a repo are different grants.
      </p>
      {state?.error ? <p className="text-sm text-[#9b2c2c] sm:col-span-2">{state.error}</p> : null}
      {state?.ok ? <p className="text-sm text-pine sm:col-span-2">Connected. Use Publish now to write the first file.</p> : null}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Verifying access…" : "Connect repository"}
        </Button>
        {target ? (
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}


type Candidate = {
  path: string;
  entryCount: number;
  fields: string[];
  unmapped: string[];
  kind: "json" | "module";
  exportName: string | null;
  opaqueKeys: string[];
};

/**
 * Finds the content file the member's site already renders and lets them point
 * append mode at it, so they never have to know where their generator looks.
 */
function ContentScanner({ currentPath, strategy }: { currentPath: string; strategy: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{
    candidates?: Candidate[];
    rejected?: { path: string; reason: string }[];
    error?: string;
  } | null>(null);

  return (
    <div className="mt-3 rounded-2xl border border-ink/12 bg-white/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-soft">
          {strategy === "append"
            ? "Appending to your existing content file."
            : "Want us to append to a file your site already renders instead?"}
        </p>
        <button
          className="text-xs text-copper-deep hover:underline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setResult(null);
              setResult(await scanSiteContentAction());
            })
          }
        >
          {pending ? "Scanning…" : "Scan repository"}
        </button>
      </div>

      {result?.error ? <p className="mt-2 text-xs text-[#9b2c2c]">{result.error}</p> : null}

      {result?.candidates?.length ? (
        <ul className="mt-2 space-y-2">
          {result.candidates.map((candidate) => (
            <li key={candidate.path} className="rounded-xl border border-ink/10 bg-white/70 p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <code className="text-xs">
                  {candidate.path}
                  {candidate.exportName ? ` → ${candidate.exportName}` : ""}
                </code>
                {candidate.path === currentPath && strategy === "append" ? (
                  <span className="text-[11px] text-pine">In use</span>
                ) : (
                  <button
                    className="text-[11px] text-copper-deep hover:underline"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await selectContentFileAction(candidate.path);
                        if (res.error) setResult({ error: res.error });
                      })
                    }
                  >
                    Append here
                  </button>
                )}
              </div>
              <p className="mt-1 text-[11px] text-ink-soft">
                {candidate.kind === "module" ? "Source module" : "JSON data"} · {candidate.entryCount} existing{" "}
                {candidate.entryCount === 1 ? "entry" : "entries"} · we would write{" "}
                {candidate.fields.join(", ") || "no fields"}
                {candidate.unmapped.length ? ` · left blank: ${candidate.unmapped.join(", ")}` : ""}
              </p>
              {candidate.opaqueKeys.length ? (
                <p className="mt-0.5 text-[11px] text-ink-soft">
                  Not statically readable, so never written: {candidate.opaqueKeys.join(", ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : result?.candidates ? (
        <p className="mt-2 text-xs text-ink-soft">
          No usable content file found. JSON data files and modules exporting a hardcoded array are scanned in data/,
          src/data/, _data/, content/, src/ and lib/. Arrays built from spreads or function calls are refused rather
          than guessed at.
        </p>
      ) : null}

      {result?.rejected?.length ? (
        <ul className="mt-2 space-y-1">
          {result.rejected.map((r) => (
            <li key={r.path} className="text-[11px] text-ink-soft">
              <code>{r.path}</code> — {r.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
