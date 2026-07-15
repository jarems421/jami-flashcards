import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Source } from "@/lib/practice/sources";

vi.mock("server-only", () => ({}));

let isBlockedSourceAddress: (address: string) => boolean;
let normalizeSourceTutorIds: (values: unknown[]) => string[];
let prepareSourceForTutor: (
  source: Source,
  loadStoredFile: (storagePath: string) => Promise<Buffer>
) => Promise<{
  sourceId: string;
  label: string;
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
  inputBytes: number;
}>;

// The module pulls in officeparser, mammoth, and cheerio — a cold import can
// take well over ten seconds on a slow disk, so give the hook extra room.
beforeAll(async () => {
  ({ isBlockedSourceAddress, normalizeSourceTutorIds, prepareSourceForTutor } =
    await import("@/lib/ai/source-ingestion"));
}, 45_000);

describe("source Tutor network protection", () => {
  it("blocks private and loopback addresses", () => {
    expect(isBlockedSourceAddress("127.0.0.1")).toBe(true);
    expect(isBlockedSourceAddress("10.0.0.4")).toBe(true);
    expect(isBlockedSourceAddress("172.20.1.2")).toBe(true);
    expect(isBlockedSourceAddress("192.168.1.20")).toBe(true);
    expect(isBlockedSourceAddress("::1")).toBe(true);
    expect(isBlockedSourceAddress("fd00::1")).toBe(true);
    expect(isBlockedSourceAddress("::ffff:192.168.1.5")).toBe(true);
  });

  it("allows public addresses", () => {
    expect(isBlockedSourceAddress("8.8.8.8")).toBe(false);
    expect(isBlockedSourceAddress("1.1.1.1")).toBe(false);
    expect(isBlockedSourceAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("normalizes and deduplicates selected source ids", () => {
    expect(
      normalizeSourceTutorIds([" source-a ", "source-a", "", 2, "source-b"])
    ).toEqual(["source-a", "source-b"]);
  });

  it("prepares saved text without loading a file", async () => {
    const loadStoredFile = vi.fn();
    const result = await prepareSourceForTutor(
      {
        id: "source-text",
        title: "Biology notes",
        type: "manual_note",
        folderIds: [],
        topicIds: [],
        contentText: "Plants use light energy.",
        status: "active",
        createdBy: "user-1",
        createdAt: 1,
        updatedAt: 1,
      },
      loadStoredFile
    );

    expect(loadStoredFile).not.toHaveBeenCalled();
    expect(result.parts[0]?.text).toContain("[Source: Biology notes]");
    expect(result.parts[0]?.text).toContain("Plants use light energy.");
  });

  it("prepares images as bounded multimodal input", async () => {
    const result = await prepareSourceForTutor(
      {
        id: "source-image",
        title: "Cell diagram",
        type: "file",
        folderIds: [],
        topicIds: [],
        fileName: "cell.png",
        fileType: "image/png",
        storagePath: "users/user-1/sourceFiles/source-image/cell.png",
        status: "active",
        createdBy: "user-1",
        createdAt: 1,
        updatedAt: 1,
      },
      async () => Buffer.from("image")
    );

    expect(result.parts[1]?.inlineData).toEqual({
      mimeType: "image/png",
      data: Buffer.from("image").toString("base64"),
    });
  });
});
