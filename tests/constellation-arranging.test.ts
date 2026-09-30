import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = [
  "app/dashboard/constellation/page.tsx",
  "components/constellation/ConstellationControls.tsx",
  // The line-drawing and arranging behaviour these tests protect lives in the
  // page's own controllers; they are read with it so a rule cannot be lost by
  // moving the code that carries it out of the page file.
  "hooks/useConstellationLineEditing.ts",
  "hooks/useSkyPattern.ts",
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

  /*
   * A star swallows its own pointerdown, which also stops the browser sending
   * the mouse events after it. Listening for mouseup left a star stuck to the
   * cursor on a computer until a click somewhere else.
   */
  it("moves and drops a star on pointer events, which a pressed star still receives", () => {
    expect(pageSource).not.toContain('"mouseup"');
    expect(pageSource).not.toContain('"mousemove"');
    expect(pageSource).toContain('window.addEventListener("pointermove", handleMove)');
    expect(pageSource).toContain("event.buttons === 0");
  });

  // Dragging a star downward used to count as pull-to-refresh and slide the page.
  it("keeps pull-to-refresh out of the sky", () => {
    expect(pageSource).toContain("data-no-pull-refresh");
    const refreshable = readFileSync(path.join(process.cwd(), "components/layout/Refreshable.tsx"), "utf8");
    expect(refreshable).toContain('closest("[data-no-pull-refresh]")');
  });

  /*
   * The scroll lock hid the desktop scrollbar, so the page widened and the sky
   * zoomed in a little whenever a star was clicked. A mouse never needed it.
   */
  it("locks page scrolling for a finger or pen, never for a mouse", () => {
    expect(pageSource).toContain('active && pointerType !== "mouse"');
    expect(pageSource).toContain("setStarGesture(true, pointerType)");
    const star = readFileSync(path.join(process.cwd(), "components/constellation/ConstellationStar.tsx"), "utf8");
    expect(star).toContain("onDragStart(event.pointerType)");
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
    expect(pageSource).toContain("const [redoHistory, setRedoHistory]");
    expect(pageSource).toContain("const redoLine");
    expect(pageSource).toContain("current.lines.slice(0, -1)");
    expect(pageSource).toContain(
      'setRedoHistory({ constellationId: "", lines: [] })'
    );
  });
});
