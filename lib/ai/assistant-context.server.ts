import "server-only";

import type { AiContentPart } from "@/lib/ai/content-parts";
import { JAMI_ASSISTANT_MAX_SNAPSHOT_BYTES } from "@/lib/ai/jami-assistant";
import type { Source } from "@/lib/material/sources";

const MAX_RELATED_SOURCES = 15;

export type SourceRelations = {
  currentSourceIds: string[];
  directSourceIds: string[];
  folderIds: string[];
  topicIds: string[];
};

export type ResolvedJamiAssistantContext = {
  currentId: string;
  currentLabel: string;
  currentParts: AiContentPart[];
  sources: Source[];
  studyLevelContext?: string;
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

export function normalizeString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeIds(value: unknown, maxItems = 30) {
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

/**
 * Describes how well the student knows this card, from the FSRS state already
 * stored on the card document, so the tutor can scale how much scaffolding it
 * gives. Read server-side rather than trusted from the request.
 */
export function describeMemoryProfile(cardData: Record<string, unknown>) {
  const asNumber = (value: unknown) => (typeof value === "number" ? value : undefined);
  const difficulty = asNumber(cardData.difficulty);
  const reps = asNumber(cardData.reps) ?? 0;

  const difficultyLabel =
    difficulty === undefined
      ? "unknown"
      : difficulty >= 7
        ? "high"
        : difficulty >= 4
          ? "medium"
          : difficulty > 0
            ? "low"
            : "new";

  return `Memory profile:
- Difficulty: ${difficultyLabel}
- Times struggled: ${asNumber(cardData.lapses) ?? 0}
- Successful reps: ${reps}
- Current interval: ${asNumber(cardData.scheduledDays) ?? 0} day(s)
- Days since last review window: ${asNumber(cardData.elapsedDays) ?? 0}

If this profile looks shaky (hard card, repeated struggles, short review gaps), give more scaffolding, point out likely confusion, and prefer compact memory hooks. If it looks stable, keep the answer concise and avoid overexplaining.`;
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

export function countOverlap(left: readonly string[], right: readonly string[]) {
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

export function assertSnapshotMime(input: {
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
