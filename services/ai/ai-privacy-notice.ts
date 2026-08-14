import { auth } from "@/services/firebase/client";

async function headers() {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in again to update this notice.");
  return { Authorization: `Bearer ${await user.getIdToken()}` };
}

export async function hasAcknowledgedAiPrivacyNotice(signal?: AbortSignal) {
  const response = await fetch("/api/ai/assistant/privacy-notice", {
    headers: await headers(),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error("Could not load AI notice status.");
  const result = (await response.json()) as { acknowledged?: unknown };
  return result.acknowledged === true;
}

export async function acknowledgeAiPrivacyNotice() {
  const response = await fetch("/api/ai/assistant/privacy-notice", {
    method: "POST",
    headers: await headers(),
  });
  if (!response.ok) throw new Error("Could not save AI notice status.");
}
