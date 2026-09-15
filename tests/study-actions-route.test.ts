import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The study-actions endpoint: signed-in students only, and a clean failure when the engine cannot answer. */

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  loadStudyActions: vi.fn(),
}));

vi.mock("@/services/auth/authenticate-request.server", () => ({
  authenticateRequest: mocks.authenticateRequest,
  apiFailure: (error: string, status: number, code: string) => Response.json({ error, code }, { status }),
}));
vi.mock("@/services/learning/study-actions.server", () => ({
  loadStudyActions: mocks.loadStudyActions,
}));

const { GET } = await import("@/app/api/learning/study-actions/route");

function request() {
  return new NextRequest("http://localhost/api/learning/study-actions");
}

beforeEach(() => {
  mocks.authenticateRequest.mockReset();
  mocks.loadStudyActions.mockReset();
});

describe("GET /api/learning/study-actions", () => {
  it("refuses a request without a signed-in student", async () => {
    mocks.authenticateRequest.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(mocks.loadStudyActions).not.toHaveBeenCalled();
  });

  it("returns the student's own study actions", async () => {
    mocks.authenticateRequest.mockResolvedValue("user-1");
    mocks.loadStudyActions.mockResolvedValue({
      actions: [],
      folders: [{ id: "folder-1", name: "Maths" }],
      evaluatedFolders: 1,
      failedFolders: 0,
      generatedAt: 1,
    });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.loadStudyActions).toHaveBeenCalledWith({ uid: "user-1" });
    await expect(response.json()).resolves.toMatchObject({ folders: [{ id: "folder-1" }] });
  });

  it("fails cleanly when the engine cannot answer", async () => {
    mocks.authenticateRequest.mockResolvedValue("user-1");
    mocks.loadStudyActions.mockRejectedValue(new Error("DEADLINE_EXCEEDED"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "study_actions_unavailable" });
  });
});
