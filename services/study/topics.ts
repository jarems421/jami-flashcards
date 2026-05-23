import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import {
  mapTopicData,
  normalizeTopicName,
  normalizeTopicSubject,
  slugifyTopicName,
  type Topic,
} from "@/lib/practice/topics";

const LOAD_MS = 30_000;
const WRITE_MS = 30_000;

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
  const docRef = await withTimeout(
    addDoc(topicsCollection(userId), {
      name,
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
    updates.name = name;
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
