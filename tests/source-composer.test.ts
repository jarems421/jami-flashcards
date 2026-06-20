import { describe, expect, it } from "vitest";
import {
  buildSourceComposerContent,
  clearFilenameDerivedTitle,
  getSourceTitleFromFileName,
} from "@/lib/study/source-composer";

describe("source composer state", () => {
  it("derives a clean title from an uploaded filename", () => {
    expect(getSourceTitleFromFileName(" Biology notes.pdf ")).toBe(
      "Biology notes"
    );
  });

  it("clears only titles that still match the uploaded filename", () => {
    expect(clearFilenameDerivedTitle("notes", "notes")).toBe("");
    expect(clearFilenameDerivedTitle("My notes", "notes")).toBe("My notes");
  });

  it("submits only values belonging to the active mode", () => {
    const values = {
      contentText: "Study text",
      externalUrl: "https://example.com/",
      fileName: "notes.pdf",
      fileType: "application/pdf",
    };

    expect(buildSourceComposerContent("text", values)).toEqual({
      contentText: "Study text",
      externalUrl: undefined,
      fileName: undefined,
      fileType: undefined,
    });
    expect(buildSourceComposerContent("link", values)).toEqual({
      contentText: undefined,
      externalUrl: "https://example.com/",
      fileName: undefined,
      fileType: undefined,
    });
    expect(buildSourceComposerContent("upload", values)).toEqual({
      contentText: undefined,
      externalUrl: undefined,
      fileName: "notes.pdf",
      fileType: "application/pdf",
    });
  });
});
