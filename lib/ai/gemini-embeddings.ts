import "server-only";

import type { AiContentPart } from "@/lib/ai/content-parts";
import { SOURCE_EMBEDDING_DIMENSIONS } from "@/lib/ai/source-chunking";

const EMBEDDING_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent";
const BATCH_EMBEDDING_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents";

function toProviderParts(parts: readonly AiContentPart[]) {
  return parts.map((part) => "text" in part
    ? { text: part.text }
    : {
        inlineData: {
          mimeType: part.inlineData.mimeType,
          data: part.inlineData.data,
        },
      });
}

function validateEmbedding(values: unknown) {
  if (
    !Array.isArray(values) ||
    values.length !== SOURCE_EMBEDDING_DIMENSIONS ||
    values.some((value) => typeof value !== "number" || !Number.isFinite(value))
  ) {
    throw new Error("Embedding provider returned an invalid vector.");
  }
  return values as number[];
}

export async function createGeminiEmbedding(input: {
  apiKey: string;
  parts: readonly AiContentPart[];
  signal?: AbortSignal;
}) {
  const response = await fetch(EMBEDDING_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": input.apiKey,
    },
    body: JSON.stringify({
      content: {
        parts: toProviderParts(input.parts),
      },
      outputDimensionality: SOURCE_EMBEDDING_DIMENSIONS,
    }),
    signal: input.signal ?? AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Embedding request failed with status ${response.status}.`);
  }
  const body = await response.json() as {
    embedding?: { values?: unknown };
    embeddings?: Array<{ values?: unknown }>;
  };
  const values = body.embedding?.values ?? body.embeddings?.[0]?.values;
  return validateEmbedding(values);
}

export async function createGeminiEmbeddings(input: {
  apiKey: string;
  contents: readonly (readonly AiContentPart[])[];
  signal?: AbortSignal;
}) {
  if (input.contents.length === 0) return [];
  const response = await fetch(BATCH_EMBEDDING_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": input.apiKey,
    },
    body: JSON.stringify({
      requests: input.contents.map((parts) => ({
        model: "models/gemini-embedding-2",
        content: { parts: toProviderParts(parts) },
        outputDimensionality: SOURCE_EMBEDDING_DIMENSIONS,
      })),
    }),
    signal: input.signal ?? AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Batch embedding request failed with status ${response.status}.`);
  }
  const body = await response.json() as {
    embeddings?: Array<{ values?: unknown }>;
  };
  if (!Array.isArray(body.embeddings) || body.embeddings.length !== input.contents.length) {
    throw new Error("Embedding provider returned an incomplete vector batch.");
  }
  return body.embeddings.map((embedding) => validateEmbedding(embedding.values));
}
