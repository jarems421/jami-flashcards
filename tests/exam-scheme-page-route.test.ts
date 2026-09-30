import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { schemePageRevealsUnanswered } from "@/lib/practice/exam-assets";

/**
 * The printed mark-scheme page, and what else is printed on it.
 *
 * One page of a board's scheme carries several questions. Serving it for a
 * marked question must not hand over the scheme for a question from the same
 * paper that is still waiting in the session.
 */

const docs = new Map<string, Record<string, unknown>>();
const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), download: vi.fn() }));

function ref(path: string) {
  return {
    path,
    collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
    get: async () => ({ data: () => docs.get(path) }),
  };
}

vi.mock("@/services/auth/authenticate-request.server", () => ({
  authenticateRequest: mocks.auth,
  apiFailure: (error: string, status: number) => Response.json({ error }, { status }),
}));
vi.mock("@/lib/app/feature-flags", () => ({ featureFlags: { enablePastPaperPractice: true } }));
vi.mock("@/services/practice/exam-evidence.server", () => ({ loadServableExamQuestion: mocks.load }));
vi.mock("@/services/firebase/admin", () => ({
  getAdminDb: () => ({
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    getAll: async (...refs: { path: string }[]) =>
      refs.map((entry) => ({ data: () => docs.get(entry.path) })),
  }),
  getAdminStorageBucket: () => ({ file: () => ({ download: mocks.download }) }),
}));

const { GET } = await import("@/app/api/practice/exam-sessions/[sessionId]/scheme/[attemptId]/route");

const USER = "users/u1";
const marked = (questionId: string) => ({
  sessionId: "s1",
  questionId,
  status: "marked",
  result: { attempted: true },
});

function sessionWith(questions: { id: string; attemptId: string; origin?: string }[]) {
  docs.set(`${USER}/examSessions/s1`, {
    questions: questions.map((question) => ({
      origin: "official_past_paper",
      contentVersion: "v1",
      ...question,
    })),
  });
}

function request() {
  return GET({} as NextRequest, { params: Promise.resolve({ sessionId: "s1", attemptId: "a1" }) });
}

beforeEach(() => {
  docs.clear();
  mocks.auth.mockReset().mockResolvedValue("u1");
  mocks.download.mockReset().mockResolvedValue([Buffer.from("png")]);
  mocks.load.mockReset().mockResolvedValue({
    id: "q1",
    paperId: "paper-1",
    assets: [],
    reviewAssets: [
      {
        id: "scheme-extract",
        type: "image",
        title: "Official mark scheme page",
        content: "",
        altText: "",
        storagePath: "internal/examQuestionBank/aqa/paper-1/q1-v1-scheme.png",
        mimeType: "image/png",
      },
    ],
  });
  docs.set(`${USER}/examAttempts/a1`, marked("q1"));
  docs.set("examQuestions/q1", { paperId: "paper-1" });
  docs.set("examQuestions/q2", { paperId: "paper-1" });
  docs.set("examQuestions/q3", { paperId: "paper-2" });
});

describe("the printed scheme page", () => {
  it("serves the page when nothing else from the paper is waiting", async () => {
    sessionWith([
      { id: "q1", attemptId: "a1" },
      { id: "q3", attemptId: "a3" },
    ]);
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("holds it back while a question from the same paper is unanswered", async () => {
    sessionWith([
      { id: "q1", attemptId: "a1" },
      { id: "q2", attemptId: "a2" },
    ]);
    const response = await request();
    expect(response.status).toBe(404);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("releases it once that question has been marked", async () => {
    sessionWith([
      { id: "q1", attemptId: "a1" },
      { id: "q2", attemptId: "a2" },
    ]);
    docs.set(`${USER}/examAttempts/a2`, marked("q2"));
    expect((await request()).status).toBe(200);
  });

  it("does not wait on questions Jami wrote, which have no printed page", async () => {
    sessionWith([
      { id: "q1", attemptId: "a1" },
      { id: "g1", attemptId: "ag", origin: "jami_generated" },
    ]);
    expect((await request()).status).toBe(200);
  });
});

describe("the rule", () => {
  it("waits only on unanswered questions from the same paper", () => {
    expect(
      schemePageRevealsUnanswered({
        paperId: "p",
        siblings: [
          { paperId: "p", unlocked: true },
          { paperId: "other", unlocked: false },
          { unlocked: false },
        ],
      })
    ).toBe(false);
    expect(
      schemePageRevealsUnanswered({ paperId: "p", siblings: [{ paperId: "p", unlocked: false }] })
    ).toBe(true);
  });
});
