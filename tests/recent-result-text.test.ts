import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningRecentResult } from "@/lib/learning/types";

const mocks = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  reads: [] as string[],
}));

vi.mock("@/services/firebase/admin", () => {
  const ref = (path: string) => ({
    path,
    collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
  });
  return {
    getAdminDb: () => ({
      collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
      getAll: async (...refs: Array<{ path: string }>) =>
        refs.map(({ path }) => {
          mocks.reads.push(path);
          const data = mocks.docs.get(path);
          return { id: path.split("/").at(-1), exists: data !== undefined, data: () => data };
        }),
    }),
  };
});

const { loadRecentResultText } = await import("@/services/learning/recent-result-text.server");

function result(kind: LearningRecentResult["kind"], itemId: string): LearningRecentResult {
  return { kind, itemId, outcome: "missed", score: 0, at: 1, attempts: 1, misses: 1, missedErrors: [] };
}

beforeEach(() => {
  mocks.docs.clear();
  mocks.reads.length = 0;
});

describe("the words of recent items", () => {
  it("shows the front of the student's own cards, never the back and never another student's", async () => {
    mocks.docs.set("cards/mine", { userId: "u1", front: "What is  the limiting reagent?", back: "The answer" });
    mocks.docs.set("cards/theirs", { userId: "u2", front: "Someone else's card" });

    const text = await loadRecentResultText("u1", [result("flashcards", "card:mine"), result("flashcards", "card:theirs")]);

    expect(text).toEqual(new Map([["card:mine", "What is the limiting reagent?"]]));
  });

  it("shows a practice paper's own question, and never reads a licensed past paper", async () => {
    mocks.docs.set("users/u1/pastPapers/p1", {
      questions: [{ id: "q2", label: "2", prompt: "Calculate the moles in 5 g of NaCl.", marks: 3 }],
    });

    const text = await loadRecentResultText("u1", [
      result("practice", "paper:p1:q2"),
      result("past-paper", "exam:licensed-question"),
    ]);

    expect(text.get("paper:p1:q2")).toBe("Calculate the moles in 5 g of NaCl.");
    expect(mocks.reads.some((path) => path.includes("licensed"))).toBe(false);
  });

  it("reads nothing when there is nothing to name", async () => {
    expect(await loadRecentResultText("u1", [result("notebook", "notebook:page")])).toEqual(new Map());
    expect(mocks.reads).toEqual([]);
  });
});
