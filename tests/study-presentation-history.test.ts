import { beforeEach, afterEach, expect, it, vi } from "vitest";
const remote = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/services/firebase/client", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join("/"),
  getDoc: async (ref: string) => ({ data: () => remote.get(ref) }),
  runTransaction: async (_db: unknown, run: (tx: unknown) => Promise<void>) => run({
    get: async (ref: string) => ({ data: () => remote.get(ref) }),
    set: (ref: string, value: unknown) => remote.set(ref, value),
  }),
}));
vi.mock("@/services/firebase/firestore", () => ({ withTimeout: (promise: Promise<unknown>) => promise }));
import { loadPresentationHistory, recordPresentation } from "@/services/study/presentation-history";
import { getCardContentHash } from "@/lib/study/study-modes";
import type { Card } from "@/lib/study/cards";
const card: Card = { id: "a", userId: "u", deckId: "d", front: "Speed?", back: "26 m/s", createdAt: 1, tags: [] };
beforeEach(() => {
  remote.clear();
  const local = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => local.get(key) ?? null, setItem: (key: string, value: string) => local.set(key, value), clear: () => local.clear() });
});
afterEach(() => vi.unstubAllGlobals());
it("remembers variants in a later session and on a second device, bounded to eight", async () => {
  for (let i = 0; i < 10; i++) await recordPresentation("u", card.id, { id: `attempt-${i}`, sourceHash: getCardContentHash(card), mode: "multiple-choice", variantId: `v${i}`, outcome: "correct", assisted: false, at: i });
  localStorage.clear();
  const history = await loadPresentationHistory("u", [card]);
  expect(history.variants.a).toEqual(["v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9"]);
  expect(history.outcomes.a).toHaveLength(5);
  expect((await loadPresentationHistory("other", [card])).variants.a).toEqual([]);
});
it("deduplicates the same presentation and ignores history from edited content", async () => {
  const entry = { id: "attempt", sourceHash: getCardContentHash(card), mode: "gap-fill" as const, variantId: "gap1", outcome: "correct" as const, assisted: true, at: 1 };
  await recordPresentation("u", card.id, entry);
  await recordPresentation("u", card.id, entry);
  const history = await loadPresentationHistory("u", [card]);
  expect(history.variants.a).toEqual(["gap1"]);
  expect(history.outcomes.a).toEqual([]);
  expect((await loadPresentationHistory("u", [{ ...card, back: "30 m/s" }])).variants.a).toEqual([]);
});
