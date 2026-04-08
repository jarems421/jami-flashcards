import { auth } from "@/services/firebase/client";

export type ChatMessage = {
  role: "user" | "model";
  text: string;
};

export async function sendChatMessage(
  message: string,
  history: ChatMessage[],
): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");

  const token = await user.getIdToken();

  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message, history }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Request failed (${res.status})`);
  }

  const data = await res.json();
  const text = typeof data.reply === "string" ? data.reply.trim() : "";
  if (!text) throw new Error("Empty reply received");
  return text;
}
