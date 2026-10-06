import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AiContentPart } from "@/lib/ai/content-parts";
import type { PreparedSource } from "@/lib/ai/source-ingestion";
import type { Source } from "@/lib/material/sources";

vi.mock("server-only", () => ({}));

let isBlockedSourceAddress: (address: string) => boolean;
let prepareSourceForTutor: (
  source: Source,
  loadStoredFile: (storagePath: string) => Promise<Buffer>,
  cacheNamespace: string
) => Promise<{
  sourceId: string;
  label: string;
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
  inputBytes: number;
}>;
let normalizePreparedTutorSourceForTextModel: (
  prepared: PreparedSource,
  extractEvidence: (parts: readonly AiContentPart[]) => Promise<string>
) => Promise<PreparedSource>;

// The module pulls in officeparser, mammoth, and cheerio — a cold import can
// take well over ten seconds on a slow disk, so give the hook extra room.
beforeAll(async () => {
  ({
    isBlockedSourceAddress,
    prepareSourceForTutor,
    normalizePreparedTutorSourceForTextModel,
  } = await import("@/lib/ai/source-ingestion"));
}, 120_000);

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
      loadStoredFile,
      "user-1"
    );

    expect(loadStoredFile).not.toHaveBeenCalled();
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
      async () => Buffer.from("image"),
      "user-1"
    );

    expect(result.parts[0]?.inlineData).toEqual({
      mimeType: "image/png",
      data: Buffer.from("image").toString("base64"),
    });
  });

  it("normalizes raw PDF/image parts to a bounded text-only evidence brief", async () => {
    const extractEvidence = vi.fn(async () => "  Page 2\n\nA labelled cell membrane.  ");
    const normalized = await normalizePreparedTutorSourceForTextModel(
      {
        sourceId: "source-scan",
        label: "Scanned paper",
        inputBytes: 1_000,
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: Buffer.from("private-pdf").toString("base64"),
            },
          },
        ],
      },
      extractEvidence
    );

    expect(extractEvidence).toHaveBeenCalledOnce();
    expect(normalized.parts).toEqual([
      { text: "Page 2\n\nA labelled cell membrane." },
    ]);
    expect(normalized.parts.some((part) => "inlineData" in part)).toBe(false);
  });

  it("isolates prepared-source cache entries by user", async () => {
    const baseSource: Source = {
      id: "shared-looking-id",
      title: "Notes",
      type: "manual_note",
      folderIds: [],
      topicIds: [],
      contentText: "Alice's private notes.",
      status: "active",
      createdBy: "alice",
      createdAt: 1,
      updatedAt: 10,
    };

    const alice = await prepareSourceForTutor(
      baseSource,
      async () => Buffer.alloc(0),
      "alice"
    );
    const bob = await prepareSourceForTutor(
      {
        ...baseSource,
        createdBy: "bob",
        contentText: "Bob's separate notes.",
      },
      async () => Buffer.alloc(0),
      "bob"
    );

    expect(alice.parts[0]?.text).toBe("Alice's private notes.");
    expect(bob.parts[0]?.text).toBe("Bob's separate notes.");
  });
});

describe("why a source could not be read", () => {
  const pdf: Source = {
    id: "source-pdf",
    title: "Past paper",
    type: "file",
    folderIds: [],
    topicIds: [],
    fileName: "paper.pdf",
    fileType: "application/pdf",
    storagePath: "users/user-1/sourceFiles/source-pdf/paper.pdf",
    status: "active",
    createdBy: "user-1",
    createdAt: 1,
    updatedAt: 1,
  };

  it("keeps a reason worded for the student", async () => {
    await expect(prepareSourceForTutor(pdf, async () => Buffer.alloc(0), "user-1")).rejects.toMatchObject({
      name: "SourceReadError",
      message: "The uploaded file is empty or too large.",
    });
  });

  it("does not pass a storage error's paths through, but keeps it as the cause", async () => {
    const storageError = new Error("No such object: jami-prod.appspot.com/users/user-1/sourceFiles/source-pdf/paper.pdf");
    const failure = await prepareSourceForTutor({ ...pdf, updatedAt: 2 }, async () => {
      throw storageError;
    }, "user-1").catch((error: unknown) => error);

    expect(failure).toMatchObject({ name: "SourceReadError", message: "This source could not be read." });
    expect(failure instanceof Error ? failure.cause : null).toBe(storageError);
  });

  it("does not pass a failed evidence brief's error through either", async () => {
    const failure = await normalizePreparedTutorSourceForTextModel(
      {
        sourceId: "source-scan",
        label: "Scanned paper",
        inputBytes: 10,
        parts: [{ inlineData: { mimeType: "application/pdf", data: "cGRm" } }],
      },
      async () => {
        throw Object.assign(new Error("provider overloaded"), { status: 503 });
      }
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({ name: "SourceReadError", message: "This source could not be read." });
  });
});
