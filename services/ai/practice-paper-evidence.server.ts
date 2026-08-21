import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";
import type { AiContentPart } from "@/lib/ai/content-parts";
import { buildJamiAssistantReferenceParts } from "@/lib/ai/jami-assistant";
import {
  mapPracticePaperData,
  type PracticePaper,
  type PracticePaperEvidenceIssue,
  type PracticePaperEvidenceManifest,
  type PracticePaperEvidencePage,
} from "@/lib/practice/practice-papers";
import {
  mapNotebookFileData,
  mapNotebookPageData,
  normalizeNotebookInkData,
  type NotebookFile,
  type NotebookPage,
} from "@/lib/workspace/notebooks";
import {
  getAdminDb,
  getAdminStorageBucket,
} from "@/services/firebase/admin";
import { loadPracticePaperWithSecret } from "@/services/ai/practice-paper-secrets.server";

const MAX_EVIDENCE_PAGES = 80;
const MAX_SOURCE_PAGES = 40;
const PAGE_WIDTH = 1_100;
const PAGE_HEIGHT = 1_550;

type EvidencePageContent = {
  id: string;
  questionIds: string[];
  typedText: string;
  kind: PracticePaperEvidencePage["kind"];
};

type EvidenceArtifact = {
  manifest: PracticePaperEvidenceManifest;
  content: EvidencePageContent[];
};

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

async function savePrivateObject(path: string, bytes: Buffer, contentType: string) {
  await getAdminStorageBucket().file(path).save(bytes, {
    resumable: false,
    metadata: {
      contentType,
      cacheControl: "private, no-store, max-age=0",
    },
  });
}

async function renderPdfPages(bytes: Buffer, requestedPages?: readonly number[]) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    disableFontFace: false,
  });
  const document = await task.promise;
  const pages = requestedPages?.length
    ? Array.from(new Set(requestedPages.filter((page) => page >= 0 && page < document.numPages)))
    : Array.from({ length: Math.min(document.numPages, MAX_SOURCE_PAGES) }, (_, index) => index);
  const rendered: Array<{ pageIndex: number; bytes: Buffer; width: number; height: number }> = [];
  try {
    for (const pageIndex of pages) {
      const page = await document.getPage(pageIndex + 1);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(2, PAGE_WIDTH / Math.max(1, baseViewport.width));
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({
        canvas: canvas as never,
        canvasContext: context as never,
        viewport,
      }).promise;
      rendered.push({
        pageIndex,
        bytes: canvas.toBuffer("image/png"),
        width: canvas.width,
        height: canvas.height,
      });
    }
  } finally {
    await task.destroy();
  }
  return rendered;
}

async function normalizeImage(bytes: Buffer) {
  const image = sharp(bytes, { failOn: "none" })
    .rotate()
    .resize({ width: PAGE_WIDTH, height: PAGE_HEIGHT, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" });
  const metadata = await image.metadata();
  const normalized = await image.png({ compressionLevel: 9 }).toBuffer();
  const outputMetadata = await sharp(normalized).metadata();
  return {
    bytes: normalized,
    width: outputMetadata.width ?? metadata.width,
    height: outputMetadata.height ?? metadata.height,
  };
}

async function inkSvgToPng(svg: string) {
  if (!svg || svg.length > 850_000) return null;
  try {
    return await sharp(Buffer.from(svg))
      .resize({ width: PAGE_WIDTH, height: PAGE_HEIGHT, fit: "contain" })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    return null;
  }
}

async function backgroundForPage(
  uid: string,
  page: NotebookPage,
  files: ReadonlyMap<string, NotebookFile>,
  fileCache: Map<string, Buffer>,
  pdfCache: Map<string, Buffer>
) {
  if (!page.backgroundFileId) return null;
  const file = files.get(page.backgroundFileId);
  if (!file?.storagePath.startsWith(`users/${uid}/`)) return null;
  let bytes = fileCache.get(file.id);
  if (!bytes) {
    [bytes] = await getAdminStorageBucket().file(file.storagePath).download();
    fileCache.set(file.id, bytes);
  }
  if (file.fileType === "application/pdf") {
    const key = `${file.id}:${page.pdfPageIndex ?? 0}`;
    let png = pdfCache.get(key);
    if (!png) {
      png = (await renderPdfPages(bytes, [page.pdfPageIndex ?? 0]))[0]?.bytes;
      if (!png) return null;
      pdfCache.set(key, png);
    }
    return png;
  }
  if (file.fileType.startsWith("image/")) return (await normalizeImage(bytes)).bytes;
  return null;
}

async function renderAnswerPage(input: {
  uid: string;
  page: NotebookPage;
  inkSvg: string;
  files: ReadonlyMap<string, NotebookFile>;
  fileCache: Map<string, Buffer>;
  pdfCache: Map<string, Buffer>;
}) {
  const background = await backgroundForPage(
    input.uid,
    input.page,
    input.files,
    input.fileCache,
    input.pdfCache
  );
  const ink = await inkSvgToPng(input.inkSvg);
  const base = background
    ? sharp(background).resize({ width: PAGE_WIDTH, height: PAGE_HEIGHT, fit: "contain", background: "#ffffff" })
    : sharp({ create: { width: PAGE_WIDTH, height: PAGE_HEIGHT, channels: 4, background: "#ffffff" } });
  const bytes = await base
    .composite(ink ? [{ input: ink, blend: "over" }] : [])
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { bytes, width: PAGE_WIDTH, height: PAGE_HEIGHT };
}

function questionIdsForPage(page: NotebookPage, paper: PracticePaper) {
  if (page.linkedQuestionId && paper.questions.some((question) => question.id === page.linkedQuestionId)) {
    return [page.linkedQuestionId];
  }
  return [];
}

async function addStoredPage(input: {
  prefix: string;
  name: string;
  bytes: Buffer;
  kind: PracticePaperEvidencePage["kind"];
  questionIds: string[];
  width?: number;
  height?: number;
  pages: PracticePaperEvidencePage[];
}) {
  const storagePath = `${input.prefix}/${input.name}.png`;
  await savePrivateObject(storagePath, input.bytes, "image/png");
  input.pages.push({
    id: input.name,
    kind: input.kind,
    questionIds: input.questionIds,
    storagePath,
    sha256: sha256(input.bytes),
    mimeType: "image/png",
    width: input.width,
    height: input.height,
    legibility: "clear",
  });
}

async function copySourceVisuals(input: {
  uid: string;
  sourcePath: string;
  sourceMimeType: string;
  prefix: string;
  namePrefix: string;
  kind: "question" | "mark_scheme";
  questionIds: string[];
  pages: PracticePaperEvidencePage[];
  issues: PracticePaperEvidenceIssue[];
}) {
  if (!input.sourcePath.startsWith(`users/${input.uid}/`)) return;
  try {
    const [bytes] = await getAdminStorageBucket().file(input.sourcePath).download();
    if (input.sourceMimeType === "application/pdf") {
      const rendered = await renderPdfPages(bytes);
      for (const page of rendered) {
        if (input.pages.length >= MAX_EVIDENCE_PAGES) break;
        await addStoredPage({
          ...input,
          prefix: input.prefix,
          name: `${input.namePrefix}-${page.pageIndex + 1}`,
          bytes: page.bytes,
          width: page.width,
          height: page.height,
        });
      }
      if (rendered.length === 0) throw new Error("No PDF pages rendered");
      return;
    }
    if (input.sourceMimeType.startsWith("image/")) {
      const image = await normalizeImage(bytes);
      await addStoredPage({
        ...input,
        prefix: input.prefix,
        name: `${input.namePrefix}-1`,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
      });
    }
  } catch {
    input.issues.push({
      code: `${input.kind}_visual_unreadable`,
      severity: "warning",
      message: input.kind === "mark_scheme"
        ? "Part of the marking guide could not be read clearly."
        : "Part of the original paper could not be read clearly.",
    });
  }
}

export async function createPracticePaperEvidenceBundle(
  uid: string,
  paperId: string,
  attemptId: string
): Promise<EvidenceArtifact> {
  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);
  const manifestRef = userRef.collection("practicePaperEvidence").doc(attemptId);
  const existing = await manifestRef.get();
  if (existing.exists) {
    const data = existing.data() ?? {};
    const manifest = data.manifest as PracticePaperEvidenceManifest | undefined;
    if (manifest?.attemptId === attemptId) {
      return loadPracticePaperEvidenceBundle(uid, attemptId);
    }
  }

  const [paperSnapshot, pageSnapshots, fileSnapshots] = await Promise.all([
    userRef.collection("pastPapers").doc(paperId).get(),
    userRef.collection("notebookPages").where("notebookId", "==", paperId).orderBy("pageNumber", "asc").limit(81).get(),
    userRef.collection("notebookFiles").where("notebookId", "==", paperId).limit(20).get(),
  ]);
  if (!paperSnapshot.exists) throw new Error("Practice paper not found.");
  if (pageSnapshots.size > MAX_EVIDENCE_PAGES) throw new Error("This paper contains too many pages to mark safely.");
  const paper = await loadPracticePaperWithSecret({
    uid,
    paperId,
    paperData: paperSnapshot.data() ?? {},
  });
  if (paper.status !== "submitted" && paper.status !== "marked") {
    throw new Error("Submit the paper before marking.");
  }

  const files = new Map(fileSnapshots.docs.map((document) => {
    const file = mapNotebookFileData(document.id, document.data());
    return [file.id, file] as const;
  }));
  const pages = pageSnapshots.docs.map((document) =>
    mapNotebookPageData(document.id, document.data())
  );
  const inkSnapshots = await Promise.all(
    pages.map((page) => userRef.collection("notebookPageInk").doc(page.id).get())
  );
  const prefix = `users/${uid}/practicePaperMarkingEvidence/${attemptId}`;
  const manifestPages: PracticePaperEvidencePage[] = [];
  const content: EvidencePageContent[] = [];
  const issues: PracticePaperEvidenceIssue[] = [];
  const fileCache = new Map<string, Buffer>();
  const pdfCache = new Map<string, Buffer>();

  const paperSnapshotPath = `${prefix}/paper.json`;
  const markSchemeSnapshotPath = `${prefix}/mark-scheme.json`;
  const paperSnapshotBytes = Buffer.from(JSON.stringify({
      title: paper.title,
      instructions: paper.instructions,
      assessmentProfile: paper.assessmentProfile,
      questions: paper.questions,
      choiceGroups: paper.choiceGroups,
      totalMarks: paper.totalMarks,
    }));
  const markSchemeSnapshotBytes = Buffer.from(JSON.stringify(paper.markScheme));
  await Promise.all([
    savePrivateObject(paperSnapshotPath, paperSnapshotBytes, "application/json"),
    savePrivateObject(markSchemeSnapshotPath, markSchemeSnapshotBytes, "application/json"),
  ]);

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const splitInk = inkSnapshots[index];
    const ink = splitInk.exists ? normalizeNotebookInkData(splitInk.data()?.inkData) : undefined;
    const questionIds = questionIdsForPage(page, paper);
    if (questionIds.length === 0 && (page.typedContent || page.inkData?.svg || ink?.svg)) {
      issues.push({
        code: "answer_question_mapping_uncertain",
        severity: "warning",
        message: `Work on page ${page.pageNumber} could not be matched to one question with certainty.`,
        pageId: page.id,
      });
    }
    const rendered = await renderAnswerPage({
      uid,
      page,
      inkSvg: page.inkData?.svg ?? ink?.svg ?? "",
      files,
      fileCache,
      pdfCache,
    });
    await addStoredPage({
      prefix,
      name: `answer-${page.pageNumber}-${page.id}`,
      bytes: rendered.bytes,
      kind: "answer",
      questionIds,
      width: rendered.width,
      height: rendered.height,
      pages: manifestPages,
    });
    content.push({
      id: `answer-${page.pageNumber}-${page.id}`,
      questionIds,
      typedText: [page.typedContent, ...page.textBlocks.map((block) => block.text)]
        .filter(Boolean).join("\n").slice(0, 30_000),
      kind: "answer",
    });

    if (page.backgroundFileId) {
      const background = await backgroundForPage(uid, page, files, fileCache, pdfCache);
      if (background) {
        const normalized = await normalizeImage(background);
        await addStoredPage({
          prefix,
          name: `question-${page.pageNumber}-${page.id}`,
          bytes: normalized.bytes,
          kind: "question",
          questionIds,
          width: normalized.width,
          height: normalized.height,
          pages: manifestPages,
        });
      }
    }

    for (const [imageIndex, image] of page.imageRefs.slice(0, 6).entries()) {
      if (!image.storagePath?.startsWith(`users/${uid}/`)) continue;
      try {
        const [bytes] = await getAdminStorageBucket().file(image.storagePath).download();
        const normalized = await normalizeImage(bytes);
        const name = `answer-image-${page.id}-${imageIndex + 1}`;
        await addStoredPage({
          prefix,
          name,
          bytes: normalized.bytes,
          kind: "answer",
          questionIds,
          width: normalized.width,
          height: normalized.height,
          pages: manifestPages,
        });
        content.push({ id: name, questionIds, typedText: image.altText ?? "Student-provided image", kind: "answer" });
      } catch {
        issues.push({
          code: "answer_image_unreadable",
          severity: "warning",
          message: "One image in the answer could not be read clearly.",
          questionId: questionIds[0],
          pageId: page.id,
        });
      }
    }
  }

  const mappedAnswerQuestionIds = new Set(
    manifestPages
      .filter((page) => page.kind === "answer")
      .flatMap((page) => page.questionIds)
  );
  for (const question of paper.questions) {
    if (mappedAnswerQuestionIds.has(question.id)) continue;
    issues.push({
      code: "answer_page_mapping_missing",
      severity: "warning",
      message: `Jami could not confidently match an answer page to ${question.label}.`,
      questionId: question.id,
    });
  }

  if (paper.overtimeStartedAt) {
    const deadlineSnapshots = await userRef
      .collection("practicePaperDeadlineSnapshots")
      .where("attemptId", "==", attemptId)
      .limit(MAX_EVIDENCE_PAGES)
      .get();
    for (let index = 0; index < deadlineSnapshots.docs.length; index += 1) {
      const data = deadlineSnapshots.docs[index].data();
      const pageData = data.page && typeof data.page === "object"
        ? data.page as Record<string, unknown>
        : {};
      const inkData = data.ink && typeof data.ink === "object"
        ? data.ink as Record<string, unknown>
        : {};
      const page = mapNotebookPageData(
        typeof data.pageId === "string" ? data.pageId : `deadline-${index + 1}`,
        pageData
      );
      const ink = normalizeNotebookInkData(inkData.inkData);
      const questionIds = questionIdsForPage(page, paper);
      const rendered = await renderAnswerPage({
        uid,
        page,
        inkSvg: page.inkData?.svg ?? ink?.svg ?? "",
        files,
        fileCache,
        pdfCache,
      });
      const name = `within-time-${page.pageNumber}-${page.id}`;
      await addStoredPage({
        prefix,
        name,
        bytes: rendered.bytes,
        kind: "within_time_answer",
        questionIds,
        width: rendered.width,
        height: rendered.height,
        pages: manifestPages,
      });
      content.push({
        id: name,
        questionIds,
        typedText: [page.typedContent, ...page.textBlocks.map((block) => block.text)]
          .filter(Boolean).join("\n").slice(0, 30_000),
        kind: "within_time_answer",
      });
      for (const [imageIndex, image] of page.imageRefs.slice(0, 6).entries()) {
        if (!image.storagePath?.startsWith(`users/${uid}/`)) continue;
        try {
          const [bytes] = await getAdminStorageBucket().file(image.storagePath).download();
          const normalized = await normalizeImage(bytes);
          const imageName = `within-time-image-${page.id}-${imageIndex + 1}`;
          await addStoredPage({
            prefix,
            name: imageName,
            bytes: normalized.bytes,
            kind: "within_time_answer",
            questionIds,
            width: normalized.width,
            height: normalized.height,
            pages: manifestPages,
          });
          content.push({
            id: imageName,
            questionIds,
            typedText: image.altText ?? "Student-provided image",
            kind: "within_time_answer",
          });
        } catch {
          issues.push({
            code: "within_time_answer_image_unreadable",
            severity: "warning",
            message: "One within-time answer image could not be read clearly.",
            questionId: questionIds[0],
            pageId: page.id,
          });
        }
      }
    }
    if (deadlineSnapshots.empty) {
      issues.push({
        code: "within_time_evidence_missing",
        severity: "warning",
        message: "The exact within-time page snapshot was unavailable, so the overtime comparison may be less precise.",
      });
    }
  }

  for (const question of paper.questions) {
    for (const [assetIndex, asset] of question.assets.entries()) {
      if (manifestPages.length >= MAX_EVIDENCE_PAGES) break;
      try {
        let bytes: Buffer | null = null;
        if (asset.storagePath?.startsWith(`users/${uid}/`)) {
          [bytes] = await getAdminStorageBucket().file(asset.storagePath).download();
        } else if (asset.content.trim().startsWith("<svg")) {
          bytes = Buffer.from(asset.content);
        }
        if (!bytes) continue;
        const normalized = await normalizeImage(bytes);
        await addStoredPage({
          prefix,
          name: `question-asset-${question.id}-${assetIndex + 1}`,
          bytes: normalized.bytes,
          kind: "question",
          questionIds: [question.id],
          width: normalized.width,
          height: normalized.height,
          pages: manifestPages,
        });
      } catch {
        issues.push({
          code: "question_asset_unreadable",
          severity: "warning",
          message: `A visual needed for ${question.label} could not be read clearly.`,
          questionId: question.id,
        });
      }
    }
  }

  if (paper.origin === "uploaded") {
    const original = [...files.values()][0];
    if (original) {
      await copySourceVisuals({
        uid,
        sourcePath: original.storagePath,
        sourceMimeType: original.fileType,
        prefix,
        namePrefix: "original-paper",
        kind: "question",
        questionIds: paper.questions.map((question) => question.id),
        pages: manifestPages,
        issues,
      });
    }
  }

  if (paper.markSchemeSourceId) {
    const source = await userRef.collection("sources").doc(paper.markSchemeSourceId).get();
    const data = source.data() ?? {};
    const storagePath = typeof data.storagePath === "string" ? data.storagePath : "";
    const mimeType = typeof data.fileType === "string" ? data.fileType :
      typeof data.mimeType === "string" ? data.mimeType : "";
    if (source.exists && storagePath && mimeType) {
      await copySourceVisuals({
        uid,
        sourcePath: storagePath,
        sourceMimeType: mimeType,
        prefix,
        namePrefix: "original-mark-scheme",
        kind: "mark_scheme",
        questionIds: paper.questions.map((question) => question.id),
        pages: manifestPages,
        issues,
      });
    } else {
      issues.push({
        code: "mark_scheme_source_missing",
        severity: "warning",
        message: "The original uploaded marking guide was unavailable, so Jami used its saved structured copy.",
      });
    }
  }

  const manifest: PracticePaperEvidenceManifest = {
    version: 1,
    id: randomUUID(),
    paperId,
    attemptId,
    storagePrefix: prefix,
    paperSnapshotPath,
    paperSnapshotSha256: sha256(paperSnapshotBytes),
    markSchemeSnapshotPath,
    markSchemeSnapshotSha256: sha256(markSchemeSnapshotBytes),
    typedAnswers: content
      .filter((item) => item.typedText.length > 0)
      .map((item) => ({
        pageId: item.id,
        questionIds: item.questionIds,
        sha256: sha256(Buffer.from(item.typedText)),
      })),
    pages: manifestPages,
    issues,
    createdAt: Date.now(),
  };
  const storedArtifact = JSON.parse(JSON.stringify({ manifest, content })) as EvidenceArtifact;
  await savePrivateObject(`${prefix}/manifest.json`, Buffer.from(JSON.stringify(storedArtifact)), "application/json");
  try {
    await manifestRef.create({
      manifest: storedArtifact.manifest,
      paperId,
      attemptId,
      createdAt: storedArtifact.manifest.createdAt,
    });
    return storedArtifact;
  } catch {
    const raced = await manifestRef.get();
    const racedManifest = raced.data()?.manifest as PracticePaperEvidenceManifest | undefined;
    if (racedManifest?.attemptId === attemptId) {
      return loadPracticePaperEvidenceBundle(uid, attemptId);
    }
    throw new Error("The submitted evidence bundle could not be frozen.");
  }
}

export async function loadPracticePaperEvidenceBundle(
  uid: string,
  attemptId: string
): Promise<EvidenceArtifact> {
  const snapshot = await getAdminDb().collection("users").doc(uid)
    .collection("practicePaperEvidence").doc(attemptId).get();
  const manifest = snapshot.data()?.manifest as PracticePaperEvidenceManifest | undefined;
  if (!snapshot.exists || !manifest || manifest.attemptId !== attemptId) {
    throw new Error("Submitted evidence is unavailable.");
  }
  const expectedPrefix = `users/${uid}/practicePaperMarkingEvidence/${attemptId}`;
  if (manifest.storagePrefix !== expectedPrefix) {
    throw new Error("Submitted evidence has an invalid owner path.");
  }
  const [bytes] = await getAdminStorageBucket().file(`${expectedPrefix}/manifest.json`).download();
  const parsed = JSON.parse(bytes.toString("utf8")) as EvidenceArtifact;
  if (parsed.manifest?.attemptId !== attemptId || !Array.isArray(parsed.content)) {
    throw new Error("Submitted evidence is incomplete.");
  }
  return parsed;
}

export async function loadPracticePaperEvidenceParts(
  uid: string,
  artifact: EvidenceArtifact,
  kinds: readonly PracticePaperEvidencePage["kind"][],
  questionId?: string
): Promise<AiContentPart[]> {
  const selected = artifact.manifest.pages.filter((page) =>
    kinds.includes(page.kind) &&
    (!questionId || page.questionIds.length === 0 || page.questionIds.includes(questionId))
  );
  const contentById = new Map(artifact.content.map((item) => [item.id, item]));
  const parts: AiContentPart[] = [];
  for (let index = 0; index < selected.length; index += 1) {
    const page = selected[index];
    if (!page.storagePath.startsWith(`users/${uid}/practicePaperMarkingEvidence/`)) continue;
    const [bytes] = await getAdminStorageBucket().file(page.storagePath).download();
    const content = contentById.get(page.id);
    parts.push(...buildJamiAssistantReferenceParts({
      reference: `E${index + 1}`,
      boundaryToken: randomUUID(),
      label: `${page.kind.replaceAll("_", " ")}${page.questionIds.length ? ` for ${page.questionIds.join(", ")}` : ""}`,
      parts: [
        ...(content?.typedText ? [{ text: `Typed or labelled content:\n${content.typedText}` }] : []),
        { inlineData: { mimeType: "image/png", data: bytes.toString("base64") } },
      ],
    }));
  }
  return parts;
}

export async function loadPracticePaperForEvidence(uid: string, paperId: string) {
  const snapshot = await getAdminDb().collection("users").doc(uid).collection("pastPapers").doc(paperId).get();
  if (!snapshot.exists) throw new Error("Practice paper not found.");
  return loadPracticePaperWithSecret({ uid, paperId, paperData: snapshot.data() ?? {} });
}

export function mapPublicPracticePaperFromSnapshot(id: string, data: Record<string, unknown>) {
  return mapPracticePaperData(id, data);
}
