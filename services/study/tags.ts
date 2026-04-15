import { db } from "../firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import { getTagKey, normalizeCardTags } from "@/lib/study/cards";
import {
  collection,
  getDocs,
  query,
  where,
  writeBatch,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

const LOAD_MS = 30_000;
const UPDATE_MS = 30_000;
const BATCH_WRITE_LIMIT = 400;

type TagUpdate = {
  snapshot: QueryDocumentSnapshot;
  nextTags: string[];
};

function normalizeSingleRequestedTag(value: string): string {
  return normalizeCardTags([value])[0] ?? "";
}

async function commitTagUpdates(updates: TagUpdate[], label: string): Promise<void> {
  if (updates.length === 0) {
    return;
  }

  for (let index = 0; index < updates.length; index += BATCH_WRITE_LIMIT) {
    const batch = writeBatch(db);
    const chunk = updates.slice(index, index + BATCH_WRITE_LIMIT);

    for (const update of chunk) {
      batch.update(update.snapshot.ref, {
        tags: update.nextTags,
      });
    }

    await withTimeout(batch.commit(), UPDATE_MS, label);
  }
}

async function loadTagUpdates(
  userId: string,
  sourceTag: string,
  targetTag: string | null
): Promise<TagUpdate[]> {
  const normalizedUserId = userId.trim();
  const normalizedSourceTag = normalizeSingleRequestedTag(sourceTag);
  const normalizedTargetTag = targetTag ? normalizeSingleRequestedTag(targetTag) : "";

  if (!normalizedUserId) {
    throw new Error("Missing userId");
  }

  if (!normalizedSourceTag) {
    throw new Error("Choose a valid source tag.");
  }

  const snapshot = await withTimeout(
    getDocs(query(collection(db, "cards"), where("userId", "==", normalizedUserId))),
    LOAD_MS,
    "Load cards for tag update"
  );

  return snapshot.docs.flatMap((cardSnapshot) => {
    const currentTags = normalizeCardTags(cardSnapshot.data().tags);
    const sourceKey = getTagKey(normalizedSourceTag);
    if (!currentTags.some((tag) => getTagKey(tag) === sourceKey)) {
      return [];
    }

    const nextTags = normalizeCardTags(
      currentTags.flatMap((tag) => {
        if (getTagKey(tag) !== sourceKey) {
          return [tag];
        }

        return normalizedTargetTag ? [normalizedTargetTag] : [];
      })
    );

    return [{ snapshot: cardSnapshot, nextTags }];
  });
}

export async function renameUserTag(
  userId: string,
  sourceTag: string,
  targetTag: string
): Promise<number> {
  const normalizedSourceTag = normalizeSingleRequestedTag(sourceTag);
  const normalizedTargetTag = normalizeSingleRequestedTag(targetTag);

  if (!normalizedTargetTag) {
    throw new Error("Choose a valid replacement tag.");
  }

  if (normalizedSourceTag === normalizedTargetTag) {
    return 0;
  }

  const updates = await loadTagUpdates(userId, sourceTag, targetTag);
  await commitTagUpdates(updates, `Rename tag ${normalizedSourceTag}`);
  return updates.length;
}

export async function removeUserTag(userId: string, sourceTag: string): Promise<number> {
  const normalizedSourceTag = normalizeSingleRequestedTag(sourceTag);
  const updates = await loadTagUpdates(userId, sourceTag, null);
  await commitTagUpdates(updates, `Remove tag ${normalizedSourceTag}`);
  return updates.length;
}
