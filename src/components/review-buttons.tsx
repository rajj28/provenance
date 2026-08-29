"use client";

import { reviewEvidenceAction } from "@/app/actions";
import { Button } from "@/components/ui";
import { useState, useTransition } from "react";

export function ReviewButtons({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function decide(decision: "approved" | "rejected") {
    setError(null);
    start(async () => {
      const result = await reviewEvidenceAction(id, decision);
      if ("error" in result && result.error) setError(result.error);
    });
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending} onClick={() => decide("approved")}>
          Approve
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => decide("rejected")}>
          Reject
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm text-[#9b2c2c]">{error}</p> : null}
    </div>
  );
}
