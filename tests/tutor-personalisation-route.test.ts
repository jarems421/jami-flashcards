import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  writer: vi.fn(),
  set: vi.fn(),
  doc: vi.fn(),
}));

vi.mock("@/services/ai/assistant-assets.server", () => ({
  authenticateAssistantWriter: mocks.writer,
  authenticateAssistantAssetRequest: vi.fn(),
  assistantAssetError: (message: string, status: number, code: string) =>
    Response.json({ error: message, code }, { status }),
}));
vi.mock("@/services/firebase/admin", () => ({
  getAdminDb: () => ({ collection: () => ({ doc: mocks.doc }) }),
}));
vi.mock("@/lib/app/feature-flags", () => ({
  featureFlags: { enableTutorPersonalisation: true },
}));

const { PATCH } = await import("@/app/api/ai/assistant/personalisation/route");

function request(body: unknown) {
  return new NextRequest("https://jami.test/api/ai/assistant/personalisation", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writer.mockResolvedValue({ uid: "student-1", isDemo: false });
  mocks.doc.mockReturnValue({ set: mocks.set });
  mocks.set.mockResolvedValue(undefined);
});

describe("study profile writes", () => {
  it.each([null, [], 42, "invalid"])("rejects non-object body %j", async (body) => {
    expect((await PATCH(request(body))).status).toBe(400);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it.each([
    { studySubjects: [] },
    { studyLevel: "unknown", studySubjects: [] },
    { studyLevel: null },
    { studyLevel: null, studySubjects: [42] },
  ])("rejects incomplete or invalid profiles without clearing saved data", async (body) => {
    expect((await PATCH(request({ target: "study-profile", ...body }))).status).toBe(400);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("normalizes subjects and merges only into the authenticated user", async () => {
    const response = await PATCH(request({
      target: "study-profile", studyLevel: "post-16-equivalent",
      studySubjects: [" Physics ", "physics", "Chemistry"],
    }));
    expect(response.status).toBe(200);
    expect(mocks.doc).toHaveBeenCalledWith("student-1");
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({
      defaultStudyLevel: "post-16-equivalent", studySubjects: ["Physics", "Chemistry"],
    }), { merge: true });
  });

  it("allows an explicit clear", async () => {
    const response = await PATCH(request({ target: "study-profile", studyLevel: null, studySubjects: [] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ studyLevel: null, studySubjects: [] });
    expect(mocks.set).toHaveBeenCalled();
  });

  it.each([null, { uid: "demo", isDemo: true }])("blocks unauthenticated and demo writes", async (writer) => {
    mocks.writer.mockResolvedValue(writer);
    const response = await PATCH(request({ target: "study-profile", studyLevel: null, studySubjects: [] }));
    expect(response.status).toBe(writer ? 403 : 401);
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
