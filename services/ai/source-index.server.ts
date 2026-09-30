import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import {
  createGeminiEmbedding,
  createGeminiEmbeddings,
  getConfiguredGeminiEmbeddingApiKey,
} from "@/lib/ai/gemini-embeddings";
import { resolveAiProviderPolicy } from "@/lib/ai/provider-policy";
import {
  buildEmbeddingDocumentText,
  buildEmbeddingQueryText,
  chunkSourcePages,
  SOURCE_INDEX_VERSION,
  type SourceTextPage,
} from "@/lib/ai/source-chunking";
import { prepareSourceForTutor } from "@/lib/ai/source-ingestion";
import { rankRetrievedPassages } from "@/lib/ai/source-passage-rank";
import { mapSourceData } from "@/lib/material/sources";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";

const MAX_INDEX_CHUNKS = 120;
const MAX_RETRIEVED_CHUNKS = 45;
/** The most sources one search spans: a whole module's material, bounded against a runaway request. */
const MAX_RETRIEVAL_SOURCES = 120;
/** Values one `in` filter may name. */
const SOURCE_FILTER_GROUP = 30;

export type RetrievedSourceChunk = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  chunkIndex: number;
  text: string;
  pageStart?: number;
  pageEnd?: number;
  heading?: string;
  distance?: number;
};

async function extractPdfPages(bytes: Buffer): Promise<SourceTextPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  const pages: SourceTextPage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => "str" in item ? item.str : "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) pages.push({ pageNumber, text });
    }
  } finally {
    await loadingTask.destroy();
  }
  return pages;
}

async function deleteChunkSnapshots(
  uid: string,
  sourceId?: string
) {
  const collection = getAdminDb().collection("users").doc(uid).collection("sourceChunks");
  let snapshot = sourceId
    ? await collection.where("sourceId", "==", sourceId).limit(500).get()
    : await collection.limit(500).get();
  let deleted = 0;
  while (!snapshot.empty) {
    const batch = getAdminDb().batch();
    snapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
    deleted += snapshot.size;
    snapshot = sourceId
      ? await collection.where("sourceId", "==", sourceId).limit(500).get()
      : await collection.limit(500).get();
  }
  return deleted;
}

export function deleteSourceIndex(uid: string, sourceId: string) {
  return deleteChunkSnapshots(uid, sourceId);
}

export function deleteAccountSourceIndex(uid: string) {
  return deleteChunkSnapshots(uid);
}

export async function rebuildSourceIndex(uid: string, sourceId: string) {
  const apiKey = getConfiguredGeminiEmbeddingApiKey(process.env);
  if (!apiKey || !resolveAiProviderPolicy(process.env).geminiReady) {
    throw new Error("Gemini embeddings are not configured.");
  }
  const userRef = getAdminDb().collection("users").doc(uid);
  const sourceRef = userRef.collection("sources").doc(sourceId);
  const snapshot = await sourceRef.get();
  if (!snapshot.exists) {
    await deleteSourceIndex(uid, sourceId);
    return { chunkCount: 0 };
  }
  const source = mapSourceData(sourceId, snapshot.data() ?? {});
  await sourceRef.update({ indexStatus: "processing", indexError: null });

  try {
    const prepared = await prepareSourceForTutor(
      source,
      async (storagePath) => (await getAdminStorageBucket().file(storagePath).download())[0],
      `source-index:${uid}`
    );
    let pages: SourceTextPage[] = prepared.parts.flatMap((part) =>
      "text" in part ? [{ text: part.text }] : []
    );
    const visualParts = prepared.parts.filter((part) => "inlineData" in part);
    if (
      pages.length === 0 &&
      source.fileType === "application/pdf" &&
      source.storagePath
    ) {
      const [bytes] = await getAdminStorageBucket().file(source.storagePath).download();
      pages = await extractPdfPages(bytes);
    }

    const chunks = chunkSourcePages(pages).slice(0, MAX_INDEX_CHUNKS);
    const records: Array<{
      id: string;
      data: Record<string, unknown>;
    }> = [];
    const embeddings: number[][] = [];
    for (let offset = 0; offset < chunks.length; offset += 50) {
      embeddings.push(...await createGeminiEmbeddings({
        apiKey,
        contents: chunks.slice(offset, offset + 50).map((chunk) => [
          { text: buildEmbeddingDocumentText(source.title, chunk) },
        ]),
      }));
    }
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const embedding = embeddings[index];
      records.push({
        id: `${sourceId}-${String(chunk.chunkIndex).padStart(4, "0")}`,
        data: {
          sourceId,
          sourceTitle: source.title,
          sourceUpdatedAt: source.updatedAt,
          indexVersion: SOURCE_INDEX_VERSION,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          pageStart: chunk.pageStart ?? null,
          pageEnd: chunk.pageEnd ?? null,
          heading: chunk.heading ?? null,
          embedding: FieldValue.vector(embedding),
          createdAt: Date.now(),
        },
      });
    }

    // A scan with no extractable text remains searchable as one multimodal
    // chunk. The original file stays immutable and is still used for visual QA.
    if (records.length === 0 && visualParts.length > 0) {
      const embedding = await createGeminiEmbedding({ apiKey, parts: visualParts });
      records.push({
        id: `${sourceId}-visual`,
        data: {
          sourceId,
          sourceTitle: source.title,
          sourceUpdatedAt: source.updatedAt,
          indexVersion: SOURCE_INDEX_VERSION,
          chunkIndex: 0,
          text: "",
          visualOnly: true,
          embedding: FieldValue.vector(embedding),
          createdAt: Date.now(),
        },
      });
    }

    await deleteSourceIndex(uid, sourceId);
    const chunkCollection = userRef.collection("sourceChunks");
    for (let offset = 0; offset < records.length; offset += 400) {
      const batch = getAdminDb().batch();
      records.slice(offset, offset + 400).forEach((record) =>
        batch.set(chunkCollection.doc(record.id), record.data)
      );
      await batch.commit();
    }
    await sourceRef.update({
      indexStatus: records.length > 0 ? "ready" : "empty",
      indexVersion: SOURCE_INDEX_VERSION,
      indexChunkCount: records.length,
      indexUpdatedAt: Date.now(),
      indexError: null,
    });
    return { chunkCount: records.length };
  } catch (error) {
    await sourceRef.update({
      indexStatus: "failed",
      indexUpdatedAt: Date.now(),
      indexError: error instanceof Error ? error.message.slice(0, 240) : "Indexing failed",
    }).catch(() => undefined);
    throw error;
  }
}

function mapRetrieved(document: FirebaseFirestore.QueryDocumentSnapshot): RetrievedSourceChunk {
  const data = document.data();
  return {
    id: document.id,
    sourceId: typeof data.sourceId === "string" ? data.sourceId : "",
    sourceTitle: typeof data.sourceTitle === "string" ? data.sourceTitle : "Source",
    chunkIndex: typeof data.chunkIndex === "number" ? data.chunkIndex : 0,
    text: typeof data.text === "string" ? data.text : "",
    pageStart: typeof data.pageStart === "number" ? data.pageStart : undefined,
    pageEnd: typeof data.pageEnd === "number" ? data.pageEnd : undefined,
    heading: typeof data.heading === "string" ? data.heading : undefined,
    distance: typeof data.vectorDistance === "number" ? data.vectorDistance : undefined,
  };
}

export async function retrieveSourceChunks(input: {
  uid: string;
  sourceIds: readonly string[];
  query: string;
  limit?: number;
  includeNeighbors?: boolean;
}) {
  const apiKey = getConfiguredGeminiEmbeddingApiKey(process.env);
  const sourceIds = Array.from(new Set(input.sourceIds.map((id) => id.trim()).filter(Boolean))).slice(
    0,
    MAX_RETRIEVAL_SOURCES
  );
  if (
    !apiKey ||
    !resolveAiProviderPolicy(process.env).geminiReady ||
    sourceIds.length === 0 ||
    !input.query.trim()
  ) return [];
  const queryVector = await createGeminiEmbedding({
    apiKey,
    parts: [{ text: buildEmbeddingQueryText(input.query) }],
  });
  const collection = getAdminDb()
    .collection("users")
    .doc(input.uid)
    .collection("sourceChunks");
  /*
   * Every attached source is searched, however many there are.
   *
   * This used to search only the first fifteen, so a student with thirty
   * files in a module had half of them silently ignored, however relevant.
   * A filter can name thirty values at most, so the sources are searched in
   * groups of thirty and the closest passages kept across all of them: the
   * student keeps everything attached, and only what fits the question is read.
   */
  const limit = Math.max(1, Math.min(MAX_RETRIEVED_CHUNKS, input.limit ?? 12));
  const groups: string[][] = [];
  for (let offset = 0; offset < sourceIds.length; offset += SOURCE_FILTER_GROUP) {
    groups.push(sourceIds.slice(offset, offset + SOURCE_FILTER_GROUP));
  }
  const searched = await Promise.all(
    groups.map((group) =>
      collection
        .where("sourceId", "in", group)
        .findNearest({
          vectorField: "embedding",
          queryVector,
          // A few spare candidates, so exact wording can lift a passage the meaning alone ranked lower.
          limit: Math.min(MAX_RETRIEVED_CHUNKS, limit * 3),
          distanceMeasure: "COSINE",
          distanceResultField: "vectorDistance",
        })
        .get()
    )
  );
  const primary = rankRetrievedPassages(
    input.query,
    searched.flatMap((snapshot) => snapshot.docs.map(mapRetrieved)).filter((chunk) => chunk.sourceId),
    limit
  );
  if (input.includeNeighbors === false || primary.length === 0) return primary;

  const neighborIds = new Set<string>();
  primary.forEach((chunk) => {
    if (chunk.chunkIndex > 0) {
      neighborIds.add(`${chunk.sourceId}-${String(chunk.chunkIndex - 1).padStart(4, "0")}`);
    }
    neighborIds.add(`${chunk.sourceId}-${String(chunk.chunkIndex + 1).padStart(4, "0")}`);
  });
  const missingIds = [...neighborIds].filter((id) => !primary.some((chunk) => chunk.id === id));
  const neighborSnapshots = await Promise.all(
    missingIds.slice(0, MAX_RETRIEVED_CHUNKS).map((id) => collection.doc(id).get())
  );
  const neighbors = neighborSnapshots
    .filter((snapshot): snapshot is FirebaseFirestore.QueryDocumentSnapshot => snapshot.exists)
    .map(mapRetrieved);
  return [...primary, ...neighbors]
    .sort((left, right) =>
      left.sourceId.localeCompare(right.sourceId) || left.chunkIndex - right.chunkIndex
    );
}
