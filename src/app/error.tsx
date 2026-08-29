"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";

/**
 * Segment-level error boundary. In production Next replaces a server error's
 * message with a digest, so the digest is what we surface — it is the only
 * thing that ties a user report back to a server log line.
 */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(JSON.stringify({ level: "error", message: "client_boundary", digest: error.digest }));
  }, [error]);

  return (
    <div className="mx-auto max-w-xl px-5 py-24 text-center">
      <p className="text-xs uppercase tracking-[0.2em] text-copper-deep">Something broke</p>
      <h1 className="serif mt-3 text-4xl">This page could not load</h1>
      <p className="mt-3 text-ink-soft">
        The failure was logged. Trying again often works if it was a transient database or network problem.
      </p>
      {error.digest ? <p className="mt-2 text-xs text-ink-soft">Reference: {error.digest}</p> : null}
      <div className="mt-6 flex justify-center gap-3">
        <Button onClick={() => retry()}>Try again</Button>
        <Button variant="ghost" href="/app">
          Back to overview
        </Button>
      </div>
    </div>
  );
}
