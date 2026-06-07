"use client";

import { auth } from "@/services/firebase/client";
import { signInWithDemoCustomToken } from "@/services/auth";
import { getDemoEntryBlockReason } from "@/lib/demo/entry";

export async function signInToDemoAccount() {
  const currentUser = auth.currentUser;
  if (currentUser) {
    const tokenResult = await currentUser.getIdTokenResult();
    const blockReason = getDemoEntryBlockReason({
      hasCurrentUser: true,
      currentUserIsDemo: tokenResult.claims.demo === true,
    });
    if (blockReason) {
      throw new Error(blockReason);
    }

    return currentUser;
  }

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

  return signInWithDemoCustomToken(payload.token);
}
