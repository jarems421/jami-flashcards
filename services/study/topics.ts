import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import { invalidateDashboardData } from "@/services/dashboard/cache";
import {
  readThroughCache,
  type CachedReadOptions,
} from "@/services/cache/read-through";
import {
  invalidateLegacyActiveRecords,
  loadCachedLegacyActiveRecords,
  mergeActiveItems,
} from "@/services/study/active-compatibility";
import {
  mapTopicData,
  getTopicNameKey,
  MAX_LINKED_TOPICS,
  normalizeTopicName,
  normalizeTopicSubject,
  slugifyTopicName,
  type Topic,
} from "@/lib/material/topics";
import {
  buildMigratedTopicIds,
  chunkTopicWrites,
  collectMissingTopicNames,
} from "@/lib/material/topic-management";

const LOAD_MS = 30_000;
const WRITE_MS = 30_000;
const BATCH_WRITE_LIMIT = 400;
export const TOPICS_MIGRATION_VERSION = 1;

function topicsCollection(userId: string) {
  return collection(db, "users", userId, "topics");
}

const TOPICS_COLLECTION = "topics";

async function getLegacyActiveTopics(userId: string) {
  const records = await loadCachedLegacyActiveRecords(
    userId,
    TOPICS_COLLECTION,
    async () => {
      const snapshot = await withTimeout(
        getDocs(topicsCollection(userId)),
        LOAD_MS,
        "Load legacy topics"
      );
      return snapshot.docs
        .map((topicDoc) => ({
          id: topicDoc.id,
          data: topicDoc.data() as Record<string, unknown>,
        }))
        .filter(
          ({ data }) =>
            data.status !== "active" &&
            data.status !== "archived" &&
            data.status !== "merged"
        );
    }
  );
  return records.map(({ id, data }) => mapTopicData(id, data));
}

/** Shared by six pages, so the result is cached rather than re-read by each. */
export async function getActiveTopics(
  userId: string,
  options: CachedReadOptions = {}
): Promise<Topic[]> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");
  return readThroughCache(
    { collection: "topics:active", userId: normalizedUserId },
    () => loadActiveTopics(normalizedUserId),
    options
  );
}

async function loadActiveTopics(normalizedUserId: string): Promise<Topic[]> {
  const [snapshot, legacyItems] = await Promise.all([
    withTimeout(
      getDocs(
        query(
          topicsCollection(normalizedUserId),
          where("status", "==", "active"),
          orderBy("updatedAt", "desc")
        )
      ),
      LOAD_MS,
      "Load active topics"
    ),
    getLegacyActiveTopics(normalizedUserId),
  ]);

  const currentItems = snapshot.docs.map((topicDoc) =>
    mapTopicData(topicDoc.id, topicDoc.data() as Record<string, unknown>)
  );
  return mergeActiveItems(currentItems, legacyItems);
}

export async function createTopic(
  userId: string,
  input: {
    name: string;
    subject?: string;
    parentTopicId?: string;
    aliases?: string[];
  }
) {
  const name = normalizeTopicName(input.name);
  if (!name) {
    throw new Error("Topic name is required.");
  }

  const now = Date.now();
  const subject = normalizeTopicSubject(input.subject ?? "") || "General";
  const normalizedName = getTopicNameKey(name);
  const docRef = await withTimeout(
    addDoc(topicsCollection(userId), {
      name,
      normalizedName,
      slug: slugifyTopicName(name),
      subject,
      parentTopicId: input.parentTopicId?.trim() || null,
      aliases: input.aliases ?? [],
      status: "active",
      createdBy: "user",
      createdAt: now,
      updatedAt: now,
    }),
    WRITE_MS,
    "Create topic"
  );
  invalidateDashboardData(userId);
  invalidateLegacyActiveRecords(userId, TOPICS_COLLECTION);

  return {
    id: docRef.id,
    name,
    normalizedName,
    slug: slugifyTopicName(name),
    subject,
    parentTopicId: input.parentTopicId?.trim() || undefined,
    aliases: input.aliases ?? [],
    status: "active" as const,
    createdBy: "user" as const,
    createdAt: now,
    updatedAt: now,
  };
}

export async function createOrGetTopic(userId: string, nameInput: string) {
  const name = normalizeTopicName(nameInput);
  if (!name) throw new Error("Topic name is required.");
  const normalizedName = getTopicNameKey(name);
  const existing = await withTimeout(
    getDocs(
      query(
        topicsCollection(userId),
        where("normalizedName", "==", normalizedName),
        where("status", "==", "active"),
        limit(1)
      )
    ),
    LOAD_MS,
    "Find topic"
  );
  const active = existing.docs[0]
    ? mapTopicData(
        existing.docs[0].id,
        existing.docs[0].data() as Record<string, unknown>
      )
    : undefined;
  if (active) return active;

  // Deciding whether to create a topic or adopt an existing one. A stale list
  // here makes a duplicate.
  const legacyTopics = await getActiveTopics(userId, { force: true });
  const legacyMatch = legacyTopics.find(
    (topic) => getTopicNameKey(topic.name) === normalizedName
  );
  if (legacyMatch) {
    await updateDoc(doc(db, "users", userId, "topics", legacyMatch.id), {
      normalizedName,
      updatedAt: Date.now(),
    });
    invalidateDashboardData(userId);
    invalidateLegacyActiveRecords(userId, TOPICS_COLLECTION);
    return { ...legacyMatch, normalizedName };
  }

  return createTopic(userId, { name });
}

export async function updateTopic(
  userId: string,
  topicId: string,
  input: {
    name?: string;
    subject?: string;
    aliases?: string[];
    status?: "active" | "archived";
  }
) {
  const updates: Record<string, unknown> = {
    updatedAt: Date.now(),
  };

  if (input.name !== undefined) {
    const name = normalizeTopicName(input.name);
    if (!name) throw new Error("Topic name is required.");
    const normalizedName = getTopicNameKey(name);
    const existing = await withTimeout(
      getDocs(
        query(
          topicsCollection(userId),
          where("normalizedName", "==", normalizedName),
          where("status", "==", "active"),
          limit(2)
        )
      ),
      LOAD_MS,
      "Check Topic name"
    );
    const normalizedConflict = existing.docs.some(
      (snapshot) => snapshot.id !== topicId
    );
    // Compatibility-only fallback: early topic documents did not store
    // normalizedName, so exact-query uniqueness cannot see them. Remove this
    // full active-topic scan only after that legacy shape is migrated.
    const legacyConflict = normalizedConflict
      ? false
      : // A uniqueness check standing between the student and a write.
        (await getActiveTopics(userId, { force: true })).some(
          (topic) =>
            topic.id !== topicId &&
            getTopicNameKey(topic.name) === normalizedName
        );
    if (normalizedConflict || legacyConflict) {
      throw new Error("A Topic with this name already exists.");
    }
    updates.name = name;
    updates.normalizedName = normalizedName;
    updates.slug = slugifyTopicName(name);
  }

  if (input.subject !== undefined) {
    updates.subject = normalizeTopicSubject(input.subject) || "General";
  }

  if (input.aliases !== undefined) {
    updates.aliases = input.aliases;
  }

  if (input.status) {
    updates.status = input.status;
  }

  await withTimeout(
    updateDoc(doc(db, "users", userId, "topics", topicId), updates),
    WRITE_MS,
    "Update topic"
  );
  invalidateDashboardData(userId);
  invalidateLegacyActiveRecords(userId, TOPICS_COLLECTION);
}

async function commitBatches(
  operations: Array<(batch: ReturnType<typeof writeBatch>) => void>,
  label: string,
  onCommitted?: () => void
) {
  for (const chunk of chunkTopicWrites(operations, BATCH_WRITE_LIMIT)) {
    const batch = writeBatch(db);
    chunk.forEach((operation) => operation(batch));
    await withTimeout(batch.commit(), WRITE_MS, label);
    onCommitted?.();
  }
}

export async function migrateCardTagsToTopics(userId: string) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");
  const userRef = doc(db, "users", normalizedUserId);
  const userSnapshot = await withTimeout(getDoc(userRef), LOAD_MS, "Load topic migration");
  if (
    userSnapshot.exists() &&
    userSnapshot.data().topicsMigrationVersion === TOPICS_MIGRATION_VERSION
  ) {
    return { migratedCards: 0, createdTopics: 0 };
  }

  const [currentCardsSnapshot, legacyCardsSnapshot, topicsSnapshot, foldersSnapshot] = await Promise.all([
    withTimeout(
      getDocs(query(collection(db, "cards"), where("userId", "==", normalizedUserId))),
      LOAD_MS,
      "Load cards for topic migration"
    ),
    withTimeout(
      getDocs(query(collection(db, "cards"), where("uid", "==", normalizedUserId))),
      LOAD_MS,
      "Load legacy cards for topic migration"
    ),
    withTimeout(getDocs(topicsCollection(normalizedUserId)), LOAD_MS, "Load topics for migration"),
    withTimeout(
      getDocs(collection(db, "users", normalizedUserId, "studyFolders")),
      LOAD_MS,
      "Load folders for topic migration"
    ),
  ]);
  const cardsById = new Map(
    [...currentCardsSnapshot.docs, ...legacyCardsSnapshot.docs].map((cardDoc) => [
      cardDoc.id,
      cardDoc,
    ])
  );
  const cardDocuments = Array.from(cardsById.values());

  const topicsByName = new Map(
    topicsSnapshot.docs.map((snapshot) => {
      const topic = mapTopicData(snapshot.id, snapshot.data() as Record<string, unknown>);
      return [getTopicNameKey(topic.name), topic] as const;
    })
  );
  const missingNames = collectMissingTopicNames(
    cardDocuments.map((snapshot) =>
      Array.isArray(snapshot.data().tags)
        ? snapshot
            .data()
            .tags.filter(
              (value: unknown): value is string => typeof value === "string"
            )
        : []
    ),
    Array.from(topicsByName.values())
  );

  const topicCreateOperations: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  const now = Date.now();
  for (const name of missingNames) {
    const normalizedName = getTopicNameKey(name);
    const topicRef = doc(topicsCollection(normalizedUserId));
    const topic = mapTopicData(topicRef.id, {
      name,
      normalizedName,
      slug: slugifyTopicName(name),
      subject: "General",
      status: "active",
      createdBy: "user",
      createdAt: now,
      updatedAt: now,
    });
    topicsByName.set(normalizedName, topic);
    topicCreateOperations.push((batch) =>
      batch.set(topicRef, {
        name,
        normalizedName,
        slug: slugifyTopicName(name),
        subject: "General",
        parentTopicId: null,
        aliases: [],
        status: "active",
        createdBy: "user",
        createdAt: now,
        updatedAt: now,
      })
    );
  }
  const invalidateTopicData = () => {
    invalidateDashboardData(normalizedUserId);
    invalidateLegacyActiveRecords(normalizedUserId, TOPICS_COLLECTION);
  };
  await commitBatches(
    topicCreateOperations,
    "Create migrated topics",
    invalidateTopicData
  );

  const updateOperations: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  const topicIdsByName = new Map(
    Array.from(topicsByName.entries()).map(([key, topic]) => [key, topic.id])
  );
  let migratedCards = 0;
  for (const snapshot of cardDocuments) {
    const data = snapshot.data();
    const tags = Array.isArray(data.tags)
      ? data.tags.filter((value: unknown): value is string => typeof value === "string")
      : [];
    if (tags.length === 0) continue;
    const topicIds = Array.isArray(data.topicIds)
      ? data.topicIds.filter((value: unknown): value is string => typeof value === "string")
      : [];
    const nextTopicIds = buildMigratedTopicIds(
      topicIds,
      tags,
      topicIdsByName
    );
    updateOperations.push((batch) =>
      batch.update(snapshot.ref, { topicIds: nextTopicIds, tags: [] })
    );
    migratedCards += 1;
  }
  for (const snapshot of foldersSnapshot.docs) {
    if (Array.isArray(snapshot.data().topicIds) && snapshot.data().topicIds.length > 0) {
      updateOperations.push((batch) => batch.update(snapshot.ref, { topicIds: [] }));
    }
  }
  updateOperations.push((batch) =>
    batch.set(
      userRef,
      { topicsMigrationVersion: TOPICS_MIGRATION_VERSION, topicsMigratedAt: Date.now() },
      { merge: true }
    )
  );
  await commitBatches(
    updateOperations,
    "Migrate card tags to topics",
    invalidateTopicData
  );
  return { migratedCards, createdTopics: topicCreateOperations.length };
}

export async function deleteTopicEverywhere(userId: string, topicId: string) {
  const normalizedUserId = userId.trim();
  const normalizedTopicId = topicId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");
  if (!normalizedTopicId) throw new Error("Missing topicId.");

  const [currentCards, legacyCards, notebooks, sources, drafts, mastery] = await Promise.all([
    getDocs(
      query(
        collection(db, "cards"),
        where("userId", "==", normalizedUserId),
        where("topicIds", "array-contains", normalizedTopicId)
      )
    ),
    getDocs(
      query(
        collection(db, "cards"),
        where("uid", "==", normalizedUserId),
        where("topicIds", "array-contains", normalizedTopicId)
      )
    ),
    getDocs(
      query(
        collection(db, "users", normalizedUserId, "notebooks"),
        where("topicIds", "array-contains", normalizedTopicId)
      )
    ),
    getDocs(
      query(
        collection(db, "users", normalizedUserId, "sources"),
        where("topicIds", "array-contains", normalizedTopicId)
      )
    ),
    getDocs(
      query(
        collection(db, "users", normalizedUserId, "generatedContentDrafts"),
        where("topicIds", "array-contains", normalizedTopicId)
      )
    ),
    getDocs(
      query(
        collection(db, "users", normalizedUserId, "masteryEvents"),
        where("topicId", "==", normalizedTopicId)
      )
    ),
  ]);
  const cardDocuments = Array.from(
    new Map(
      [...currentCards.docs, ...legacyCards.docs].map((cardDoc) => [
        cardDoc.id,
        cardDoc,
      ])
    ).values()
  );
  const operations: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  for (const snapshot of [...cardDocuments, ...notebooks.docs, ...sources.docs, ...drafts.docs]) {
    const topicIds = Array.isArray(snapshot.data().topicIds)
      ? snapshot.data().topicIds.filter((value: unknown): value is string => typeof value === "string")
      : [];
    if (topicIds.includes(topicId)) {
      operations.push((batch) =>
        batch.update(snapshot.ref, {
          topicIds: topicIds.filter((id: string) => id !== topicId),
        })
      );
    }
  }
  for (const snapshot of mastery.docs) {
    if (snapshot.data().topicId === topicId) {
      operations.push((batch) => batch.delete(snapshot.ref));
    }
  }
  operations.push((batch) =>
    batch.delete(
      doc(db, "users", normalizedUserId, "topics", normalizedTopicId)
    )
  );
  const invalidateTopicData = () => {
    invalidateDashboardData(normalizedUserId);
    invalidateLegacyActiveRecords(normalizedUserId, TOPICS_COLLECTION);
  };
  await commitBatches(operations, "Delete topic", invalidateTopicData);
}

export function canAddTopicIds(topicIds: string[]) {
  return topicIds.length < MAX_LINKED_TOPICS;
}
