export type ContentOrigin =
  | "user-authored"
  | "ai-assisted"
  | "source-derived"
  | "imported";

export type ContentStatus = "draft" | "approved" | "rejected" | "archived";

export type ContentProvenance = {
  origin: ContentOrigin;
  contentStatus: ContentStatus;
  reviewedAt?: number;
  reviewedBy?: string;
};

export function isContentOrigin(value: unknown): value is ContentOrigin {
  return (
    value === "user-authored" ||
    value === "ai-assisted" ||
    value === "source-derived" ||
    value === "imported"
  );
}

export function isContentStatus(value: unknown): value is ContentStatus {
  return value === "draft" || value === "approved" || value === "rejected" || value === "archived";
}

export function normalizeOptionalString(value: unknown, maxLength = 10_000) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

export function normalizeStringArray(value: unknown, maxItems = 20, maxLength = 120) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const next = entry.trim().slice(0, maxLength);
    const key = next.toLowerCase();
    if (!next || seen.has(key)) continue;
    seen.add(key);
    normalized.push(next);
    if (normalized.length >= maxItems) break;
  }

  return normalized;
}
