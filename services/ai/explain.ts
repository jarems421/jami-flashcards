import { auth } from "@/services/firebase/client";

export async function getExplanation(
  front: string,
  back: string,
): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");

  const token = await user.getIdToken();

  const res = await fetch("/api/ai/explain", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ front, back }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Request failed (${res.status})`);
  }

  const data = await res.json();
  const text = typeof data.explanation === "string" ? data.explanation.trim() : "";
  if (!text) throw new Error("Empty explanation received");
  return text;
}
