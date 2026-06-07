"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useUser } from "@/lib/auth/user-context";
import { DEMO_ACCOUNT_COPY, DEMO_RESET_COPY } from "@/lib/demo/shared";
import { logout } from "@/services/auth";

export default function DemoAccountNotice() {
  const { demoMode } = useUser();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  if (demoMode !== "demo-test") {
    return null;
  }

  return (
    <div className="sticky top-3 z-30 px-4 pt-3 sm:px-6">
      <div className="mx-auto max-w-5xl rounded-[1.5rem] border border-warm-border bg-[linear-gradient(180deg,rgba(255,214,246,0.14),rgba(183,124,255,0.14))] px-4 py-3 text-sm text-white shadow-[0_18px_34px_rgba(183,124,255,0.12)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-semibold text-warm-accent">Shared demo account</div>
            <p className="mt-1 text-text-secondary">{DEMO_ACCOUNT_COPY}</p>
            <p className="mt-1 text-xs text-text-muted">{DEMO_RESET_COPY}</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={leaving}
            className="shrink-0"
            onClick={() => {
              setLeaving(true);
              void logout()
                .then(() => router.replace("/"))
                .catch((error) => {
                  console.error("Failed to exit demo account.", error);
                  setLeaving(false);
                });
            }}
          >
            {leaving ? "Exiting..." : "Exit demo"}
          </Button>
        </div>
      </div>
    </div>
  );
}
