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
  type SourceTextChunk,
} from "@/lib/ai/source-chunking";
import { extractSourcePagesForIndex } from "@/lib/ai/source-extraction";
import { prepareSourceForTutor } from "@/lib/ai/source-ingestion";
import { rankRetrievedPassages } from "@/lib/ai/source-passage-rank";
import {
  attachSectionChunkRanges,
  detectSourceOutline,
  normalizeSourceOutline,
  resolveOutlineTargets,
  type OutlineTargets,
  type SourceOutline,
  type SourcePageKind,
  type SourceReferences,
} from "@/lib/ai/source-outline";
import { mapSourceData } from "@/lib/material/sources";
import { getSourceFileKind } from "@/lib/material/source-files";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";

/**
 * Passages one source may be cut into. At about 4,000 characters each this is
 * a whole module's lecture pack or a long textbook; it was 120, which ended a
 * long pack partway through and left its later lectures unsearchable.
 */
const MAX_INDEX_CHUNKS = 400;
const MAX_RETRIEVED_CHUNKS = 45;
/** The most sources one search spans: a whole module's material, bounded against a runaway request. */
const MAX_RETRIEVAL_SOURCES = 120;
/** Values one `in` filter may name. */
const SOURCE_FILTER_GROUP = 30;
/** Embedding requests in flight at once while indexing one source. */
const EMBEDDING_CONCURRENCY = 3;
/** Passages read straight from named parts, across every source, per question. */
const MAX_TARGETED_READS = 48;
/**
 * A related source is Jami's pick, not the student's: from the part of it the
 * student named, only its few passages closest to the question are kept.
 */
const MAX_TARGETED_PER_RELATED_SOURCE = 3;

export type RetrievedSourceChunk = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  chunkIndex: number;
  text: string;
  pageStart?: number;
  pageEnd?: number;
  heading?: string;
  sectionKey?: string;
  sectionLabel?: string;
  pageKind?: SourcePageKind;
  distance?: number;
  /** Read because the student named the part it is in, not found by the search. */
  targeted?: boolean;
};

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

function sourceOutlineRef(uid: string, sourceId: string) {
  return getAdminDb().collection("users").doc(uid).collection("sourceOutlines").doc(sourceId);
}

export async function deleteSourceIndex(uid: string, sourceId: string) {
  const deleted = await deleteChunkSnapshots(uid, sourceId);
  await sourceOutlineRef(uid, sourceId).delete().catch(() => undefined);
  return deleted;
}

async function embedChunks(apiKey: string, title: string, chunks: readonly SourceTextChunk[]) {
  const batches: SourceTextChunk[][] = [];
  for (let offset = 0; offset < chunks.length; offset += 50) {
    batches.push(chunks.slice(offset, offset + 50));
  }
  const results: number[][][] = new Array(batches.length);
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const index = next;
      next += 1;
      results[index] = await createGeminiEmbeddings({
        apiKey,
        contents: batches[index].map((chunk) => [
          { text: buildEmbeddingDocumentText(title, chunk) },
        ]),
      });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(EMBEDDING_CONCURRENCY, batches.length) }, worker)
  );
  return results.flat();
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
  // Pages already charged to the student's allowance for this source, so
  // re-indexing it -- an edit, an index upgrade -- only charges what is new.
  const pagesAlreadyCharged = Math.max(
    0,
    Number((snapshot.data() ?? {}).indexPagesCharged) || 0
  );
  await sourceRef.update({
    indexStatus: "processing",
    indexError: null,
    indexUpdatedAt: Date.now(),
  });

  try {
    const loadStoredFile = async (storagePath: string) =>
      (await getAdminStorageBucket().file(storagePath).download())[0];
    const extracted = await extractSourcePagesForIndex(source, loadStoredFile);
    const pageKind: SourcePageKind = extracted?.pageKind ?? "page";
    const detected = detectSourceOutline(extracted?.pages ?? []);
    const labels = new Map(detected.sections.map((section) => [section.key, section.label]));
    const pages = (extracted?.pages ?? []).map((page, index) => {
      const sectionKey = detected.pageSectionKeys[index];
      return sectionKey
        ? { ...page, sectionKey, sectionLabel: labels.get(sectionKey) }
        : page;
    });
    const allChunks = chunkSourcePages(pages);
    const chunks = allChunks.slice(0, MAX_INDEX_CHUNKS);
    const truncated = Boolean(extracted?.truncated) || allChunks.length > chunks.length;
    const embeddings = await embedChunks(apiKey, source.title, chunks);

    const records: Array<{
      id: string;
      data: Record<string, unknown>;
    }> = chunks.map((chunk, index) => ({
      id: chunkId(sourceId, chunk.chunkIndex),
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
        sectionKey: chunk.sectionKey ?? null,
        sectionLabel: chunk.sectionLabel ?? null,
        pageKind,
        embedding: FieldValue.vector(embeddings[index]),
        createdAt: Date.now(),
      },
    }));

    // A scan with no extractable text remains searchable as one multimodal
    // chunk. The original file stays immutable and is still used for visual QA.
    const fileKind = getSourceFileKind(source.fileType);
    if (records.length === 0 && (fileKind === "image" || fileKind === "pdf")) {
      const prepared = await prepareSourceForTutor(source, loadStoredFile, `source-index:${uid}`);
      const visualParts = prepared.parts.filter((part) => "inlineData" in part);
      if (visualParts.length > 0) {
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
    if (chunks.length > 0) {
      await sourceOutlineRef(uid, sourceId).set({
        sourceId,
        indexVersion: SOURCE_INDEX_VERSION,
        sourceUpdatedAt: source.updatedAt,
        pageKind,
        chunkCount: chunks.length,
        sections: attachSectionChunkRanges(detected.sections, chunks),
        chunkPageStarts: chunks.map((chunk) => chunk.pageStart ?? 0),
        chunkPageEnds: chunks.map((chunk) => chunk.pageEnd ?? 0),
        truncated,
        updatedAt: Date.now(),
      });
    }
    // Pages for the monthly allowance: the last page the index reaches, or for
    // text with no pages, about 3,000 characters to a page.
    const lastPage = chunks.reduce((last, chunk) => Math.max(last, chunk.pageEnd ?? 0), 0);
    const characters = chunks.reduce((total, chunk) => total + chunk.text.length, 0);
    const pagesIndexed =
      records.length === 0 ? 0 : Math.max(1, lastPage || Math.ceil(characters / 3_000));
    await sourceRef.update({
      indexStatus: records.length > 0 ? "ready" : "empty",
      indexVersion: SOURCE_INDEX_VERSION,
      indexChunkCount: records.length,
      indexSectionCount: detected.sections.length,
      indexTruncated: truncated,
      indexPagesCharged: Math.max(pagesAlreadyCharged, pagesIndexed),
      indexUpdatedAt: Date.now(),
      indexError: null,
    });
    return {
      chunkCount: records.length,
      sectionCount: detected.sections.length,
      truncated,
      pagesIndexed,
      newPages: Math.max(0, pagesIndexed - pagesAlreadyCharged),
    };
  } catch (error) {
    await sourceRef.update({
      indexStatus: "failed",
      // Recorded so a source that cannot be indexed is not retried on every question.
      indexVersion: SOURCE_INDEX_VERSION,
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
    sectionKey: typeof data.sectionKey === "string" ? data.sectionKey : undefined,
    sectionLabel: typeof data.sectionLabel === "string" ? data.sectionLabel : undefined,
    pageKind: data.pageKind === "slide" ? "slide" : data.pageKind === "page" ? "page" : undefined,
    distance: typeof data.vectorDistance === "number" ? data.vectorDistance : undefined,
  };
}

function readEmbedding(value: unknown): number[] | null {
  if (!value || typeof value !== "object") return null;
  const vector = value as { toArray?: () => number[] };
  if (typeof vector.toArray === "function") return vector.toArray();
  return Array.isArray(value) ? (value as number[]) : null;
}

/** Cosine distance, the measure the index's own search reports. */
export function cosineDistance(left: readonly number[], right: readonly number[]) {
  if (left.length === 0 || left.length !== right.length) return 1;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (leftNorm === 0 || rightNorm === 0) return 1;
  return 1 - dot / Math.sqrt(leftNorm * rightNorm);
}

function chunkId(sourceId: string, chunkIndex: number) {
  return `${sourceId}-${String(chunkIndex).padStart(4, "0")}`;
}

function sourceChunkCollection(uid: string) {
  return getAdminDb().collection("users").doc(uid).collection("sourceChunks");
}

async function nearestChunks(
  collection: FirebaseFirestore.CollectionReference,
  sourceIds: readonly string[],
  queryVector: number[],
  limit: number
) {
  const nearest = await collection
    .where("sourceId", "in", [...sourceIds])
    .findNearest({
      vectorField: "embedding",
      queryVector,
      limit: Math.max(1, Math.min(MAX_RETRIEVED_CHUNKS, limit)),
      distanceMeasure: "COSINE",
      distanceResultField: "vectorDistance",
    })
    .get();
  return nearest.docs.map(mapRetrieved).filter((chunk) => chunk.sourceId);
}

export type TutorEvidence = {
  passages: RetrievedSourceChunk[];
  /** Outlines of the sources that have one, by source id. */
  outlines: Map<string, SourceOutline>;
  /** What the question pointed at in each source that has an outline. */
  targets: Map<string, OutlineTargets>;
};

async function loadOutlines(uid: string, sourceIds: readonly string[]) {
  const outlines = new Map<string, SourceOutline>();
  if (sourceIds.length === 0) return outlines;
  const snapshots = await getAdminDb().getAll(
    ...sourceIds.map((sourceId) => sourceOutlineRef(uid, sourceId))
  );
  snapshots.forEach((snapshot) => {
    if (!snapshot.exists) return;
    const outline = normalizeSourceOutline(snapshot.id, snapshot.data());
    if (outline) outlines.set(snapshot.id, outline);
  });
  return outlines;
}

/**
 * Passages for Tutor from a set of sources, found three ways.
 *
 * When the student names part of a source -- "lecture 4", "slides 12-15" --
 * or asks about something a lecture is titled after, that part is read
 * straight from the index in reading order and ranked against the question,
 * so a fourteen-lecture pack answers from lecture 4 rather than from whichever
 * lecture happens to sound most like the question.
 *
 * Pinned sources -- the ones the student chose -- are also each searched on
 * their own, so every one of them contributes its closest passages however
 * well the others match. Related sources, found through a shared folder or
 * topic, are searched together and compete, so only the ones that actually
 * bear on the question contribute anything.
 *
 * The passage straight after each source's closest one comes too: a passage
 * often ends mid-argument, and the next one is where it concludes.
 *
 * Returns null when the index cannot be searched at all (embeddings not
 * configured), which is different from searching and finding nothing.
 */
export async function retrieveTutorEvidence(input: {
  uid: string;
  pinnedSourceIds: readonly string[];
  relatedSourceIds: readonly string[];
  query: string;
  /** Parts of their material the student named, this turn or in the question it follows. */
  references?: SourceReferences;
  /** The student's own words, matched against lecture titles. */
  focusText?: string;
  pinnedLimit: number;
  relatedLimit: number;
}): Promise<TutorEvidence | null> {
  const apiKey = getConfiguredGeminiEmbeddingApiKey(process.env);
  if (!apiKey || !resolveAiProviderPolicy(process.env).geminiReady) return null;
  const pinned = Array.from(new Set(input.pinnedSourceIds.filter(Boolean))).slice(0, 15);
  const related = Array.from(
    new Set(input.relatedSourceIds.filter((id) => id && !pinned.includes(id)))
  ).slice(0, 30);
  const empty: TutorEvidence = { passages: [], outlines: new Map(), targets: new Map() };
  if ((pinned.length === 0 && related.length === 0) || !input.query.trim()) return empty;

  const [queryVector, outlines] = await Promise.all([
    createGeminiEmbedding({
      apiKey,
      parts: [{ text: buildEmbeddingQueryText(input.query) }],
    }),
    // An outline that cannot be read only costs the lecture shortcut.
    loadOutlines(input.uid, [...pinned, ...related]).catch(() => new Map<string, SourceOutline>()),
  ]);
  const references = input.references ?? { sections: [], pages: [] };
  const targets = new Map<string, OutlineTargets>();
  outlines.forEach((outline, sourceId) => {
    const target = resolveOutlineTargets(outline, references, input.focusText ?? input.query, {
      // A related source is Jami's pick, so it is only read by a part the
      // student actually named; a title that merely matches is not enough.
      allowTitleMatch: pinned.includes(sourceId),
    });
    if (target.chunkIndexes.length > 0 || target.missing.length > 0 || target.sections.length > 0) {
      targets.set(sourceId, target);
    }
  });

  const collection = sourceChunkCollection(input.uid);
  const searches = await Promise.all([
    ...pinned.map((sourceId) =>
      nearestChunks(collection, [sourceId], queryVector, input.pinnedLimit)
    ),
    ...(related.length > 0 && input.relatedLimit > 0
      ? [nearestChunks(collection, related, queryVector, input.relatedLimit)]
      : []),
  ]);
  const primary = searches.flat();
  const found = new Map(primary.map((chunk) => [chunk.id, chunk]));

  // The student's chosen sources first, so a folder full of packs that each
  // have a "lecture 4" cannot crowd out the one they picked.
  const targetedIds = [...targets]
    .sort(([left], [right]) => Number(pinned.includes(right)) - Number(pinned.includes(left)))
    .flatMap(([sourceId, target]) => target.chunkIndexes.map((index) => chunkId(sourceId, index)))
    .slice(0, MAX_TARGETED_READS);
  const targeted: RetrievedSourceChunk[] = [];
  if (targetedIds.length > 0) {
    const snapshots = await getAdminDb().getAll(
      ...targetedIds.map((id) => collection.doc(id))
    );
    for (const snapshot of snapshots) {
      if (!snapshot.exists) continue;
      const data = snapshot.data() ?? {};
      const embedding = readEmbedding(data.embedding);
      const known = found.get(snapshot.id);
      const chunk = {
        ...(known ?? mapRetrieved(snapshot as FirebaseFirestore.QueryDocumentSnapshot)),
        distance: known?.distance ?? (embedding ? cosineDistance(queryVector, embedding) : undefined),
        targeted: true,
      };
      if (!chunk.sourceId || !chunk.text) continue;
      targeted.push(chunk);
    }
  }
  const keptTargeted = targeted.filter((chunk) => {
    if (pinned.includes(chunk.sourceId)) return true;
    const closer = targeted.filter(
      (other) =>
        other.sourceId === chunk.sourceId &&
        (other.distance ?? 1) < (chunk.distance ?? 1)
    ).length;
    return closer < MAX_TARGETED_PER_RELATED_SOURCE;
  });
  keptTargeted.forEach((chunk) => found.set(chunk.id, chunk));

  const closestBySource = new Map<string, RetrievedSourceChunk>();
  for (const chunk of primary) {
    const current = closestBySource.get(chunk.sourceId);
    if (!current || (chunk.distance ?? 1) < (current.distance ?? 1)) {
      closestBySource.set(chunk.sourceId, chunk);
    }
  }
  const followingIds = [...closestBySource.values()]
    .map((chunk) => chunkId(chunk.sourceId, chunk.chunkIndex + 1))
    .filter((id) => !found.has(id));
  const following = followingIds.length > 0
    ? await getAdminDb().getAll(...followingIds.map((id) => collection.doc(id)))
    : [];
  const targetedIdSet = new Set(keptTargeted.map((chunk) => chunk.id));
  return {
    passages: [
      ...primary.filter((chunk) => !targetedIdSet.has(chunk.id)),
      ...keptTargeted,
      ...following
        .filter((snapshot): snapshot is FirebaseFirestore.QueryDocumentSnapshot => snapshot.exists)
        .map(mapRetrieved),
    ],
    outlines,
    targets,
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
