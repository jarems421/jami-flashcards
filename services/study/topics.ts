import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import {
  mapTopicData,
  getTopicNameKey,
  MAX_LINKED_TOPICS,
  normalizeTopicName,
  normalizeTopicSubject,
  slugifyTopicName,
  type Topic,
} from "@/lib/practice/topics";
import {
  buildMigratedTopicIds,
  chunkTopicWrites,
  collectMissingTopicNames,
} from "@/lib/practice/topic-management";

const LOAD_MS = 30_000;
const WRITE_MS = 30_000;
const BATCH_WRITE_LIMIT = 400;
export const TOPICS_MIGRATION_VERSION = 1;

function topicsCollection(userId: string) {
  return collection(db, "users", userId, "topics");
}

export async function getTopics(userId: string): Promise<Topic[]> {
  const snapshot = await withTimeout(
    getDocs(query(topicsCollection(userId), orderBy("updatedAt", "desc"))),
    LOAD_MS,
    "Load topics"
  );

  return snapshot.docs.map((topicDoc) =>
    mapTopicData(topicDoc.id, topicDoc.data() as Record<string, unknown>)
  );
}

export async function getActiveTopics(userId: string): Promise<Topic[]> {
  const topics = await getTopics(userId);
  return topics.filter((topic) => topic.status === "active");
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
        where("normalizedName", "==", normalizedName)
      )
    ),
    LOAD_MS,
    "Find topic"
  );
  const active = existing.docs
    .map((snapshot) =>
      mapTopicData(snapshot.id, snapshot.data() as Record<string, unknown>)
    )
    .find((topic) => topic.status === "active");
  if (active) return active;

  const legacyTopics = await getActiveTopics(userId);
  const legacyMatch = legacyTopics.find(
    (topic) => getTopicNameKey(topic.name) === normalizedName
  );
  if (legacyMatch) {
    await updateDoc(doc(db, "users", userId, "topics", legacyMatch.id), {
      normalizedName,
      updatedAt: Date.now(),
    });
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
          where("normalizedName", "==", normalizedName)
        )
      ),
      LOAD_MS,
      "Check Topic name"
    );
    const normalizedConflict =
      existing.docs.some(
        (snapshot) =>
          snapshot.id !== topicId &&
          mapTopicData(
            snapshot.id,
            snapshot.data() as Record<string, unknown>
          ).status === "active"
      );
    const legacyConflict = (await getActiveTopics(userId)).some(
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
}

async function commitBatches(
  operations: Array<(batch: ReturnType<typeof writeBatch>) => void>,
  label: string
) {
  for (const chunk of chunkTopicWrites(operations, BATCH_WRITE_LIMIT)) {
    const batch = writeBatch(db);
    chunk.forEach((operation) => operation(batch));
    await withTimeout(batch.commit(), WRITE_MS, label);
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

  const [cardsSnapshot, topicsSnapshot, foldersSnapshot] = await Promise.all([
    withTimeout(
      getDocs(query(collection(db, "cards"), where("userId", "==", normalizedUserId))),
      LOAD_MS,
      "Load cards for topic migration"
    ),
    withTimeout(getDocs(topicsCollection(normalizedUserId)), LOAD_MS, "Load topics for migration"),
    withTimeout(
      getDocs(collection(db, "users", normalizedUserId, "studyFolders")),
      LOAD_MS,
      "Load folders for topic migration"
    ),
  ]);

  const topicsByName = new Map(
    topicsSnapshot.docs.map((snapshot) => {
      const topic = mapTopicData(snapshot.id, snapshot.data() as Record<string, unknown>);
      return [getTopicNameKey(topic.name), topic] as const;
    })
  );
  const missingNames = collectMissingTopicNames(
    cardsSnapshot.docs.map((snapshot) =>
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
  await commitBatches(topicCreateOperations, "Create migrated topics");

  const updateOperations: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  const topicIdsByName = new Map(
    Array.from(topicsByName.entries()).map(([key, topic]) => [key, topic.id])
  );
  let migratedCards = 0;
  for (const snapshot of cardsSnapshot.docs) {
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
  await commitBatches(updateOperations, "Migrate card tags to topics");
  return { migratedCards, createdTopics: topicCreateOperations.length };
}

export async function deleteTopicEverywhere(userId: string, topicId: string) {
  const [cards, notebooks, sources, drafts, mastery] = await Promise.all([
    getDocs(query(collection(db, "cards"), where("userId", "==", userId))),
    getDocs(collection(db, "users", userId, "notebooks")),
    getDocs(collection(db, "users", userId, "sources")),
    getDocs(collection(db, "users", userId, "generatedContentDrafts")),
    getDocs(collection(db, "users", userId, "masteryEvents")),
  ]);
  const operations: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  for (const snapshot of [...cards.docs, ...notebooks.docs, ...sources.docs, ...drafts.docs]) {
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
    batch.delete(doc(db, "users", userId, "topics", topicId))
  );
  await commitBatches(operations, "Delete topic");
}

export function canAddTopicIds(topicIds: string[]) {
  return topicIds.length < MAX_LINKED_TOPICS;
}
