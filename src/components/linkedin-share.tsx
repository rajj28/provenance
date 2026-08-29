"use client";

import { draftLinkedInPostAction, shareToLinkedInAction } from "@/app/actions";
import { Button } from "@/components/ui";
import { useState, useTransition } from "react";

const MAX = 3000;

type Props = {
  portfolioItemId: string;
  /** Null when no LinkedIn account is connected; the UI then explains why. */
  connected: boolean;
  needsReconnect: boolean;
  alreadySharedUrl?: string | null;
};

/**
 * Explicit share control.
 *
 * The member opens the composer, sees the exact text that will be published,
 * edits it, and presses Post. There is no path in this component that publishes
 * without that confirmation — posting to someone's LinkedIn feed is public and
 * effectively irreversible, so it is never automatic.
 */
export function LinkedInShare({ portfolioItemId, connected, needsReconnect, alreadySharedUrl }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [visibility, setVisibility] = useState<"PUBLIC" | "CONNECTIONS">("PUBLIC");
  const [error, setError] = useState<string | null>(null);
  const [postedUrl, setPostedUrl] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!connected) {
    return (
      <p className="mt-3 text-xs text-ink-soft">
        <a href="/app/sources#linkedin" className="text-copper-deep">
          Connect LinkedIn
        </a>{" "}
        to share this item as a post.
      </p>
    );
  }

  if (needsReconnect) {
    return (
      <p className="mt-3 text-xs text-[#9b2c2c]">
        LinkedIn authorisation expired.{" "}
        <a href="/api/integrations/linkedin/start" className="text-copper-deep">
          Reconnect
        </a>
        .
      </p>
    );
  }

  function openComposer() {
    setError(null);
    setPostedUrl(null);
    setOpen(true);
    if (text) return;
    start(async () => {
      const result = await draftLinkedInPostAction(portfolioItemId);
      if ("error" in result && result.error) setError(result.error);
      else if ("text" in result && result.text) setText(result.text);
    });
  }

  function publish() {
    setError(null);
    start(async () => {
      const result = await shareToLinkedInAction(portfolioItemId, text, visibility);
      if (result.error) setError(result.error);
      else if (result.postUrl) {
        setPostedUrl(result.postUrl);
        setOpen(false);
      }
    });
  }

  const remaining = MAX - text.length;

  return (
    <div className="mt-3">
      {!open ? (
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={openComposer} className="text-xs text-copper-deep hover:underline" disabled={pending}>
            {pending ? "Preparing…" : "Share on LinkedIn"}
          </button>
          {postedUrl ? (
            <a href={postedUrl} target="_blank" rel="noreferrer" className="text-xs text-pine">
              Posted — view on LinkedIn
            </a>
          ) : alreadySharedUrl ? (
            <a href={alreadySharedUrl} target="_blank" rel="noreferrer" className="text-xs text-ink-soft">
              Previously shared
            </a>
          ) : null}
        </div>
      ) : (
        <div className="rounded-2xl border border-ink/12 bg-white/60 p-3">
          <p className="text-xs text-ink-soft">
            This exact text will be posted to your LinkedIn feed. Edit it first — only claim what the evidence supports.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="mt-2 min-h-40 w-full rounded-2xl border border-ink/12 bg-white/80 px-3.5 py-2.5 text-sm outline-none focus:border-copper"
            placeholder={pending ? "Drafting…" : "Write your post"}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="text-xs text-ink-soft">
              Audience{" "}
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as "PUBLIC" | "CONNECTIONS")}
                className="rounded-full border border-ink/12 bg-white/80 px-2 py-1 text-xs"
              >
                <option value="PUBLIC">Anyone</option>
                <option value="CONNECTIONS">Connections only</option>
              </select>
            </label>
            <span className={`text-xs ${remaining < 0 ? "text-[#9b2c2c]" : "text-ink-soft"}`}>
              {remaining} characters left
            </span>
          </div>
          {error ? <p className="mt-2 text-xs text-[#9b2c2c]">{error}</p> : null}
          <div className="mt-3 flex gap-2">
            <Button onClick={publish} disabled={pending || !text.trim() || remaining < 0}>
              {pending ? "Posting…" : "Post to LinkedIn"}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
