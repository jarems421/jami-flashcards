import "server-only";

import type { Part } from "@google/generative-ai";
import {
  JAMI_ASSISTANT_MAX_SNAPSHOT_BYTES,
  type JamiAssistantContext,
} from "@/lib/ai/jami-assistant";
import { mapSourceData, type Source } from "@/lib/practice/sources";
import {
  mapNotebookData,
  mapNotebookPageData,
} from "@/lib/workspace/notebooks";
import { getAdminDb } from "@/services/firebase/admin";

const MAX_SOURCE_METADATA_CANDIDATES = 200;
const MAX_RELATED_SOURCES = 5;

type AdminDb = ReturnType<typeof getAdminDb>;

type SourceRelations = {
  currentSourceIds: string[];
  directSourceIds: string[];
  folderIds: string[];
  topicIds: string[];
};

export type ResolvedJamiAssistantContext = {
  currentId: string;
  currentLabel: string;
  currentParts: Part[];
  sources: Source[];
};

export class JamiAssistantContextError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, status = 404, code = "context_not_found") {
    super(message);
    this.name = "JamiAssistantContextError";
    this.code = code;
    this.status = status;
  }
}

function normalizeString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeIds(value: unknown, maxItems = 30) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 160))
        .filter(Boolean)
    )
  ).slice(0, maxItems);
}

function getSearchTerms(value: string) {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .match(/[a-z0-9\u00c0-\u024f]{3,}/g)
        ?.filter(
          (term) =>
            ![
              "about",
              "could",
              "explain",
              "from",
              "help",
              "please",
              "that",
              "this",
              "what",
              "with",
              "would",
            ].includes(term)
        ) ?? []
    )
  ).slice(0, 20);
}

function countOverlap(left: readonly string[], right: readonly string[]) {
  const rightSet = new Set(right);
  return left.reduce((count, value) => count + Number(rightSet.has(value)), 0);
}

export function scoreJamiAssistantSource(input: {
  source: Source;
  relations: SourceRelations;
  message: string;
}) {
  const { source, relations } = input;
  let score = 0;
  if (relations.currentSourceIds.includes(source.id)) score += 100_000;
  if (relations.directSourceIds.includes(source.id)) score += 10_000;
  score += countOverlap(source.topicIds, relations.topicIds) * 500;
  score += countOverlap(source.folderIds, relations.folderIds) * 250;

  const searchable = `${source.title} ${source.subject ?? ""}`.toLowerCase();
  score += getSearchTerms(input.message).reduce(
    (total, term) => total + (searchable.includes(term) ? 15 : 0),
    0
  );
  return score;
}

export function rankJamiAssistantSources(input: {
  sources: readonly Source[];
  relations: SourceRelations;
  message: string;
}) {
  const currentIds = new Set(input.relations.currentSourceIds);
  return [...input.sources]
    .filter(
      (source) =>
        currentIds.has(source.id) ||
        (source.status === "active" &&
          scoreJamiAssistantSource({
            source,
            relations: input.relations,
            message: input.message,
          }) > 0)
    )
    .sort((left, right) => {
      const scoreDifference =
        scoreJamiAssistantSource({
          source: right,
          relations: input.relations,
          message: input.message,
        }) -
        scoreJamiAssistantSource({
          source: left,
          relations: input.relations,
          message: input.message,
        });
      return (
        scoreDifference ||
        right.updatedAt - left.updatedAt ||
        left.id.localeCompare(right.id)
      );
    })
    .slice(0, MAX_RELATED_SOURCES);
}

function assertSnapshotMime(input: {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  dataBase64: string;
}) {
  const bytes = Buffer.from(input.dataBase64, "base64");
  if (bytes.byteLength <= 0 || bytes.byteLength > JAMI_ASSISTANT_MAX_SNAPSHOT_BYTES) {
    throw new JamiAssistantContextError(
      "The notebook page snapshot is too large.",
      413,
      "snapshot_too_large"
    );
  }

  const isPng =
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  const isWebp =
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP";
  const matches =
    (input.mimeType === "image/png" && isPng) ||
    (input.mimeType === "image/jpeg" && isJpeg) ||
    (input.mimeType === "image/webp" && isWebp);
  if (!matches) {
    throw new JamiAssistantContextError(
      "The notebook page snapshot is not a supported image.",
      400,
      "invalid_snapshot"
    );
  }
}

async function loadSourcesById(db: AdminDb, uid: string, sourceIds: string[]) {
  const sourceCollection = db.collection("users").doc(uid).collection("sources");
  const snapshots = await Promise.all(
    sourceIds.map((sourceId) => sourceCollection.doc(sourceId).get())
  );
  return snapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => mapSourceData(snapshot.id, snapshot.data() ?? {}));
}

async function selectSources(input: {
  db: AdminDb;
  uid: string;
  relations: SourceRelations;
  message: string;
  includeRelated: boolean;
}) {
  const requiredIds = Array.from(
    new Set([
      ...input.relations.currentSourceIds,
      ...(input.includeRelated ? input.relations.directSourceIds : []),
    ])
  );
  const required = await loadSourcesById(input.db, input.uid, requiredIds);

  if (!input.includeRelated) {
    return rankJamiAssistantSources({
      sources: required,
      relations: {
        ...input.relations,
        directSourceIds: [],
        folderIds: [],
        topicIds: [],
      },
      message: input.message,
    });
  }

  const snapshot = await input.db
    .collection("users")
    .doc(input.uid)
    .collection("sources")
    .limit(MAX_SOURCE_METADATA_CANDIDATES)
    .get();
  const candidates = new Map<string, Source>();
  snapshot.docs.forEach((sourceDoc) => {
    candidates.set(
      sourceDoc.id,
      mapSourceData(sourceDoc.id, sourceDoc.data() ?? {})
    );
  });
  required.forEach((source) => candidates.set(source.id, source));

  return rankJamiAssistantSources({
    sources: Array.from(candidates.values()),
    relations: input.relations,
    message: input.message,
  });
}

async function resolveLearnContext(input: {
  db: AdminDb;
  uid: string;
  context: Extract<JamiAssistantContext, { surface: "learn" }>;
}) {
  const cardSnapshot = await input.db.collection("cards").doc(input.context.cardId).get();
  const cardData = cardSnapshot.data() ?? {};
  const owner = normalizeString(cardData.userId ?? cardData.uid, 160);
  if (!cardSnapshot.exists || owner !== input.uid) {
    throw new JamiAssistantContextError("This card could not be found.");
  }

  const deckId = normalizeString(cardData.deckId, 160);
  let deckName = "Unknown deck";
  let folderIds: string[] = [];
  if (deckId) {
    const deckSnapshot = await input.db.collection("decks").doc(deckId).get();
    const deckData = deckSnapshot.data() ?? {};
    const deckOwner = normalizeString(deckData.userId ?? deckData.uid, 160);
    if (deckSnapshot.exists && deckOwner === input.uid) {
      deckName = normalizeString(deckData.name, 160) || deckName;
      folderIds = normalizeIds(deckData.folderIds, 12);
    }
  }

  const front = normalizeString(cardData.front, 500);
  const back = normalizeString(cardData.back, 2_000);
  const parts: Part[] = [
    {
      text: `Learn phase: ${input.context.phase}\nDeck: ${deckName}\nCard front: ${front || "(empty)"}\nCard answer: ${back || "(empty)"}`,
    },
  ];
  return {
    currentId: cardSnapshot.id,
    currentLabel: "Current card",
    currentParts: parts,
    relations: {
      currentSourceIds: [],
      directSourceIds: normalizeIds(cardData.sourceIds),
      folderIds,
      topicIds: normalizeIds(cardData.topicIds),
    } satisfies SourceRelations,
  };
}

async function resolveSourcesContext(input: {
  db: AdminDb;
  uid: string;
  context: Extract<JamiAssistantContext, { surface: "sources" }>;
}) {
  const sources = await loadSourcesById(input.db, input.uid, input.context.sourceIds);
  if (sources.length !== input.context.sourceIds.length) {
    throw new JamiAssistantContextError("One or more sources could not be found.");
  }

  return {
    currentId: sources[0]?.id ?? "sources",
    currentLabel: sources.length === 1 ? "Current source" : "Selected sources",
    currentParts: [
      {
        text: `The student is asking from Sources. Their current selection is: ${sources
          .map((source) => source.title)
          .join(", ")}.`,
      },
    ] satisfies Part[],
    relations: {
      currentSourceIds: input.context.sourceIds,
      directSourceIds: [],
      folderIds: Array.from(new Set(sources.flatMap((source) => source.folderIds))),
      topicIds: Array.from(new Set(sources.flatMap((source) => source.topicIds))),
    } satisfies SourceRelations,
  };
}

async function resolveNotebookContext(input: {
  db: AdminDb;
  uid: string;
  context: Extract<JamiAssistantContext, { surface: "notebook" }>;
}) {
  const userRef = input.db.collection("users").doc(input.uid);
  const [notebookSnapshot, pageSnapshot] = await Promise.all([
    userRef.collection("notebooks").doc(input.context.notebookId).get(),
    userRef.collection("notebookPages").doc(input.context.pageId).get(),
  ]);
  if (!notebookSnapshot.exists || !pageSnapshot.exists) {
    throw new JamiAssistantContextError("This notebook page could not be found.");
  }

  const notebook = mapNotebookData(
    notebookSnapshot.id,
    notebookSnapshot.data() ?? {}
  );
  const page = mapNotebookPageData(pageSnapshot.id, pageSnapshot.data() ?? {});
  if (page.notebookId !== notebook.id) {
    throw new JamiAssistantContextError("This notebook page could not be found.");
  }

  const typedText =
    input.context.typedText ||
    [page.typedContent, ...page.textBlocks.map((block) => block.text)]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 12_000);
  const questionPrompt = input.context.questionPrompt || page.questionPrompt || "";
  const currentParts: Part[] = [
    {
      text: `Notebook: ${notebook.title}\nPage: ${page.pageNumber}${
        questionPrompt ? `\nQuestion prompt: ${questionPrompt}` : ""
      }${typedText ? `\nTyped page content:\n${typedText}` : ""}`,
    },
  ];
  if (input.context.snapshot) {
    assertSnapshotMime(input.context.snapshot);
    currentParts.push({
      inlineData: {
        mimeType: input.context.snapshot.mimeType,
        data: input.context.snapshot.dataBase64,
      },
    });
  }

  return {
    currentId: page.id,
    currentLabel: "Current page",
    currentParts,
    relations: {
      currentSourceIds: [],
      directSourceIds: notebook.sourceIds,
      folderIds: notebook.folderId ? [notebook.folderId] : [],
      topicIds: notebook.topicIds,
    } satisfies SourceRelations,
  };
}

export async function resolveJamiAssistantContext(input: {
  uid: string;
  message: string;
  context: JamiAssistantContext;
  useRelatedSources: boolean;
}): Promise<ResolvedJamiAssistantContext> {
  const uid = input.uid.trim();
  if (!uid) {
    throw new JamiAssistantContextError("Unauthorized", 401, "unauthorized");
  }
  const db = getAdminDb();
  const resolved =
    input.context.surface === "learn"
      ? await resolveLearnContext({ db, uid, context: input.context })
      : input.context.surface === "sources"
        ? await resolveSourcesContext({ db, uid, context: input.context })
        : await resolveNotebookContext({ db, uid, context: input.context });
  const sources = await selectSources({
    db,
    uid,
    relations: resolved.relations,
    message: input.message,
    includeRelated: input.useRelatedSources,
  });

  return {
    currentId: resolved.currentId,
    currentLabel: resolved.currentLabel,
    currentParts: resolved.currentParts,
    sources,
  };
}
