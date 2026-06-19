import {
  normalizeOptionalString,
  normalizeStringArray,
} from "@/lib/practice/content";

export type TopicStatus = "active" | "archived" | "merged";
export type TopicCreatedBy = "user" | "system" | "ai-suggested";

export type Topic = {
  id: string;
  name: string;
  normalizedName?: string;
  slug: string;
  subject: string;
  parentTopicId?: string;
  aliases?: string[];
  status: TopicStatus;
  mergedIntoTopicId?: string;
  createdBy: TopicCreatedBy;
  createdAt: number;
  updatedAt: number;
  statsSummary?: Record<string, unknown>;
};

export const MAX_TOPIC_NAME_LENGTH = 80;
export const MAX_TOPIC_SUBJECT_LENGTH = 80;
export const MAX_TOPIC_ALIASES = 12;
export const MAX_LINKED_TOPICS = 5;

export function slugifyTopicName(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);

  return slug || "topic";
}

export function normalizeTopicName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_TOPIC_NAME_LENGTH);
}

export function getTopicNameKey(value: string) {
  return normalizeTopicName(value).toLocaleLowerCase();
}

export function normalizeTopicIds(value: unknown, limit = MAX_LINKED_TOPICS) {
  return normalizeStringArray(value, limit, 120);
}

export function normalizeTopicSubject(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_TOPIC_SUBJECT_LENGTH);
}

function isTopicStatus(value: unknown): value is TopicStatus {
  return value === "active" || value === "archived" || value === "merged";
}

function isTopicCreatedBy(value: unknown): value is TopicCreatedBy {
  return value === "user" || value === "system" || value === "ai-suggested";
}

export function mapTopicData(id: string, data: Record<string, unknown>): Topic {
  const name = normalizeTopicName(typeof data.name === "string" ? data.name : "");
  const subject = normalizeTopicSubject(typeof data.subject === "string" ? data.subject : "");
  const slug =
    typeof data.slug === "string" && data.slug.trim()
      ? data.slug.trim().slice(0, 100)
      : slugifyTopicName(name);

  return {
    id,
    name: name || "Untitled topic",
    normalizedName:
      normalizeOptionalString(data.normalizedName, MAX_TOPIC_NAME_LENGTH) ??
      getTopicNameKey(name),
    slug,
    subject: subject || "General",
    parentTopicId: normalizeOptionalString(data.parentTopicId, 120),
    aliases: normalizeStringArray(data.aliases, MAX_TOPIC_ALIASES, MAX_TOPIC_NAME_LENGTH),
    status: isTopicStatus(data.status) ? data.status : "active",
    mergedIntoTopicId: normalizeOptionalString(data.mergedIntoTopicId, 120),
    createdBy: isTopicCreatedBy(data.createdBy) ? data.createdBy : "user",
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    statsSummary:
      data.statsSummary && typeof data.statsSummary === "object" && !Array.isArray(data.statsSummary)
        ? (data.statsSummary as Record<string, unknown>)
        : undefined,
  };
}
