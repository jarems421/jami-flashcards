import { auth } from "@/services/firebase/client";

export async function requestSourceIndex(
  sourceId: string,
  method: "POST" | "DELETE" = "POST"
) {
  const user = auth.currentUser;
  if (!user || !sourceId.trim()) return;
  const token = await user.getIdToken();
  const response = await fetch("/api/ai/source-index", {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ sourceId }),
  });
  if (!response.ok && response.status !== 503) {
    throw new Error("Jami could not update the private source index.");
  }
}
