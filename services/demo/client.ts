"use client";

import { signInWithDemoCustomToken } from "@/services/auth";

export async function signInToDemoAccount() {
  const response = await fetch("/api/demo/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  const payload = (await response.json().catch(() => null)) as
    | { token?: string; error?: string }
    | null;

  if (!response.ok || !payload?.token) {
    throw new Error(payload?.error || "Failed to start the demo account.");
  }

  await signInWithDemoCustomToken(payload.token);
}
