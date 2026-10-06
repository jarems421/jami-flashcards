import { PAGE_COLOR_CLASS } from "@/components/workspace/NotebookPageBackground";
import NotebookPageStaticContent from "@/components/workspace/NotebookPageStaticContent";
import type { NotebookViewportPreview } from "@/components/workspace/NotebookViewport";
import {
  isNotebookPageSwipePreviewEnabled,
  shouldShowNotebookNewPagePreview,
  type NotebookPageSwipeMotion,
} from "@/lib/workspace/notebook-carousel";
import { getNotebookPageStyleBackground } from "@/lib/workspace/notebook-page-content";
import type {
  Notebook,
  NotebookFile,
  NotebookPage,
  NotebookPageColor,
  NotebookPageStyle,
} from "@/lib/workspace/notebooks";

type PageBackground = { file: NotebookFile | null; url: string | undefined };

function pagePreview(
  page: NotebookPage,
  notebook: Notebook,
  background: PageBackground
): NotebookViewportPreview {
  return {
    key: page.id,
    className: PAGE_COLOR_CLASS[page.pageColor ?? notebook.pageColor ?? "white"],
    content: (
      <NotebookPageStaticContent
        page={page}
        notebook={notebook}
        backgroundFile={background.file}
        backgroundUrl={background.url}
      />
    ),
  };
}

/**
 * What the swipe track shows either side of the open page: the real
 * neighbouring pages, or a blank sheet in the notebook's paper past the end,
 * where pulling makes a new page. Nothing while zoomed in, where one finger
 * pans instead of turning.
 */
export function getNotebookSwipePreviews(input: {
  zoom: number;
  notebook: Notebook;
  previousPage: NotebookPage | null;
  nextPage: NotebookPage | null;
  resolveBackground: (page: NotebookPage) => PageBackground;
  /** The open page's paper, which a new page past the end is drawn in. */
  paper: { pageColor: NotebookPageColor; pageStyle: NotebookPageStyle };
  newPage: {
    createPageActive: boolean;
    creatingPage: boolean;
    motionKind: NotebookPageSwipeMotion["kind"] | null;
    fullEditingEnabled: boolean;
    selectedPageIndex: number;
    pageCount: number;
  };
}): { previous: NotebookViewportPreview | null; next: NotebookViewportPreview | null } {
  const enabled = isNotebookPageSwipePreviewEnabled(input.zoom);
  if (!enabled) return { previous: null, next: null };

  const previous = input.previousPage
    ? pagePreview(input.previousPage, input.notebook, input.resolveBackground(input.previousPage))
    : null;
  if (input.nextPage) {
    return {
      previous,
      next: pagePreview(input.nextPage, input.notebook, input.resolveBackground(input.nextPage)),
    };
  }
  const showNewPage = shouldShowNotebookNewPagePreview({
    previewEnabled: enabled,
    hasNextPage: false,
    ...input.newPage,
  });
  return {
    previous,
    next: showNewPage
      ? {
          key: "new-page-preview",
          className: PAGE_COLOR_CLASS[input.paper.pageColor],
          content: (
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={getNotebookPageStyleBackground(input.paper.pageColor, input.paper.pageStyle)}
            />
          ),
        }
      : null,
  };
}
