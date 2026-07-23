import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NotebookViewport from "@/components/workspace/NotebookViewport";

const notebookEditorSource = readFileSync(
  join(
    process.cwd(),
    "app/dashboard/notebooks/[notebookId]/page.tsx"
  ),
  "utf8"
);
const globalStylesSource = readFileSync(
  join(process.cwd(), "app/globals.css"),
  "utf8"
);

describe("NotebookViewport", () => {
  it("renders every carousel slot through the same sheet treatment", () => {
    const html = renderToStaticMarkup(
      createElement(NotebookViewport, {
        activeClassName: "bg-white",
        activeContent: createElement("span", null, "Active"),
        activeRef: createRef<HTMLDivElement>(),
        frameRef: createRef<HTMLDivElement>(),
        geometry: {
          pageWidth: 450,
          pageHeight: 620,
          pageX: 100,
          pageY: 16,
          swipeTravel: 466,
        },
        nextPreview: {
          key: "next",
          className: "bg-white",
          content: createElement("span", null, "Next"),
        },
        onActivePointerCancel: () => undefined,
        onActivePointerMove: () => undefined,
        onActivePointerUp: () => undefined,
        onTrackTransitionCancel: () => undefined,
        onTrackTransitionEnd: () => undefined,
        previewLayerRef: createRef<HTMLDivElement>(),
        previousPreview: {
          key: "previous",
          className: "bg-white",
          content: createElement("span", null, "Previous"),
        },
        trackRef: createRef<HTMLDivElement>(),
      })
    );

    expect(html.match(/data-notebook-sheet="true"/g)).toHaveLength(3);
    expect(html).toContain('data-notebook-slot="previous"');
    expect(html).toContain('data-notebook-slot="active"');
    expect(html).toContain('data-notebook-slot="next"');
    expect(html).toContain("translate3d(-366px, 16px, 0)");
    expect(html).toContain("translate3d(100px, 16px, 0)");
    expect(html).toContain("translate3d(566px, 16px, 0)");
    expect(html.match(/after:border-black/g)).toHaveLength(3);
    expect(html).not.toContain("box-border");
  });

  it("keeps fit zoom neutral and coalesces live pinch rendering", () => {
    expect(notebookEditorSource).not.toContain(
      "getNotebookViewportPreferredZoom"
    );
    expect(notebookEditorSource).not.toContain(
      "getNotebookViewportZoomAfterPreferredSizeChange"
    );
    expect(notebookEditorSource).toContain(
      "pinchZoomAnimationFrameRef"
    );
    expect(notebookEditorSource).toContain("queueLivePinchTransform()");
    expect(notebookEditorSource).toContain(
      "isNotebookPageSwipePreviewEnabled("
    );
  });

  it("keeps the live ink canvas stable and input-locked during page travel", () => {
    expect(notebookEditorSource).toContain(
      "readOnly={!fullNotebookEditingEnabled}"
    );
    expect(notebookEditorSource).not.toContain(
      "!fullNotebookEditingEnabled || Boolean(pageSwipeMotion)"
    );
    expect(globalStylesSource).toContain(
      '.notebook-page-track[data-swipe-active="true"] .notebook-ink-surface'
    );
    expect(globalStylesSource).toMatch(
      /\.notebook-page-track\[data-swipe-active="true"\] \.notebook-ink-surface\s*\{\s*pointer-events: none;/
    );
    expect(notebookEditorSource).toContain("pageSwipeInkSnapshot");
    expect(notebookEditorSource).toContain(
      "markPageSwipeInkSnapshotReady"
    );
    expect(globalStylesSource).toContain(
      '.notebook-page-track[data-swipe-direction="previous"]'
    );
    expect(globalStylesSource).toContain(
      '.notebook-page-track[data-swipe-direction="next"]'
    );
    expect(globalStylesSource).toContain(
      '.notebook-page-track[data-ink-snapshot-ready="true"]'
    );
  });

  it("keeps the measurable frame mounted before a page is ready", () => {
    const html = renderToStaticMarkup(
      createElement(NotebookViewport, {
        activeClassName: "bg-white",
        activeContent: null,
        activeRef: createRef<HTMLDivElement>(),
        frameRef: createRef<HTMLDivElement>(),
        geometry: {
          pageWidth: 0,
          pageHeight: 0,
          pageX: 0,
          pageY: 0,
          swipeTravel: 16,
        },
        onActivePointerCancel: () => undefined,
        onActivePointerMove: () => undefined,
        onActivePointerUp: () => undefined,
        onTrackTransitionCancel: () => undefined,
        onTrackTransitionEnd: () => undefined,
        previewLayerRef: createRef<HTMLDivElement>(),
        trackRef: createRef<HTMLDivElement>(),
      })
    );

    expect(html).toContain("data-notebook-page-frame");
    expect(html).not.toContain("data-notebook-sheet");
  });
});
