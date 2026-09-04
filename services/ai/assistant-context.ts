import "server-only";

import { randomUUID } from "node:crypto";
import type { AiContentPart } from "@/lib/ai/content-parts";
import {
  JamiAssistantContextError,
  assertSnapshotMime,
  countOverlap,
  describeMemoryProfile,
  normalizeIds,
  normalizeString,
  rankJamiAssistantSources,
  type ResolvedJamiAssistantContext,
  type SourceRelations,
} from "@/lib/ai/assistant-context.server";
import type { JamiAssistantContext } from "@/lib/ai/jami-assistant";
import { normalizeReasoningEffort } from "@/lib/profile/reasoning-effort";
import {
  buildTutorPersonalisationInstruction,
  normalizeTutorPreferences,
  selectFolderTutorInstructions,
} from "@/lib/ai/tutor-personalisation";
import { mapSourceData, type Source } from "@/lib/material/sources";
import {
  getStudyLevelTutorLabel,
  normalizeStudyLevel,
} from "@/lib/profile/study-level";
import {
  mapNotebookData,
  mapNotebookPageData,
} from "@/lib/workspace/notebooks";
import { getAdminDb } from "@/services/firebase/admin";

const MAX_SOURCE_METADATA_CANDIDATES = 200;
const MAX_SOURCE_CANDIDATES_PER_RELATION =
  MAX_SOURCE_METADATA_CANDIDATES / 2;
const LEARN_RELATED_CARD_SCAN_LIMIT = 20;
const LEARN_MAX_RELATED_CARDS = 6;
const NOTEBOOK_CONTEXT_PAGE_LIMIT = 60;
const NOTEBOOK_CONTEXT_PAGE_TEXT_LIMIT = 700;
const NOTEBOOK_CONTEXT_TOTAL_TEXT_LIMIT = 12_000;

type AdminDb = ReturnType<typeof getAdminDb>;

async function loadTutorPreferences(input: {
  db: AdminDb;
  uid: string;
  folderIds: readonly string[];
}) {
  const userRef = input.db.collection("users").doc(input.uid);
  const folderIds = Array.from(new Set(input.folderIds.filter(Boolean))).slice(0, 12);
  const [userSnapshot, folderSnapshots, personalisationSnapshot] =
    await Promise.all([
      userRef.get(),
      Promise.all(
        folderIds.map((folderId) =>
          userRef.collection("studyFolders").doc(folderId).get()
        )
      ),
      // Alongside the two reads this function already made, so saved teaching
      // preferences cost no extra round trip.
      userRef.collection("tutorPersonalisation").doc("settings").get(),
    ]);

  const folderLevels = Array.from(
    new Set(
      folderSnapshots
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => normalizeStudyLevel(snapshot.data()?.studyLevel))
        .filter((level) => level !== undefined)
    )
  );
  const accountLevel = normalizeStudyLevel(
    userSnapshot.exists ? userSnapshot.data()?.defaultStudyLevel : undefined
  );
  const reasoningEffort = normalizeReasoningEffort(
    userSnapshot.exists ? userSnapshot.data()?.reasoningEffort : undefined
  );
  /*
   * Folder instructions apply only when the material sits in exactly one
   * folder, because two documents cannot be merged into one set of teaching
   * instructions and picking between them would be a guess. A card in two
   * folders therefore gets the general preferences and nothing else, and the
   * settings drawer says so rather than the conversation asking about it.
   */
  const selectedFolder = selectFolderTutorInstructions(
    folderSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => snapshot.data() ?? {})
  );
  const preferences = normalizeTutorPreferences(
    personalisationSnapshot.exists
      ? (personalisationSnapshot.data() as Record<string, unknown>)
      : undefined
  );
  const personalisationContext = buildTutorPersonalisationInstruction({
    preferences,
    folderInstructions: selectedFolder.instructions,
    ...(selectedFolder.folderName
      ? { folderName: selectedFolder.folderName }
      : {}),
    // Per request, like every other fenced block, so nothing a student saved
    // can close a marker it was not given.
    boundaryToken: randomUUID(),
  });

  const level = folderLevels.length === 1 ? folderLevels[0] : accountLevel;
  if (!level) {
    return {
      studyLevelContext: undefined,
      personalisationContext,
      reasoningEffort,
    };
  }

  const source = folderLevels.length === 1 ? "folder override" : "account default";
  return {
    studyLevelContext: `Study-level preference: ${getStudyLevelTutorLabel(level)} (${source}). Use this to calibrate vocabulary, assumed knowledge, examples, and explanation depth. It describes the material, not the student's ability. If the student's current request explicitly asks for a different level or style, follow that request instead.`,
    personalisationContext,
    reasoningEffort,
  };
}

function getNotebookPageText(page: ReturnType<typeof mapNotebookPageData>) {
  return [page.typedContent, ...page.textBlocks.map((block) => block.text)]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NOTEBOOK_CONTEXT_PAGE_TEXT_LIMIT);
}

function buildNotebookPageMap(
  pages: ReturnType<typeof mapNotebookPageData>[],
  currentPageId: string
) {
  if (pages.length <= 1) return "";

  const lines = pages.map((page) => {
    const pageText = getNotebookPageText(page);
    const details = [
      page.title && !/^Page \d+$/i.test(page.title) ? `title: ${page.title}` : "",
      page.questionPrompt ? `question: ${page.questionPrompt.slice(0, 500)}` : "",
      pageText
        ? `typed content: ${pageText}`
        : "no typed summary available",
    ].filter(Boolean);
    return `- Page ${page.pageNumber}${
      page.id === currentPageId ? " (current)" : ""
    }: ${details.join("; ")}`;
  });

  return `Notebook page map (loaded when the student asked; handwriting and page imagery are available only for the current page):\n${lines
    .join("\n")
    .slice(0, NOTEBOOK_CONTEXT_TOTAL_TEXT_LIMIT)}`;
}

/**
 * Nearby cards from the same deck, so the tutor can spot the mix-ups and
 * contrasts a student is most likely to hit.
 *
 * Scoped to the deck rather than scanning a slice of the whole collection:
 * an unordered limit over every card returns an arbitrary window, so genuine
 * matches outside it are missed at random.
 */
async function loadRelatedCards(input: {
  db: AdminDb;
  uid: string;
  deckId: string;
  cardId: string;
  topicIds: readonly string[];
}) {
  if (!input.deckId) return "";

  const cards = input.db.collection("cards");
  const snapshots = await Promise.all(
    (["userId", "uid"] as const).map((ownerField) =>
      cards
        .where(ownerField, "==", input.uid)
        .where("deckId", "==", input.deckId)
        .limit(LEARN_RELATED_CARD_SCAN_LIMIT)
        .get()
    )
  );
  const cardDocuments = Array.from(
    new Map(
      snapshots.flatMap((snapshot) =>
        snapshot.docs.map((cardDoc) => [cardDoc.id, cardDoc] as const)
      )
    ).values()
  );

  const related = cardDocuments
    .filter((doc) => doc.id !== input.cardId)
    .map((doc) => {
      const data = doc.data();
      return {
        front: normalizeString(data.front, 140),
        back: normalizeString(data.back, 220),
        overlap: countOverlap(normalizeIds(data.topicIds), input.topicIds),
      };
    })
    .filter((card) => card.front && card.back)
    .sort((left, right) => right.overlap - left.overlap)
    .slice(0, LEARN_MAX_RELATED_CARDS);

  if (related.length === 0) return "";

  return `Nearby cards in the same deck:
${related.map((card) => `- Q: ${card.front}\n  A: ${card.back}`).join("\n")}

Use these only to infer likely mix-ups or useful contrasts. Never answer as though the student asked about one of them.`;
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

  const sourceCollection = input.db
    .collection("users")
    .doc(input.uid)
    .collection("sources");
  const relationQueries = [];
  if (input.relations.folderIds.length > 0) {
    relationQueries.push(
      sourceCollection
        .where("status", "==", "active")
        .where(
          "folderIds",
          "array-contains-any",
          input.relations.folderIds.slice(0, 30)
        )
        .limit(MAX_SOURCE_CANDIDATES_PER_RELATION)
        .get()
    );
  }
  if (input.relations.topicIds.length > 0) {
    relationQueries.push(
      sourceCollection
        .where("status", "==", "active")
        .where(
          "topicIds",
          "array-contains-any",
          input.relations.topicIds.slice(0, 30)
        )
        .limit(MAX_SOURCE_CANDIDATES_PER_RELATION)
        .get()
    );
  }
  const snapshots = await Promise.all(relationQueries);
  const candidates = new Map<string, Source>();
  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((sourceDoc) => {
      candidates.set(
        sourceDoc.id,
        mapSourceData(sourceDoc.id, sourceDoc.data() ?? {})
      );
    });
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
  const topicIds = normalizeIds(cardData.topicIds);
  const relatedCardsText = await loadRelatedCards({
    db: input.db,
    uid: input.uid,
    deckId,
    cardId: cardSnapshot.id,
    topicIds,
  });

  /*
   * The answer is withheld until the student has flipped the card.
   *
   * Telling the model to avoid spoiling it was never a real guarantee: it held
   * the answer and was instructed to hand it over if asked plainly, so the
   * hinting was decorative. Not sending it makes the constraint structural.
   * A student who wants the answer flips the card, which is the point of a
   * flashcard, and the related cards below still let the tutor spot likely
   * mix-ups without seeing this card's answer.
   */
  const answerIsVisibleToStudent = input.context.phase === "answer";

  const parts: AiContentPart[] = [
    {
      text: [
        `Learn phase: ${input.context.phase}`,
        `Deck: ${deckName}`,
        `Card front: ${front || "(empty)"}`,
        answerIsVisibleToStudent
          ? `Card answer: ${back || "(empty)"}`
          : "Card answer: withheld. The student has not flipped this card yet, so you have not been given it. Help them recall it themselves. If they ask for it outright, say you cannot see it and suggest they flip the card.",
        "",
        describeMemoryProfile(cardData),
        ...(relatedCardsText ? ["", relatedCardsText] : []),
      ].join("\n"),
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
      topicIds,
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
    ] satisfies AiContentPart[],
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
  const [notebookSnapshot, pageSnapshot, notebookPagesSnapshot] = await Promise.all([
    userRef.collection("notebooks").doc(input.context.notebookId).get(),
    userRef.collection("notebookPages").doc(input.context.pageId).get(),
    userRef
      .collection("notebookPages")
      .where("notebookId", "==", input.context.notebookId)
      .orderBy("pageNumber", "asc")
      .limit(NOTEBOOK_CONTEXT_PAGE_LIMIT)
      .get(),
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
  const notebookPages = notebookPagesSnapshot.docs
    .map((snapshot) =>
      mapNotebookPageData(snapshot.id, snapshot.data() as Record<string, unknown>)
    )
    .filter((candidate) => candidate.notebookId === notebook.id);
  const notebookPageMap = buildNotebookPageMap(notebookPages, page.id);
  const currentParts: AiContentPart[] = [
    {
      text: `Notebook: ${notebook.title}\nPage: ${page.pageNumber}${
        questionPrompt ? `\nQuestion prompt: ${questionPrompt}` : ""
      }${typedText ? `\nTyped page content:\n${typedText}` : ""}${
        notebookPageMap ? `\n\n${notebookPageMap}` : ""
      }`,
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
  const [sources, preferences] = await Promise.all([
    selectSources({
      db,
      uid,
      relations: resolved.relations,
      message: input.message,
      includeRelated: input.useRelatedSources,
    }),
    loadTutorPreferences({
      db,
      uid,
      folderIds: resolved.relations.folderIds,
    }),
  ]);

  return {
    currentId: resolved.currentId,
    currentLabel: resolved.currentLabel,
    currentParts: resolved.currentParts,
    sources,
    studyLevelContext: preferences.studyLevelContext,
    personalisationContext: preferences.personalisationContext,
    reasoningEffort: preferences.reasoningEffort,
  };
}

/** Re-exported so the assistant route reads the whole context surface from one module. */
export { JamiAssistantContextError } from "@/lib/ai/assistant-context.server";
export type { ResolvedJamiAssistantContext } from "@/lib/ai/assistant-context.server";
