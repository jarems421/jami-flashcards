import { describe, expect, it } from "vitest";
import { sanitizeDownloadFileName } from "@/lib/app/download";

describe("download file names", () => {
  it("normalizes user-facing names for safe downloads", () => {
    expect(sanitizeDownloadFileName("  Cell biology: Unit 1  ")).toBe(
      "Cell-biology-Unit-1",
    );
  });

  it("uses the requested fallback when no safe characters remain", () => {
    expect(sanitizeDownloadFileName("***", "flashcards")).toBe("flashcards");
  });
});
