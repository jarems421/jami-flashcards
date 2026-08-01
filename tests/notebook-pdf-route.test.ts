import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  getBucket: vi.fn(),
  file: vi.fn(),
  getMetadata: vi.fn(),
  download: vi.fn(),
}));

vi.mock("@/services/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: mocks.verifyIdToken }),
  getAdminStorageBucket: mocks.getBucket,
}));

let getNotebookFile: (request: NextRequest) => Promise<Response>;

function request(path: string, token?: string) {
  return new NextRequest(
    `https://jami.test/api/notebook-files/pdf?path=${encodeURIComponent(path)}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }
  );
}

const ownedPath =
  "users/user-1/notebookFiles/notebook-1/file-1-paper.pdf";

beforeAll(async () => {
  ({ GET: getNotebookFile } = await import(
    "@/app/api/notebook-files/pdf/route"
  ));
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyIdToken.mockResolvedValue({ uid: "user-1" });
  mocks.getBucket.mockReturnValue({ file: mocks.file });
  mocks.file.mockReturnValue({
    getMetadata: mocks.getMetadata,
    download: mocks.download,
  });
  mocks.getMetadata.mockResolvedValue([
    { size: "4", contentType: "application/pdf" },
  ]);
  mocks.download.mockResolvedValue([Buffer.from([1, 2, 3, 4])]);
});

describe("notebook file proxy route", () => {
  it("requires a verified bearer token", async () => {
    expect((await getNotebookFile(request(ownedPath))).status).toBe(401);

    mocks.verifyIdToken.mockRejectedValueOnce(new Error("expired"));
    expect(
      (await getNotebookFile(request(ownedPath, "expired-token"))).status
    ).toBe(401);
    expect(mocks.getBucket).not.toHaveBeenCalled();
  });

  it("rejects another user's or a nested storage path before bucket access", async () => {
    const otherUser = await getNotebookFile(
      request("users/user-2/notebookFiles/notebook-1/file.pdf", "token")
    );
    const nested = await getNotebookFile(
      request(
        "users/user-1/notebookFiles/notebook-1/nested/file.pdf",
        "token"
      )
    );

    expect(otherUser.status).toBe(400);
    expect(nested.status).toBe(400);
    expect(mocks.getBucket).not.toHaveBeenCalled();
  });

  it("returns an owned file with bounded private response headers", async () => {
    const response = await getNotebookFile(request(ownedPath, "token"));

    expect(response.status).toBe(200);
    expect(mocks.file).toHaveBeenCalledWith(ownedPath);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4])
    );
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Length")).toBe("4");
    expect(response.headers.get("Cache-Control")).toContain("private");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("refuses unsupported types and invalid sizes before downloading", async () => {
    mocks.getMetadata.mockResolvedValueOnce([
      { size: "4", contentType: "text/html" },
    ]);
    expect(
      (await getNotebookFile(request(ownedPath, "token"))).status
    ).toBe(415);
    expect(mocks.download).not.toHaveBeenCalled();

    mocks.getMetadata.mockResolvedValueOnce([
      { size: String(20 * 1024 * 1024), contentType: "application/pdf" },
    ]);
    expect(
      (await getNotebookFile(request(ownedPath, "token"))).status
    ).toBe(413);
    expect(mocks.download).not.toHaveBeenCalled();

    mocks.getMetadata.mockResolvedValueOnce([
      { size: "4", contentType: "application/pdf" },
    ]);
    mocks.download.mockResolvedValueOnce([Buffer.alloc(20 * 1024 * 1024)]);
    expect(
      (await getNotebookFile(request(ownedPath, "token"))).status
    ).toBe(413);
  });

  it("maps a missing object to 404 and hides other storage errors", async () => {
    mocks.getMetadata.mockRejectedValueOnce({ code: 404 });
    const missing = await getNotebookFile(request(ownedPath, "token"));
    expect(missing.status).toBe(404);

    mocks.getMetadata.mockRejectedValueOnce(new Error("private provider detail"));
    const failed = await getNotebookFile(request(ownedPath, "token"));
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toEqual({
      error: "This notebook file could not be downloaded.",
    });
  });
});
