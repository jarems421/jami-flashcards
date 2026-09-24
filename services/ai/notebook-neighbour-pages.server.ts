import "server-only";

import sharp from "sharp";
import type { AiContentPart } from "@/lib/ai/content-parts";
import { selectNotebookPicturedNeighbours } from "@/lib/ai/notebook-context-window";
import {
  mapNotebookFileData,
  normalizeNotebookInkData,
  type NotebookFile,
  type NotebookPage,
} from "@/lib/workspace/notebooks";
import { getAdminDb } from "@/services/firebase/admin";
import { renderNotebookPage } from "@/services/ai/notebook-page-render.server";
import { createLogger } from "@/lib/observability/logger";

const log = createLogger({ module: "ai.assistant.neighbour_pages" });

/**
 * The whole of this is an enrichment: a slow PDF or a missing ink record costs
 * Tutor the neighbouring pages, never the answer. Measured against the rest of
 * the pre-answer work, which already has its own deadline.
 */
const NEIGHBOUR_PAGES_BUDGET_MS = 4_000;
/** Smaller than the current page's snapshot: context to read, not work to mark. */
const NEIGHBOUR_IMAGE_WIDTH = 820;

function hasDrawnInk(svg: string | undefined) {
  return Boolean(svg && /<(path|polyline|line|circle|ellipse|rect|polygon)\b/i.test(svg));
}

function hasTypedText(page: NotebookPage) {
  return Boolean(page.typedContent?.trim() || page.textBlocks.some((block) => block.text.trim()));
}

async function renderNeighbour(input: {
  uid: string;
  page: NotebookPage;
  position: "before" | "after";
  files: ReadonlyMap<string, NotebookFile>;
  fileCache: Map<string, Buffer>;
  pdfCache: Map<string, Buffer>;
}): Promise<AiContentPart[]> {
  const inkRecord = input.page.inkData
    ? null
    : await getAdminDb()
        .collection("users")
        .doc(input.uid)
        .collection("notebookPageInk")
        .doc(input.page.id)
        .get();
  const inkSvg =
    input.page.inkData?.svg ??
    (inkRecord?.exists ? normalizeNotebookInkData(inkRecord.data()?.inkData)?.svg : undefined) ??
    "";
  // A page with nothing drawn and no background is already fully described by
  // its typed text in the page map; a picture of blank paper tells Tutor nothing.
  if (!hasDrawnInk(inkSvg) && !input.page.backgroundFileId) return [];

  const rendered = await renderNotebookPage({
    uid: input.uid,
    page: input.page,
    inkSvg,
    files: input.files,
    fileCache: input.fileCache,
    pdfCache: input.pdfCache,
  });
  const bytes = await sharp(rendered.bytes)
    .resize({ width: NEIGHBOUR_IMAGE_WIDTH, withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 78 })
    .toBuffer();
  const where = input.position === "before" ? "before" : "after";
  return [
    {
      text: `Page ${input.page.pageNumber}, the page ${where} the current one, as the student sees it${
        hasTypedText(input.page) ? " (its typed text is also in the page map)" : ""
      }. Read it for the rest of the question or working; it is not the page they asked about unless they say so.`,
    },
    { inlineData: { mimeType: "image/jpeg", data: bytes.toString("base64") } },
  ];
}

/**
 * Pictures of the pages either side of the current one, for Tutor to read.
 *
 * Drawn only when the student asks something, from what is already saved, and
 * never stored: the same on-demand read the current page's snapshot is, one
 * page further in each direction.
 */
export async function loadNotebookNeighbourPageParts(input: {
  uid: string;
  notebookId: string;
  pages: readonly NotebookPage[];
  currentPageId: string;
}): Promise<AiContentPart[]> {
  const neighbours = selectNotebookPicturedNeighbours(input.pages, input.currentPageId);
  if (neighbours.length === 0) return [];
  const startedAt = Date.now();

  const work = (async () => {
    const needsFiles = neighbours.some(({ page }) => page.backgroundFileId);
    const files = new Map<string, NotebookFile>();
    if (needsFiles) {
      const snapshot = await getAdminDb()
        .collection("users")
        .doc(input.uid)
        .collection("notebookFiles")
        .where("notebookId", "==", input.notebookId)
        .limit(20)
        .get();
      snapshot.docs.forEach((document) => {
        const file = mapNotebookFileData(document.id, document.data());
        files.set(file.id, file);
      });
    }
    const fileCache = new Map<string, Buffer>();
    const pdfCache = new Map<string, Buffer>();
    const rendered = await Promise.all(
      neighbours.map(({ page, position }) =>
        renderNeighbour({ uid: input.uid, page, position, files, fileCache, pdfCache }).catch(
          (error: unknown) => {
            log.warn("neighbour_page.failed", { pageNumber: page.pageNumber, error });
            return [] as AiContentPart[];
          }
        )
      )
    );
    return rendered.flat();
  })();
  // Still settles after a timeout; without this its failure would go unhandled.
  work.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const parts = await Promise.race([
      work,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), NEIGHBOUR_PAGES_BUDGET_MS);
      }),
    ]);
    if (parts === "timeout") {
      log.warn("neighbour_pages.timed_out", { budgetMs: NEIGHBOUR_PAGES_BUDGET_MS });
      return [];
    }
    log.info("neighbour_pages.completed", {
      pictured: parts.filter((part) => "inlineData" in part).length,
      latencyMs: Date.now() - startedAt,
    });
    return parts;
  } catch (error) {
    log.warn("neighbour_pages.failed", { error });
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}
