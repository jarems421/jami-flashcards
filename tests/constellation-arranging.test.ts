import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = [
  "app/dashboard/constellation/page.tsx",
  "components/constellation/ConstellationControls.tsx",
]
  .map((file) => readFileSync(path.join(process.cwd(), file), "utf8"))
  .join("\n");

/**
 * Finishing a constellation seals what is in it, not how it is arranged.
 *
 * One flag used to mean both. `canEditSelectedConstellation` was
 * `status === "active"`, and it gated dragging and keyboard nudging, so
 * finishing a sky turned it "View only" and the student lost the placement of
 * every star they had arranged. A finished sky is the one they will keep
 * looking at, which makes it the last thing that should be frozen.
 *
 * This reads the page's source rather than rendering it because the rule worth
 * protecting is that no status check sits on the arranging path at all. A test
 * that drove the UI would pass just as happily if someone reintroduced the gate
 * somewhere the test did not click.
 */
describe("arranging a finished constellation", () => {
  it("does not gate arranging on the constellation being active", () => {
    expect(pageSource).toContain("const canArrangeSelectedConstellation");
    expect(pageSource).not.toContain("canEditSelectedConstellation");

    const declaration = pageSource.slice(
      pageSource.indexOf("const canArrangeSelectedConstellation")
    );
    const firstLine = declaration.slice(0, declaration.indexOf(";"));
    expect(firstLine).not.toContain("status");
    expect(firstLine).not.toContain("active");
  });

  it("still passes both movement handlers to the star", () => {
    expect(pageSource).toContain("onDragStart");
    expect(pageSource).toContain("onNudge");
  });

  it("keeps the sky from turning a star gesture into page scrolling", () => {
    expect(pageSource).toContain('w-full touch-none select-none');
    expect(pageSource).not.toContain("sm:touch-none");
  });

  it("no longer marks any sky as view only", () => {
    expect(pageSource).not.toContain("View only");
  });

  it("uses compact accessible controls for undo, redo, and clear", () => {
    expect(pageSource).toContain('role="toolbar"');
    expect(pageSource).toContain('label="Undo last line"');
    expect(pageSource).toContain('label="Restore last undone line"');
    expect(pageSource).toContain('label="Clear all lines"');
    expect(pageSource).not.toContain(">Undo line<");
    expect(pageSource).not.toContain(">Clear lines<");
  });

  it("keeps undone lines available to restore until the drawing changes", () => {
    expect(pageSource).toContain("const [lineRedoHistory, setLineRedoHistory]");
    expect(pageSource).toContain("const handleRedoLine");
    expect(pageSource).toContain("current.lines.slice(0, -1)");
    expect(pageSource).toContain(
      'setLineRedoHistory({ constellationId: "", lines: [] })'
    );
  });
});
