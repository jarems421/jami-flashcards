import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Notebook,
  NotebookFile,
  NotebookPage,
} from "@/lib/workspace/notebooks";

const rendererSpies = vi.hoisted(() => ({
  imageProps: [] as Array<Record<string, unknown>>,
  pdfProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    rendererSpies.imageProps.push(props);
    return null;
  },
}));

vi.mock("@/components/workspace/NotebookPdfPage", () => ({
  default: (props: Record<string, unknown>) => {
    rendererSpies.pdfProps.push(props);
    return null;
  },
}));

import NotebookPageStaticContent from "@/components/workspace/NotebookPageStaticContent";
import NotebookPageThumbnail from "@/components/workspace/NotebookPageThumbnail";
import NotebookPageBackground from "@/components/workspace/NotebookPageBackground";

const backgroundSource = readFileSync(
  new URL(
    "../components/workspace/NotebookPageBackground.tsx",
    import.meta.url
  ),
  "utf8"
);
const notebookPageSource = readFileSync(
  new URL(
    "../app/dashboard/notebooks/[notebookId]/page.tsx",
    import.meta.url
  ),
  "utf8"
);

const notebook: Notebook = {
  id: "notebook-1",
  folderId: "folder-1",
  title: "Physics",
  type: "blank",
  topicIds: [],
  sourceIds: [],
  pageColor: "white",
  pageStyle: "plain",
  createdAt: 1,
  updatedAt: 1,
  archived: false,
};

const page: NotebookPage = {
  id: "page-1",
  notebookId: notebook.id,
  folderId: notebook.folderId,
  pageNumber: 1,
  pageType: "blank",
  textBlocks: [],
  inkData: {
    version: 2,
    format: "js-draw-svg",
    svg: "<svg></svg>",
  },
  imageRefs: [],
  pdfPageIndex: 3,
  pageColor: "white",
  pageStyle: "plain",
  status: "working",
  contentRevision: 1,
  createdAt: 1,
  updatedAt: 1,
};

const pdfFile: NotebookFile = {
  id: "file-1",
  notebookId: notebook.id,
  folderId: notebook.folderId,
  fileName: "paper.pdf",
  fileType: "application/pdf",
  storagePath: "notebooks/paper.pdf",
  uploadedAt: 1,
  createdAt: 1,
  updatedAt: 1,
};

const imageFile: NotebookFile = {
  ...pdfFile,
  id: "file-2",
  fileName: "diagram.png",
  fileType: "image/png",
  storagePath: "notebooks/diagram.png",
};

describe("notebook page backgrounds", () => {
  beforeEach(() => {
    rendererSpies.imageProps.length = 0;
    rendererSpies.pdfProps.length = 0;
  });

  it("keeps drawer thumbnails lazy and pixel-ratio bounded", () => {
    renderToStaticMarkup(
      createElement(NotebookPageThumbnail, {
        page,
        notebook,
        backgroundFile: pdfFile,
      })
    );

    expect(rendererSpies.pdfProps).toHaveLength(1);
    expect(rendererSpies.pdfProps[0]).toMatchObject({
      storagePath: pdfFile.storagePath,
      pageIndex: 3,
      lazy: true,
      maxPixelRatio: 1.25,
      className: "absolute inset-0",
    });
    expect(rendererSpies.imageProps).toHaveLength(1);
    expect(rendererSpies.imageProps[0]?.sizes).toBe("10rem");
  });

  it("keeps swipe previews eager, unfaded, and full-resolution", () => {
    renderToStaticMarkup(
      createElement(NotebookPageStaticContent, {
        page,
        notebook,
        backgroundFile: pdfFile,
      })
    );

    expect(rendererSpies.pdfProps).toHaveLength(1);
    expect(rendererSpies.pdfProps[0]).toMatchObject({
      storagePath: pdfFile.storagePath,
      pageIndex: 3,
      lazy: false,
      fadeIn: false,
      className: "absolute inset-0",
    });
    expect(rendererSpies.imageProps).toHaveLength(1);
    expect(rendererSpies.imageProps[0]?.sizes).toBe("48rem");
  });

  it("forwards the live PDF contract without hiding its retry control", () => {
    const onRenderStateChange = vi.fn();
    const onCanvasReady = vi.fn();

    renderToStaticMarkup(
      createElement(NotebookPageBackground, {
        pageColor: "white",
        pageStyle: "plain",
        backgroundFile: pdfFile,
        pageIndex: 3,
        pageStyleClassName:
          "pointer-events-none absolute inset-0 z-0",
        fileLayerClassName:
          "pointer-events-none absolute inset-0 z-[1] flex items-center justify-center overflow-hidden",
        pdfRenderKey: "page-1:file-1:3",
        pdfAriaHidden: false,
        pdfAriaLabel: "Notebook file: paper.pdf, page 4",
        pdfFadeIn: false,
        pdfOnRenderStateChange: onRenderStateChange,
        pdfOnCanvasReady: onCanvasReady,
        inkSvg: "<svg></svg>",
        inkSizes: "48rem",
        inkClassName:
          "pointer-events-none absolute inset-0 z-[12] object-fill",
      })
    );

    expect(rendererSpies.pdfProps).toHaveLength(1);
    expect(rendererSpies.pdfProps[0]).toMatchObject({
      "aria-label": "Notebook file: paper.pdf, page 4",
      storagePath: pdfFile.storagePath,
      pageIndex: 3,
      fadeIn: false,
      onRenderStateChange,
      onCanvasReady,
      className: "absolute inset-0",
    });
    expect(rendererSpies.pdfProps[0]?.["aria-hidden"]).toBeUndefined();
    expect(rendererSpies.imageProps).toHaveLength(1);
    expect(rendererSpies.imageProps[0]).toMatchObject({
      sizes: "48rem",
      className:
        "pointer-events-none absolute inset-0 z-[12] object-fill",
    });
  });

  it("settles live images on both load and error but not on the placeholder", () => {
    const onSettled = vi.fn();

    renderToStaticMarkup(
      createElement(NotebookPageBackground, {
        backgroundFile: imageFile,
        backgroundUrl: "https://example.com/diagram.png",
        fileLayerClassName:
          "pointer-events-none absolute inset-0 z-[1] flex items-center justify-center overflow-hidden",
        imageStrategy: "next-image",
        imageRenderKey: "page-1:file-2:image",
        imageOnSettled: onSettled,
        imageLoadingLabel: "Loading file...",
        imageSizes: "48rem",
        imageClassName: "object-contain",
      })
    );

    expect(rendererSpies.imageProps).toHaveLength(1);
    expect(rendererSpies.imageProps[0]).toMatchObject({
      src: "https://example.com/diagram.png",
      sizes: "48rem",
      className: "object-contain",
      onLoad: onSettled,
      onError: onSettled,
    });

    rendererSpies.imageProps.length = 0;
    const placeholder = renderToStaticMarkup(
      createElement(NotebookPageBackground, {
        backgroundFile: imageFile,
        fileLayerClassName:
          "pointer-events-none absolute inset-0 z-[1] flex items-center justify-center overflow-hidden",
        imageStrategy: "next-image",
        imageOnSettled: onSettled,
        imageLoadingLabel: "Loading file...",
      })
    );

    expect(rendererSpies.imageProps).toHaveLength(0);
    expect(placeholder).toContain("Loading file...");
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("keeps explicit remount keys and page-owned PDF canvas bookkeeping", () => {
    expect(backgroundSource).toContain("key={imageRenderKey}");
    expect(backgroundSource).toContain("key={pdfRenderKey}");
    expect(notebookPageSource).toContain("pdfOnCanvasReady={(canvas) =>");
    expect(notebookPageSource).toContain(
      "activePdfCanvasRef.current = canvas"
    );
    expect(notebookPageSource).toContain(
      "activePdfCanvasKeyRef.current = activePdfRenderKey"
    );
  });
});
