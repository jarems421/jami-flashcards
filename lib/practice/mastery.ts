export type MasteryEventSourceType = "card" | "notebook" | "source" | "tutor" | "manual";
export type MasteryEventWeight = "high" | "medium" | "low" | "neutral" | "negative";

export const MASTERY_ALGORITHM_VERSION = "mvp-2026-05-23";

export type MasteryEvent = {
  id: string;
  topicId: string;
  sourceType: MasteryEventSourceType;
  sourceId?: string;
  weight: MasteryEventWeight;
  scoreDelta?: number;
  reason: string;
  algorithmVersion: string;
  createdAt: number;
};

export function getMasteryScoreDelta(weight: MasteryEventWeight) {
  if (weight === "high") return 4;
  if (weight === "medium") return 2;
  if (weight === "low") return 1;
  if (weight === "negative") return -2;
  return 0;
}

export function mapMasteryEventData(id: string, data: Record<string, unknown>): MasteryEvent {
  const weight =
    data.weight === "high" ||
    data.weight === "medium" ||
    data.weight === "low" ||
    data.weight === "neutral" ||
    data.weight === "negative"
      ? data.weight
      : "neutral";
  const sourceType =
    data.sourceType === "card" ||
    data.sourceType === "notebook" ||
    data.sourceType === "source" ||
    data.sourceType === "tutor" ||
    data.sourceType === "manual"
      ? data.sourceType
      : "manual";

  return {
    id,
    topicId: typeof data.topicId === "string" ? data.topicId : "",
    sourceType,
    sourceId: typeof data.sourceId === "string" ? data.sourceId : undefined,
    weight,
    scoreDelta: typeof data.scoreDelta === "number" ? data.scoreDelta : undefined,
    reason: typeof data.reason === "string" ? data.reason : "",
    algorithmVersion:
      typeof data.algorithmVersion === "string" ? data.algorithmVersion : "unknown",
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
  };
}
