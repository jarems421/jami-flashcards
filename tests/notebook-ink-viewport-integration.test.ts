import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const editorSource = readFileSync(
  join(process.cwd(), "components/workspace/NotebookInkEditor.tsx"),
  "utf8"
);
const notebookPageSource = readFileSync(
  join(process.cwd(), "app/dashboard/notebooks/[notebookId]/page.tsx"),
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

  it("installs native ink guards before the first writable page is painted", () => {
    const guardStart = editorSource.indexOf(
      "const suppressNativePenGesture = (event: PointerEvent)"
    );
    const guardEffectStart = editorSource.lastIndexOf(
      "useLayoutEffect(() =>",
      guardStart
    );

    expect(guardStart).toBeGreaterThanOrEqual(0);
    expect(guardEffectStart).toBeGreaterThanOrEqual(0);
    expect(editorSource.slice(guardEffectStart, guardStart)).toContain(
      "const surface = inkSurfaceRef.current"
    );
  });

  it("retries the iPad touch guard when the initially unmeasured sheet mounts", () => {
    const readiness = notebookPageSource.indexOf(
      "const pageSurfaceReady = Boolean(selectedPage?.id && pageFit.width > 0)"
    );
    const guardStart = notebookPageSource.indexOf(
      "const isStylusTouchEvent = (event: TouchEvent)",
      readiness
    );
    const guardEnd = notebookPageSource.indexOf(
      "}, [pageSurfaceReady, selectedPage?.id]);",
      guardStart
    );

    expect(readiness).toBeGreaterThanOrEqual(0);
    expect(guardStart).toBeGreaterThan(readiness);
    expect(guardEnd).toBeGreaterThan(guardStart);
    expect(notebookPageSource.slice(readiness, guardStart)).toContain(
      "useLayoutEffect(() =>"
    );
    expect(notebookPageSource.slice(guardStart, guardEnd)).toContain(
      'surface.addEventListener("touchstart"'
    );
    expect(notebookPageSource.slice(guardStart, guardEnd)).toContain(
      'surface.addEventListener("touchmove"'
    );
  });

  it("expects capture loss after pointer cancellation before rapid re-contact", () => {
    expect(editorSource).toContain(
      'expectCaptureLoss: hadPointerCapture || type === "pointercancel"'
    );
    expect(editorSource).not.toContain(
      'expectCaptureLoss: type === "pointerup" && hadPointerCapture'
    );
  });

  it("uses the bounded live Pencil sampler instead of unbounded replay", () => {
    expect(editorSource).toContain(
      "getBoundedLivePointerSamples("
    );
    expect(editorSource).not.toContain("for (const sample of samples)");
  });
});
