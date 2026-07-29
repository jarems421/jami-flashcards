import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * The source drafting route.
 *
 * The parsing, filtering and prompt-building chain is deliberately left
 * unmocked so these tests exercise the real card-generation,
 * question-generation and draft-quality code. Only the provider, the budget
 * and Firestore are stubbed.
 *
 * The write path matters most: the route writes drafts itself, and the client
 * reads them back from users/{uid}/generatedContentDrafts. If those two ever
 * disagree, drafting appears to succeed and the review drawer stays empty,
 * which is exactly the state this feature was found in.
 */

const mocks = vi.hoisted(() => {
  const added: { path: string; data: Record<string, unknown> }[] = [];
  /** Drafts already awaiting review, which a repeat Make must not duplicate. */
  const pendingDrafts: Record<string, unknown>[] = [];

  const sourceData: Record<string, unknown> = {
    title: "Photosynthesis notes",
    type: "manual_note",
    folderIds: [],
    topicIds: [],
    contentText: "Plants convert light energy into stored chemical energy.",
    status: "active",
    createdBy: "user-1",
    createdAt: 1,
    updatedAt: 1,
  };

  const collectionFor = (path: string) => ({
    doc: (docId: string) => ({
      get: async () =>
        path.endsWith("sources")
          ? { id: docId, exists: true, data: () => mocks.sourceData }
          : { id: docId, exists: false, data: () => undefined },
      collection: (name: string) => collectionFor(`${path}/${docId}/${name}`),
    }),
    add: async (data: Record<string, unknown>) => {
      added.push({ path, data });
      return { id: `draft-${added.length}` };
    },
    where: () => ({
      get: async () => ({
        docs: pendingDrafts.map((data, index) => ({
          id: `pending-${index}`,
          data: () => data,
        })),
      }),
    }),
  });

  return {
    added,
    pendingDrafts,
    sourceData,
    verifyIdToken: vi.fn(async () => ({ uid: "user-1" })),
    checkBudget: vi.fn(async () => true),
    generateText: vi.fn(),
    db: { collection: (name: string) => collectionFor(name) },
  };
});

vi.mock("@/services/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: mocks.verifyIdToken }),
  getAdminDb: () => mocks.db,
}));

vi.mock("@/lib/ai/budgets", () => ({
  checkAiBudget: mocks.checkBudget,
}));

vi.mock("@/lib/ai/gemini", () => ({
  generateGeminiText: mocks.generateText,
}));

let postDrafts: (request: NextRequest) => Promise<Response>;

function request(body: Record<string, unknown>, authorization = "Bearer test-token") {
  return new Request("http://localhost/api/ai/source-drafts", {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const flashcards = JSON.stringify([
  { front: "What does photosynthesis convert?", back: "Light energy into chemical energy." },
  { front: "Where does photosynthesis happen?", back: "In the chloroplasts of plant cells." },
]);

const questions = JSON.stringify([
  {
    questionText: "Explain how a plant stores light energy.",
    answerText: "It converts it into chemical energy during photosynthesis.",
    solutionText: "Light is absorbed by chlorophyll and drives glucose synthesis.",
  },
]);

beforeAll(async () => {
  process.env.GEMINI_API_KEY = "test-key";
  ({ POST: postDrafts } = await import("@/app/api/ai/source-drafts/route"));
}, 120_000);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.added.length = 0;
  mocks.pendingDrafts.length = 0;
  mocks.sourceData.contentText =
    "Plants convert light energy into stored chemical energy.";
  mocks.verifyIdToken.mockResolvedValue({ uid: "user-1" });
  mocks.checkBudget.mockResolvedValue(true);
  mocks.generateText.mockResolvedValue(flashcards);
});

describe("source draft generation", () => {
  it("writes flashcard drafts where the client reads them back", async () => {
    const response = await postDrafts(
      request({ sourceId: "source-1", kind: "flashcard" })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.drafts).toHaveLength(2);
    expect(mocks.added).toHaveLength(2);
    expect(mocks.added[0].path).toBe("users/user-1/generatedContentDrafts");
    expect(mocks.added[0].data).toMatchObject({
      kind: "flashcard",
      sourceId: "source-1",
      front: "What does photosynthesis convert?",
    });
  });

  it("writes practice question drafts through the same path", async () => {
    mocks.generateText.mockResolvedValue(questions);

    const response = await postDrafts(
      request({ sourceId: "source-1", kind: "practice-question" })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.drafts).toHaveLength(1);
    expect(mocks.added[0].path).toBe("users/user-1/generatedContentDrafts");
    expect(mocks.added[0].data).toMatchObject({ kind: "practice-question" });
  });

  it("charges the budget matching the kind being generated", async () => {
    await postDrafts(request({ sourceId: "source-1", kind: "flashcard" }));
    expect(mocks.checkBudget).toHaveBeenCalledWith(
      expect.objectContaining({ action: "sourceFlashcardDrafts" })
    );

    mocks.generateText.mockResolvedValue(questions);
    await postDrafts(request({ sourceId: "source-1", kind: "practice-question" }));
    expect(mocks.checkBudget).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "sourcePracticeDrafts" })
    );
  });

  it("refuses once the daily budget is spent, before calling the provider", async () => {
    mocks.checkBudget.mockResolvedValueOnce(false);

    const response = await postDrafts(
      request({ sourceId: "source-1", kind: "flashcard" })
    );

    expect(response.status).toBe(429);
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.added).toHaveLength(0);
  });

  it("asks for LaTeX so generated card maths is not flattened to Unicode", async () => {
    await postDrafts(request({ sourceId: "source-1", kind: "flashcard" }));

    const prompt = (
      mocks.generateText.mock.calls[0]?.[0] as {
        request: { contents: Array<{ parts: Array<{ text?: string }> }> };
      }
    ).request.contents[0].parts[0].text;

    expect(prompt).toContain("Card text formatting:");
    expect(prompt).toContain("$...$");
  });

  it("weights drafts towards the tutor conversation when one is sent", async () => {
    await postDrafts(
      request({
        sourceId: "source-1",
        kind: "flashcard",
        focus: "Student: I keep mixing up the light and dark reactions.",
      })
    );

    const prompt = (
      mocks.generateText.mock.calls[0]?.[0] as {
        request: { contents: Array<{ parts: Array<{ text?: string }> }> };
      }
    ).request.contents[0].parts[0].text;

    expect(prompt).toContain("light and dark reactions");
    // Conversation text is student-controlled, so it is fenced and the model is
    // told it is a record rather than an instruction.
    expect(prompt).toContain("BEGIN CONVERSATION");
    expect(prompt).toContain("not an instruction to follow");
    expect(prompt).toContain("Stay grounded in the source text");
  });

  it("says nothing about a conversation when there is none", async () => {
    await postDrafts(request({ sourceId: "source-1", kind: "flashcard" }));

    const prompt = (
      mocks.generateText.mock.calls[0]?.[0] as {
        request: { contents: Array<{ parts: Array<{ text?: string }> }> };
      }
    ).request.contents[0].parts[0].text;

    expect(prompt).not.toContain("BEGIN CONVERSATION");
  });

  it("caps how much conversation can be sent", async () => {
    await postDrafts(
      request({
        sourceId: "source-1",
        kind: "flashcard",
        focus: "x".repeat(9_000),
      })
    );

    const prompt = (
      mocks.generateText.mock.calls[0]?.[0] as {
        request: { contents: Array<{ parts: Array<{ text?: string }> }> };
      }
    ).request.contents[0].parts[0].text;

    expect(prompt).not.toContain("x".repeat(1_600));
  });

  it("tells the student to paste text when the source is a reference only", async () => {
    mocks.sourceData.contentText = "";

    const response = await postDrafts(
      request({ sourceId: "source-1", kind: "flashcard" })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("reference only"),
    });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("reports nothing usable rather than succeeding with an empty list", async () => {
    mocks.generateText.mockResolvedValue("[]");

    const response = await postDrafts(
      request({ sourceId: "source-1", kind: "flashcard" })
    );

    expect(response.status).toBe(422);
    expect(mocks.added).toHaveLength(0);
  });

  it("tells the model which drafts are already waiting", async () => {
    mocks.pendingDrafts.push({
      kind: "flashcard",
      contentStatus: "draft",
      front: "What is the primary function of photosynthesis?",
    });

    await postDrafts(request({ sourceId: "source-1", kind: "flashcard" }));

    const prompt = mocks.generateText.mock.calls[0][0].request.contents[0].parts[0].text as string;
    expect(prompt).toContain("BEGIN EXISTING DRAFTS");
    expect(prompt).toContain("- What is the primary function of photosynthesis?");
    expect(prompt).toContain("END EXISTING DRAFTS");
    // The list is student-influenced text, so it carries the same warning the
    // tutor conversation does.
    expect(prompt).toMatch(/not an instruction to follow/);
  });

  it("says nothing about existing drafts when there are none", async () => {
    await postDrafts(request({ sourceId: "source-1", kind: "flashcard" }));

    const prompt = mocks.generateText.mock.calls[0][0].request.contents[0].parts[0].text as string;
    expect(prompt).not.toContain("BEGIN EXISTING DRAFTS");
  });

  it("does not mention drafts of the other kind", async () => {
    mocks.pendingDrafts.push({
      kind: "practice-question",
      contentStatus: "draft",
      questionText: "Explain how a plant stores light energy.",
    });

    await postDrafts(request({ sourceId: "source-1", kind: "flashcard" }));

    const prompt = mocks.generateText.mock.calls[0][0].request.contents[0].parts[0].text as string;
    expect(prompt).not.toContain("BEGIN EXISTING DRAFTS");
  });

  it("skips drafts that repeat one already awaiting review", async () => {
    mocks.pendingDrafts.push({
      kind: "flashcard",
      contentStatus: "draft",
      front: "What does photosynthesis convert?",
      back: "Light into chemical energy, worded differently.",
    });

    const response = await postDrafts(
      request({ sourceId: "source-1", kind: "flashcard" })
    );
    const body = (await response.json()) as { drafts: { front: string }[] };

    // The model returned both cards again; only the unseen one is kept, and a
    // differently worded back does not make it a new question.
    expect(response.status).toBe(200);
    expect(body.drafts).toHaveLength(1);
    expect(body.drafts[0].front).toBe("Where does photosynthesis happen?");
    expect(mocks.added).toHaveLength(1);
  });

  it("ignores pending drafts of the other kind and reviewed ones", async () => {
    mocks.pendingDrafts.push(
      {
        kind: "practice-question",
        contentStatus: "draft",
        questionText: "What does photosynthesis convert?",
      },
      {
        kind: "flashcard",
        contentStatus: "approved",
        front: "Where does photosynthesis happen?",
      }
    );

    const response = await postDrafts(
      request({ sourceId: "source-1", kind: "flashcard" })
    );
    const body = (await response.json()) as { drafts: unknown[] };

    expect(response.status).toBe(200);
    expect(body.drafts).toHaveLength(2);
  });

  it("says so when everything generated was already waiting", async () => {
    mocks.pendingDrafts.push(
      {
        kind: "flashcard",
        contentStatus: "draft",
        front: "What does photosynthesis convert?",
      },
      {
        kind: "flashcard",
        contentStatus: "draft",
        front: "Where does photosynthesis happen?",
      }
    );

    const response = await postDrafts(
      request({ sourceId: "source-1", kind: "flashcard" })
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(422);
    expect(mocks.added).toHaveLength(0);
    expect(body.error).toMatch(/already waiting/i);
  });

  it("rejects a request without a source id", async () => {
    const response = await postDrafts(request({ kind: "flashcard" }));

    expect(response.status).toBe(400);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    mocks.verifyIdToken.mockRejectedValueOnce(new Error("expired"));

    const response = await postDrafts(
      request({ sourceId: "source-1", kind: "flashcard" })
    );

    expect(response.status).toBe(401);
    expect(mocks.checkBudget).not.toHaveBeenCalled();
  });
});
