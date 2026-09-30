import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import { invalidateAllDashboardData } from "@/services/dashboard/cache";
import { createStorageFileId } from "@/services/firebase/storage-files";
import {
  MAX_FRONT_LENGTH,
  mapCardData,
  normalizeCardContentInput,
  type Card,
} from "@/lib/study/cards";
import type { CardImage } from "@/lib/study/card-images";
import {
  cleanDiagramGroups,
  cleanDiagramLabels,
  getDiagramDraftError,
  getDiagramTargets,
  getGroupAnswerText,
  occlusionOrder,
  planDiagramCleanup,
  planDiagramSave,
  type CardOcclusion,
  type OcclusionDiagram,
  type OcclusionGroup,
  type OcclusionLabel,
  type OcclusionLabelMode,
  type OcclusionTarget,
} from "@/lib/study/image-occlusion";
import { buildNewCard, deleteCards, getCardWrite } from "@/services/study/cards";
import { deleteCardImageFiles, uploadCardImage } from "@/services/study/card-images";
import { reportTutorialAction } from "@/lib/onboarding/tutorial";
import { measurePicture, prepareDiagramPicture } from "@/lib/study/diagram-image";
import { ankiDraftToLabels } from "@/lib/study/import/anki-occlusion";
import type { AnkiPackageDiagram } from "@/lib/study/import/anki-package";

const LOAD_MS = 20_000;
const WRITE_MS = 30_000;

/** Every card of one diagram, wherever its cards now live, read fresh. */
export async function loadDiagramCards(userId: string, diagramId: string): Promise<Card[]> {
  const snapshot = await withTimeout(
    getDocs(
      query(
        collection(db, "cards"),
        where("userId", "==", userId),
        where("occlusion.diagram.id", "==", diagramId)
      )
    ),
    LOAD_MS,
    "Load diagram cards"
  );
  return snapshot.docs.map((cardDoc) =>
    mapCardData(cardDoc.id, cardDoc.data() as Record<string, unknown>)
  );
}

/**
 * Whether any diagram other than `exceptDiagramId` still shows this picture.
 *
 * A picture can carry two diagrams -- the same heart labelled for chambers and
 * again for vessels -- so freeing it when one diagram goes would break the
 * other. One card is enough to say it is in use.
 */
async function isPictureUsedElsewhere(userId: string, storagePath: string, exceptDiagramId: string) {
  const snapshot = await withTimeout(
    getDocs(
      query(
        collection(db, "cards"),
        where("userId", "==", userId),
        where("occlusion.diagram.image.storagePath", "==", storagePath),
        limit(20)
      )
    ),
    LOAD_MS,
    "Check diagram picture"
  );
  return snapshot.docs.some((cardDoc) => {
    const occlusion = (cardDoc.data() as { occlusion?: { diagram?: { id?: unknown } } }).occlusion;
    return occlusion?.diagram?.id !== exceptDiagramId;
  });
}

/** Frees diagram pictures no diagram shows any more. Best effort, like every card image delete. */
async function releasePictures(userId: string, pictures: ReadonlyArray<{ image: CardImage; diagramId: string }>) {
  const unused: CardImage[] = [];
  for (const { image, diagramId } of pictures) {
    try {
      if (!(await isPictureUsedElsewhere(userId, image.storagePath, diagramId))) unused.push(image);
    } catch (error) {
      // Kept rather than risk deleting a picture another diagram shows.
      console.error("Could not check whether a diagram picture is shared.", error);
    }
  }
  await deleteCardImageFiles(unused);
}

export type DiagramPictureInput =
  | { kind: "saved"; image: CardImage }
  | { kind: "new"; file: File; width: number; height: number };

export type DiagramSaveInput = {
  userId: string;
  /** Where new cards go. Existing cards stay in whatever deck they are in. */
  deckId: string;
  /** The diagram being edited; absent for a new one. */
  diagramId?: string;
  /** The line shown with every card of the diagram, or empty. */
  header: string;
  /**
   * Topics for every card of the diagram. Absent leaves existing cards' topics
   * alone -- they may have been set card by card -- and gives new cards the
   * topics their siblings have.
   */
  topicIds?: string[];
  /** The diagram's picture: the one it already has, or a new file to upload. */
  picture: DiagramPictureInput;
  labelMode: OcclusionLabelMode;
  hideOthers: boolean;
  pointerEnd?: "dot" | "arrow";
  labels: OcclusionLabel[];
  groups?: OcclusionGroup[];
};

export type DiagramSaveResult = {
  diagram: OcclusionDiagram;
  /** Every card the diagram now has: its labels in order, then its groups. */
  cards: Card[];
  /** Cards whose labels or groups were removed, and which no longer exist. */
  removedCardIds: string[];
};

function occlusionFor(diagram: OcclusionDiagram, target: OcclusionTarget): CardOcclusion {
  return "groupId" in target ? { diagram, groupId: target.groupId } : { diagram, labelId: target.labelId };
}

/** What a card's back says: the label's words, or every named label of its group. */
function answerFor(diagram: OcclusionDiagram, target: OcclusionTarget) {
  if ("groupId" in target) {
    const group = diagram.groups?.find((entry) => entry.id === target.groupId);
    return group ? getGroupAnswerText(diagram, group) : "";
  }
  return diagram.labels.find((label) => label.id === target.labelId)?.answer ?? "";
}

/**
 * Save a diagram: its picture, then every card of it in one batch.
 *
 * A label or group keeps its card, and so its whole review history, however
 * its box or words change (`planDiagramSave`). The picture is uploaded before
 * the cards are written, because the cards must point at something that
 * exists; if the write fails, the upload is removed again, and if it succeeds,
 * the picture it replaced is -- unless another diagram still shows it.
 * Storage ends holding exactly what cards refer to, the same promise ordinary
 * card images keep.
 */
export async function saveDiagram(input: DiagramSaveInput): Promise<DiagramSaveResult> {
  const labels = cleanDiagramLabels(input.labels);
  const problem = getDiagramDraftError({ labelMode: input.labelMode, labels, groups: input.groups });
  if (problem) throw new Error(problem);
  const groups = cleanDiagramGroups(input.groups ?? [], labels);
  const header = normalizeCardContentInput(input.header).slice(0, MAX_FRONT_LENGTH);

  const siblings = input.diagramId ? await loadDiagramCards(input.userId, input.diagramId) : [];
  const previousImage = siblings.find((card) => card.occlusion)?.occlusion?.diagram.image;

  let uploaded: CardImage | null = null;
  let image: CardImage;
  if (input.picture.kind === "new") {
    const stored = await uploadCardImage(input.userId, input.picture.file);
    // The editor has measured the picture already; trust that over a failed read.
    uploaded = {
      ...stored,
      width: stored.width || input.picture.width,
      height: stored.height || input.picture.height,
    };
    image = uploaded;
  } else {
    image = input.picture.image;
  }

  const diagram: OcclusionDiagram = {
    id: input.diagramId ?? createStorageFileId(),
    image,
    labelMode: input.labelMode,
    hideOthers: input.hideOthers,
    labels,
    ...(groups.length > 0 ? { groups } : {}),
    ...(input.pointerEnd === "arrow" ? { pointerEnd: "arrow" as const } : {}),
  };
  const plan = planDiagramSave(siblings, getDiagramTargets(diagram));
  const siblingById = new Map(siblings.map((card) => [card.id, card]));
  const newCardTopics = input.topicIds ?? siblings[0]?.topicIds ?? [];
  const createdAtBase = Date.now();

  const batch = writeBatch(db);
  const cards: Card[] = [];
  for (const { target, cardId } of plan.keep) {
    const occlusion = occlusionFor(diagram, target);
    const back = answerFor(diagram, target);
    const fields = {
      front: header,
      back,
      occlusion,
      tags: [],
      ...(input.topicIds ? { topicIds: input.topicIds } : {}),
    };
    batch.update(doc(db, "cards", cardId), fields);
    cards.push({ ...siblingById.get(cardId)!, ...fields });
  }
  for (const target of plan.create) {
    const cardRef = doc(collection(db, "cards"));
    const occlusion = occlusionFor(diagram, target);
    // The first label newest, so a newest-first list reads the diagram in order.
    const card = buildNewCard(
      {
        userId: input.userId,
        deckId: input.deckId,
        front: header,
        back: answerFor(diagram, target),
        occlusion,
        topicIds: newCardTopics,
      },
      cardRef.id,
      createdAtBase - occlusionOrder(occlusion)
    );
    batch.set(cardRef, getCardWrite(card));
    cards.push(card);
  }
  for (const cardId of plan.remove) {
    batch.delete(doc(db, "cards", cardId));
  }

  try {
    await withTimeout(batch.commit(), WRITE_MS, "Save diagram");
  } catch (error) {
    if (uploaded) await deleteCardImageFiles([uploaded]);
    throw error;
  }

  invalidateAllDashboardData();
  if (plan.create.length > 0) reportTutorialAction("create-card", { deckId: input.deckId });
  if (previousImage && previousImage.storagePath !== image.storagePath) {
    await releasePictures(input.userId, [{ image: previousImage, diagramId: diagram.id }]);
  }

  cards.sort((left, right) => occlusionOrder(left.occlusion!) - occlusionOrder(right.occlusion!));
  return { diagram, cards, removedCardIds: plan.remove };
}

export type DiagramCleanupResult = {
  updates: Array<{ cardId: string; occlusion: CardOcclusion }>;
  /** Group cards deleted because every label they asked was deleted. */
  deletedCardIds: string[];
};

/**
 * Keep diagrams equal to their cards after cards were deleted.
 *
 * Call with the cards that were just deleted, whatever deleted them. Their
 * labels are removed from the diagram's remaining cards, so the editor never
 * finds a label with no card behind it; a group left with none of its labels
 * goes with them; a diagram with no cards left frees its picture unless
 * another diagram shows it. Diagram-free deletions cost nothing: no reads
 * happen.
 *
 * Best effort, like removing an ordinary card's image: the cards are already
 * gone, and a tidy-up that fails is not worth an error about them. What it
 * returns is what changed, for a page to update the cards it shows.
 */
export async function releaseDiagramLabels(
  userId: string,
  deletedCards: readonly Card[]
): Promise<DiagramCleanupResult> {
  const diagramIds = [
    ...new Set(deletedCards.flatMap((card) => (card.occlusion ? [card.occlusion.diagram.id] : []))),
  ];
  if (diagramIds.length === 0) return { updates: [], deletedCardIds: [] };

  try {
    const survivors = (
      await Promise.all(diagramIds.map((diagramId) => loadDiagramCards(userId, diagramId)))
    ).flat();
    const plan = planDiagramCleanup(deletedCards, survivors);
    if (plan.updates.length > 0 || plan.deletes.length > 0) {
      const batch = writeBatch(db);
      for (const update of plan.updates) {
        batch.update(doc(db, "cards", update.cardId), { occlusion: update.occlusion });
      }
      for (const cardId of plan.deletes) batch.delete(doc(db, "cards", cardId));
      await withTimeout(batch.commit(), WRITE_MS, "Update diagram labels");
      invalidateAllDashboardData();
    }
    const diagramIdByPath = new Map(
      deletedCards.flatMap((card) =>
        card.occlusion ? [[card.occlusion.diagram.image.storagePath, card.occlusion.diagram.id] as const] : []
      )
    );
    await releasePictures(
      userId,
      plan.orphanedImages.map((image) => ({ image, diagramId: diagramIdByPath.get(image.storagePath) ?? "" }))
    );
    return { updates: plan.updates, deletedCardIds: plan.deletes };
  } catch (error) {
    console.error("Failed to tidy diagrams after deleting cards.", error);
    return { updates: [], deletedCardIds: [] };
  }
}

/** Delete a whole diagram: every card of it, then its picture unless another diagram shows it. */
export async function deleteDiagram(userId: string, diagramId: string): Promise<string[]> {
  const cards = await loadDiagramCards(userId, diagramId);
  const cardIds = cards.map((card) => card.id);
  await deleteCards(cardIds);
  const images = new Map<string, CardImage>();
  for (const card of cards) {
    if (card.occlusion) images.set(card.occlusion.diagram.image.storagePath, card.occlusion.diagram.image);
  }
  await releasePictures(userId, [...images.values()].map((image) => ({ image, diagramId })));
  return cardIds;
}

export type AnkiDiagramImportResult = {
  cards: Card[];
  imported: number;
  failed: number;
};

/**
 * Anki image occlusion notes, saved as diagrams in a deck, one at a time.
 *
 * Each picture is prepared the way a chosen picture is -- scaled if it is huge
 * -- and its boxes are read against its real size, since some Anki versions
 * wrote them in pixels. A diagram that fails is counted and skipped rather
 * than stopping the rest.
 */
export async function importAnkiDiagrams(
  userId: string,
  deckId: string,
  diagrams: readonly AnkiPackageDiagram[],
  onProgress?: (completed: number, total: number) => void
): Promise<AnkiDiagramImportResult> {
  const cards: Card[] = [];
  let imported = 0;
  let failed = 0;
  for (const [position, diagram] of diagrams.entries()) {
    try {
      const blob = new Blob([diagram.image.bytes.slice()], { type: diagram.image.mimeType });
      const original = await measurePicture(blob);
      const picture = await prepareDiagramPicture(blob, diagram.imageName);
      const labels = ankiDraftToLabels(diagram, original.width, original.height, () =>
        createStorageFileId().slice(0, 12)
      );
      const result = await saveDiagram({
        userId,
        deckId,
        header: diagram.header,
        picture: { kind: "new", ...picture },
        labelMode: "cover",
        hideOthers: diagram.hideOthers,
        labels,
      });
      cards.push(...result.cards);
      imported += 1;
    } catch (error) {
      console.error("An Anki diagram could not be imported.", error);
      failed += 1;
    }
    onProgress?.(position + 1, diagrams.length);
  }
  return { cards, imported, failed };
}
