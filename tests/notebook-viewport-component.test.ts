import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NotebookViewport from "@/components/workspace/NotebookViewport";

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
    // Every sheet keeps an edge drawn above its ink, so a stroke taken to the
    // margin stops cleanly instead of bleeding over it. The colour moved to
    // CSS, because a page on a near-black desk needs a pale hairline and a page
    // on a pale one needs a dark one, and no class expresses "whichever
    // applies".
    expect(html.match(/after:border\b/g)).toHaveLength(3);
    expect(html).not.toContain("after:border-black");
    // The lift is themed too, so it must not be pinned back to none here.
    expect(html).not.toContain("shadow-none");
    expect(html).not.toContain("box-border");
  });

  it("keeps live ink beneath the track controlled by the swipe-state hook", () => {
    const html = renderToStaticMarkup(
      createElement(NotebookViewport, {
        activeClassName: "bg-white",
        activeContent: createElement("div", {
          className: "notebook-ink-surface",
        }),
        activeRef: createRef<HTMLDivElement>(),
        frameRef: createRef<HTMLDivElement>(),
        geometry: {
          pageWidth: 450,
          pageHeight: 620,
          pageX: 100,
          pageY: 16,
          swipeTravel: 466,
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

    const trackIndex = html.indexOf("notebook-page-track");
    const inkIndex = html.indexOf("notebook-ink-surface");
    expect(trackIndex).toBeGreaterThanOrEqual(0);
    expect(inkIndex).toBeGreaterThan(trackIndex);
    // useNotebookPageTrack has dedicated behavior tests for the active,
    // direction, and snapshot-ready data attributes written to this node.
    expect(html).toContain('aria-hidden="true"');
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
