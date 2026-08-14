import type {
  AssistantIllustration,
  JamiAssistantContext,
} from "@/lib/ai/jami-assistant";
import { parseAssistantIllustration } from "@/lib/ai/jami-assistant";
import type { NotebookImageRef } from "@/lib/workspace/notebooks";
import { auth } from "@/services/firebase/client";

async function authenticatedHeaders() {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in again to use Jami illustrations.");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${await user.getIdToken()}`,
  };
}

async function responseFailure(response: Response, fallback: string) {
  const result = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  return typeof result?.error === "string" ? result.error : fallback;
}

export async function createAssistantIllustration(input: {
  threadId: string;
  messageId: string;
  context: JamiAssistantContext;
  signal?: AbortSignal;
}) {
  const response = await fetch("/api/ai/assistant/illustrations", {
    method: "POST",
    headers: await authenticatedHeaders(),
    body: JSON.stringify(input),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!response.ok) {
    throw new Error(
      await responseFailure(response, "Jami could not create that visual just now.")
    );
  }
  const result = (await response.json()) as Record<string, unknown>;
  const illustration = parseAssistantIllustration(result.illustration);
  if (!illustration) throw new Error("Jami returned an incomplete illustration.");
  return illustration;
}

export async function loadAssistantIllustrationBlob(
  illustration: AssistantIllustration,
  signal?: AbortSignal
) {
  const response = await fetch(
    `/api/ai/assistant/illustrations/file?path=${encodeURIComponent(
      illustration.storagePath
    )}`,
    {
      headers: await authenticatedHeaders(),
      cache: "force-cache",
      ...(signal ? { signal } : {}),
    }
  );
  if (!response.ok) {
    throw new Error(
      await responseFailure(response, "This illustration could not be loaded.")
    );
  }
  return response.blob();
}

export async function insertAssistantIllustration(input: {
  illustration: AssistantIllustration;
  messageId: string;
  notebookId: string;
  pageId: string;
}) {
  const response = await fetch("/api/ai/assistant/illustrations/insert", {
    method: "POST",
    headers: await authenticatedHeaders(),
    body: JSON.stringify({
      assetId: input.illustration.id,
      messageId: input.messageId,
      storagePath: input.illustration.storagePath,
      notebookId: input.notebookId,
      pageId: input.pageId,
    }),
  });
  if (!response.ok) {
    throw new Error(
      await responseFailure(response, "That visual could not be added to this page.")
    );
  }
  const result = (await response.json()) as Record<string, unknown>;
  if (!result.imageRef || typeof result.imageRef !== "object") {
    throw new Error("Jami returned an incomplete notebook image.");
  }
  return {
    imageRef: result.imageRef as NotebookImageRef,
    contentRevision:
      typeof result.contentRevision === "number" ? result.contentRevision : 0,
  };
}
