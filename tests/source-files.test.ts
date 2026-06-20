import { describe, expect, it } from "vitest";
import {
  MAX_SOURCE_FILE_SIZE,
  getSourceFileKind,
  getSourceFileTypeLabel,
  resolveSourceFileMimeType,
  validateSourceFile,
} from "@/lib/practice/source-files";

describe("Library source files", () => {
  it("classifies supported study files", () => {
    expect(getSourceFileKind("image/png")).toBe("image");
    expect(getSourceFileKind("application/pdf")).toBe("pdf");
    expect(
      getSourceFileKind(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      )
    ).toBe("document");
    expect(
      getSourceFileKind(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      )
    ).toBe("document");
    expect(getSourceFileKind("text/plain")).toBe("text");
    expect(getSourceFileKind("application/javascript")).toBeNull();
  });

  it("provides student-facing file labels", () => {
    expect(getSourceFileTypeLabel("application/pdf")).toBe("PDF");
    expect(
      getSourceFileTypeLabel(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      )
    ).toBe("PowerPoint");
  });

  it("infers a supported type only when the browser omits it", () => {
    expect(resolveSourceFileMimeType("lecture.pptx", "")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
    expect(resolveSourceFileMimeType("photo.png", "application/octet-stream")).toBeNull();
  });

  it("rejects unsupported, empty, and oversized files", () => {
    expect(() => validateSourceFile({ type: "application/pdf", size: 1 })).not.toThrow();
    expect(() =>
      validateSourceFile({ type: "application/javascript", size: 10 })
    ).toThrow("This file type is not supported.");
    expect(() => validateSourceFile({ type: "text/plain", size: 0 })).toThrow(
      "not empty"
    );
    expect(() =>
      validateSourceFile({
        type: "application/pdf",
        size: MAX_SOURCE_FILE_SIZE,
      })
    ).toThrow("under 20 MB");
  });
});
