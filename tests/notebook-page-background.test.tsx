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
});
