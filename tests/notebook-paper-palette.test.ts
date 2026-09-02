import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getNotebookPaperPalette,
  getNotebookRuleColor,
  NOTEBOOK_PAGE_COLORS,
} from "@/lib/workspace/notebook-paper-palette";
import { isNotebookPageColor } from "@/lib/workspace/notebooks";

/**
 * Paper used to be decided in fifteen places, all written as "black, or else
 * white".
 *
 * That made a third colour impossible without finding every one of them, and
 * they had already drifted apart -- the page painted black paper #080a10 while
 * the card beside it painted #0b1020. These tests are mostly about the drift
 * not coming back: one source for the colours, and nothing branching on the
 * name of a colour when what it means is "is this paper dark".
 */
describe("notebook paper", () => {
  it("offers every colour the type allows, and only those", () => {
    for (const color of NOTEBOOK_PAGE_COLORS) {
      expect(isNotebookPageColor(color)).toBe(true);
    }
    expect(NOTEBOOK_PAGE_COLORS).toContain("white");
    expect(NOTEBOOK_PAGE_COLORS).toContain("cream");
    expect(NOTEBOOK_PAGE_COLORS).toContain("black");
  });

  it("gives every paper a full palette", () => {
    for (const color of NOTEBOOK_PAGE_COLORS) {
      const palette = getNotebookPaperPalette(color);
      expect(palette.paper).toMatch(/^#[0-9a-f]{6}$/i);
      expect(palette.line).toMatch(/^#[0-9a-f]{6}$/i);
      expect(palette.ink).toMatch(/^#[0-9a-f]{6}$/i);
      expect(palette.label.length).toBeGreaterThan(0);
      expect(typeof palette.isDark).toBe("boolean");
    }
  });

  it("marks only the dark papers dark", () => {
    expect(getNotebookPaperPalette("black").isDark).toBe(true);
    expect(getNotebookPaperPalette("white").isDark).toBe(false);
    // The one that matters: cream is light, so everything keyed off isDark
    // treats it like white without having been told about it.
    expect(getNotebookPaperPalette("cream").isDark).toBe(false);
  });

  it("keeps ink readable on its own paper", () => {
    // Not a contrast-ratio check, just the direction: light paper takes dark
    // ink and dark paper takes light ink. A palette row that got this backwards
    // would write invisibly.
    const luminance = (hex: string) =>
      [1, 3, 5]
        .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
        .reduce((sum, channel) => sum + channel, 0) / 3;

    for (const color of NOTEBOOK_PAGE_COLORS) {
      const { paper, ink, isDark } = getNotebookPaperPalette(color);
      expect(isDark ? luminance(ink) > luminance(paper) : luminance(ink) < luminance(paper)).toBe(
        true
      );
    }
  });

  it("falls back to white for a page that has no colour yet", () => {
    expect(getNotebookPaperPalette(undefined)).toEqual(
      getNotebookPaperPalette("white")
    );
  });

  describe("rule colour", () => {
    it("folds the opacity into the line colour", () => {
      expect(getNotebookRuleColor("white", 0.14)).toBe("rgba(30, 41, 59, 0.14)");
    });

    it("clamps an opacity outside the range rather than emitting nonsense", () => {
      expect(getNotebookRuleColor("white", 5)).toContain(", 1)");
      expect(getNotebookRuleColor("white", -2)).toContain(", 0)");
    });
  });

  /*
   * The point of the palette is that nothing else decides this. A new branch on
   * a colour's name is how the fifteen happened, and it would silently treat
   * cream -- and any paper added later -- as white.
   */
  it("is the only place that decides what a page colour means", () => {
    const root = join(__dirname, "..");
    const files = [
      "lib/workspace/notebook-page-content.ts",
      "lib/workspace/notebook-page-snapshot.ts",
      "components/workspace/NotebookObjectCard.tsx",
      "components/workspace/NotebookPageThumbnail.tsx",
      "components/workspace/NotebookPageStaticContent.tsx",
      "components/workspace/NotebookTextBlockLayer.tsx",
      "app/dashboard/notebooks/[notebookId]/page.tsx",
    ];

    for (const file of files) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source).not.toContain('pageColor === "black"');
      expect(source).not.toContain('pageColor === "white"');
    }
  });
});
