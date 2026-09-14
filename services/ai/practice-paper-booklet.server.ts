import "server-only";

import type { PracticePaperPdfLayout } from "@/lib/practice/paper-pdf-layout";
import type { GeneratedPracticePaper } from "@/lib/practice/practice-papers";
import { buildNotebookFilePayload, buildNotebookPagePayload } from "@/lib/workspace/notebooks";
import { getAdminStorageBucket } from "@/services/firebase/admin";
import { renderPracticePaperPdf } from "@/services/practice/practice-paper-pdf.server";

/**
 * A generated paper's printed booklet, stored the way an uploaded paper is.
 *
 * The PDF lands under the notebook's own files, and each of its pages becomes
 * a notebook page drawn over that page of the PDF -- the same shape an upload
 * produces, so the notebook, the timer and marking need no second path for
 * generated papers. What an upload cannot have is the layout: which questions
 * were typeset on which page, which marking is handed instead of a guess.
 *
 * The file id is fixed per paper, so a finalise that is retried after the
 * upload but before the write overwrites the same object rather than leaving a
 * second copy behind.
 */
export type PracticePaperBooklet = {
  fileId: string;
  file: ReturnType<typeof buildNotebookFilePayload>;
  pages: Array<{ id: string; payload: ReturnType<typeof buildNotebookPagePayload> }>;
  layout: PracticePaperPdfLayout;
};

function fileNameFor(title: string) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  return `${slug || "practice-paper"}.pdf`;
}

export async function createPracticePaperBooklet(input: {
  uid: string;
  paperId: string;
  folderId: string;
  paper: GeneratedPracticePaper;
  now: number;
}): Promise<PracticePaperBooklet> {
  const bucket = getAdminStorageBucket();
  const safePaperId = input.paperId.replace(/[^A-Za-z0-9_-]/g, "-");
  const fileId = `${safePaperId}-booklet`.slice(0, 160);
  const assetPrefix = `users/${input.uid}/generatedPaperAssets/${input.paperId}/`;

  const rendered = await renderPracticePaperPdf(input.paper, {
    // Only this paper's own generated figures; a path from anywhere else is not drawn.
    loadImage: async (storagePath) => {
      if (!storagePath.startsWith(assetPrefix)) return null;
      const [bytes] = await bucket.file(storagePath).download();
      return bytes;
    },
  });

  const fileName = fileNameFor(input.paper.title);
  const storagePath = `users/${input.uid}/notebookFiles/${input.paperId}/${fileId}-${fileName}`;
  await bucket.file(storagePath).save(rendered.bytes, {
    contentType: "application/pdf",
    resumable: false,
    metadata: {
      cacheControl: "private,max-age=3600",
      metadata: { uid: input.uid, paperId: input.paperId },
    },
  });

  return {
    fileId,
    file: buildNotebookFilePayload({
      notebookId: input.paperId,
      folderId: input.folderId,
      fileName,
      fileType: "application/pdf",
      storagePath,
      sizeBytes: rendered.bytes.length,
      pageCount: rendered.pageCount,
      now: input.now,
    }),
    pages: rendered.pages.map((page) => ({
      id: `${safePaperId}_booklet-${page.pageIndex + 1}`,
      payload: buildNotebookPagePayload({
        notebookId: input.paperId,
        folderId: input.folderId,
        pageNumber: page.pageIndex + 1,
        title: page.pageIndex === 0 ? "Cover" : `Page ${page.pageIndex + 1}`,
        pageType: "past_paper_page",
        pageColor: "white",
        pageStyle: "plain",
        status: "blank",
        backgroundFileId: fileId,
        pdfPageIndex: page.pageIndex,
        linkedPastPaperId: input.paperId,
        now: input.now,
      }),
    })),
    layout: { version: 1, fileId, pageCount: rendered.pageCount, pages: rendered.pages },
  };
}
