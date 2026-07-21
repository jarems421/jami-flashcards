import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const editorSource = readFileSync(
  join(process.cwd(), "components/workspace/NotebookInkEditor.tsx"),
  "utf8"
);

describe("notebook ink viewport integration", () => {
  it("suppresses js-draw's internal export boundary on every rerender", () => {
    expect(editorSource).toContain(
      "const rerenderWithoutExportBounds = editor.rerender.bind(editor)"
    );
    expect(editorSource).toContain("editor.rerender = syncViewport");
    expect(editorSource).toContain("rerenderWithoutExportBounds(false)");
  });

  it("updates screen geometry and scale before repainting resized ink", () => {
    const syncStart = editorSource.indexOf("const syncViewport = () =>");
    const syncEnd = editorSource.indexOf(
      "editor.rerender = syncViewport",
      syncStart
    );
    const syncSource = editorSource.slice(syncStart, syncEnd);
    const updateScreen = syncSource.indexOf("viewport.updateScreenSize");
    const resetTransform = syncSource.indexOf("viewport.resetTransform");
    const repaint = syncSource.indexOf("rerenderWithoutExportBounds(false)");

    expect(syncStart).toBeGreaterThanOrEqual(0);
    expect(syncEnd).toBeGreaterThan(syncStart);
    expect(updateScreen).toBeGreaterThanOrEqual(0);
    expect(resetTransform).toBeGreaterThan(updateScreen);
    expect(repaint).toBeGreaterThan(resetTransform);
  });
});
