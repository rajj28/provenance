"use client";

import { disconnectSourceAction, syncNowInlineAction } from "@/app/actions";
import { Button } from "@/components/ui";
import { useState, useTransition } from "react";

export function ConnectionControls({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ error?: string } | void>) {
    setError(null);
    start(async () => {
      const result = await fn();
      if (result && "error" in result && result.error) setError(result.error);
    });
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending} onClick={() => run(() => syncNowInlineAction(id))}>
          {pending ? "Syncing…" : "Sync now"}
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={pending}
          onClick={() => run(() => disconnectSourceAction(id))}
        >
          Disconnect
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm text-[#9b2c2c]">{error}</p> : null}
    </div>
  );
}
