import { auth } from "@/services/firebase/client";
import { encodeForLabelDetection } from "@/lib/study/diagram-image";
import type { DetectedLabel } from "@/lib/study/diagram-label-detection";
import { reportAllowanceRefusal } from "@/services/billing/allowance-events";

export type LabelDetectionSource =
  | { kind: "file"; file: Blob }
  | { kind: "stored"; storagePath: string };

function friendlyError(status: number, message: unknown) {
  if (typeof message === "string" && message.trim()) return message;
  if (status === 429) return "Jami has found labels on as many pictures as it can for now. Draw the boxes yourself, or try later.";
  return "Jami could not read the labels just now. Try again, or draw the boxes yourself.";
}

function isDetectedLabel(value: unknown): value is DetectedLabel {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.text === "string" &&
    ["x", "y", "width", "height"].every((key) => typeof entry[key] === "number" && Number.isFinite(entry[key]))
  );
}

/**
 * The printed labels Jami can find on a picture.
 *
 * A new picture is scaled down and sent inline; one already saved is read by
 * the server from the student's own storage, so it never has to be downloaded
 * here.
 */
export async function detectDiagramLabels(source: LabelDetectionSource): Promise<DetectedLabel[]> {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in again to use Jami here.");
  const body =
    source.kind === "file"
      ? { image: await encodeForLabelDetection(source.file) }
      : { storagePath: source.storagePath };
  const response = await fetch("/api/ai/diagram-labels", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await user.getIdToken()}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as { labels?: unknown; error?: unknown } | null;
  if (!response.ok) {
    reportAllowanceRefusal(data);
    throw new Error(friendlyError(response.status, data?.error));
  }
  return Array.isArray(data?.labels) ? data.labels.filter(isDetectedLabel) : [];
}
