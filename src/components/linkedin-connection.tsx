"use client";

import { disconnectLinkedInAction } from "@/app/actions";
import { Button } from "@/components/ui";
import { useTransition } from "react";

export function LinkedInDisconnect() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="danger"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await disconnectLinkedInAction();
        })
      }
    >
      {pending ? "Disconnecting…" : "Disconnect LinkedIn"}
    </Button>
  );
}
