import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { ExamQuestion, ExamSession } from "@/lib/practice/exam-questions";
import type { PracticePaperQuestionAsset } from "@/lib/practice/practice-papers";
import { candidateExamAssets } from "@/lib/practice/exam-assets";
import { projectExamSession, projectExamSessionQuestion } from "@/lib/practice/exam-projections";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), get: vi.fn(), load: vi.fn(), download: vi.fn(), file: vi.fn(),
}));
vi.mock("@/services/auth/authenticate-request.server", () => ({
  authenticateRequest: mocks.auth,
  apiFailure: (error: string, status: number) => Response.json({ error }, { status }),
}));
vi.mock("@/lib/app/feature-flags", () => ({ featureFlags: { enablePastPaperPractice: true } }));
vi.mock("@/services/practice/exam-evidence.server", () => ({ loadServableExamQuestion: mocks.load }));
vi.mock("@/services/firebase/admin", () => ({
  getAdminDb: () => {
    const ref = { collection: () => ref, doc: () => ref, get: mocks.get };
    return ref;
  },
  getAdminStorageBucket: () => ({ file: mocks.file }),
}));
const { GET } = await import("@/app/api/practice/exam-sessions/[sessionId]/assets/[questionId]/[assetId]/route");

function asset(id: string): PracticePaperQuestionAsset {
  return { id, type: "image", title: id, content: "", altText: id,
    storagePath: `internal/examQuestionBank/${id}.png`, mimeType: "image/png" };
}
const image = asset("question-extract");
const scheme = asset("scheme-extract");
const privateImage = asset("review-only");
function question() {
  return { id: "q1", assets: [image, scheme, privateImage], reviewAssets: [privateImage] } as ExamQuestion;
}
function request(assetId: string) {
  return GET({} as NextRequest, {
    params: Promise.resolve({ sessionId: "s1", questionId: "q1", assetId }),
  });
}

describe("exam candidate asset boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue("student");
    // A legacy session already contains the leaked scheme ID.
    mocks.get.mockResolvedValue({ exists: true, data: () => ({ questions: [question()] }) });
    mocks.load.mockResolvedValue(question());
    mocks.file.mockReturnValue({ download: mocks.download });
    mocks.download.mockResolvedValue([Buffer.from("image")]);
  });

  it("projects only candidate assets and removes private storage paths", () => {
    const projected = projectExamSessionQuestion(question(), "attempt1");
    expect(projected.assets.map((item) => item.id)).toEqual([image.id]);
    expect(projected.assets[0]).not.toHaveProperty("storagePath");
    expect(projected).not.toHaveProperty("reviewAssets");
  });

  it("sanitises legacy persisted sessions without mutating them", () => {
    const old = { questions: [{ ...question(), attemptId: "attempt1" }] } as unknown as ExamSession;
    expect(projectExamSession(old).questions[0].assets.map((item) => item.id)).toEqual([image.id]);
    expect(old.questions[0].assets).toHaveLength(3);
  });

  it("retains ordinary assets for legacy and generated questions", () => {
    expect(candidateExamAssets({ assets: [image] })).toEqual([image]);
  });

  it.each(["scheme-extract", "review-only", "unknown"])("denies direct access to %s without reading bytes", async (id) => {
    expect((await request(id)).status).toBe(404);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("still serves an authorised question image with private caching", async () => {
    const response = await request(image.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe("image");
  });

  it("denies unauthenticated and cross-user access", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    expect((await request(image.id)).status).toBe(401);
    mocks.get.mockResolvedValueOnce({ exists: false, data: () => undefined });
    expect((await request(image.id)).status).toBe(404);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("honours question withdrawal and rights revocation", async () => {
    mocks.load.mockRejectedValueOnce(new Error("question_unavailable"));
    expect((await request(image.id)).status).toBe(404);
    expect(mocks.download).not.toHaveBeenCalled();
  });
});
