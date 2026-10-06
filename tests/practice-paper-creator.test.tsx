// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PracticePaperJob } from "@/lib/practice/practice-papers";
import type { StudyFolder } from "@/lib/workspace/study-folders";

/**
 * Characterization tests for the practice paper builder.
 *
 * Written before the builder was broken into components, to describe what it
 * already did: what a described exam asks Jami for, how a paper request in
 * progress, failed or waiting on an answer is shown and resumed, and how an
 * uploaded paper is made.
 */

// One router for the whole render, as Next.js gives: the builder's effects depend on it.
const router = vi.hoisted(() => ({ push: vi.fn() }));
const push = router.push;
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/providers/UserProvider", () => ({ useUser: () => ({ user: { uid: "student" } }) }));
vi.mock("@/components/billing/AllowanceHint", () => ({ default: () => null }));
vi.mock("@/services/billing/plan-summary-store", () => ({ notifyAllowanceSpent: vi.fn() }));
vi.mock("@/services/ai/practice-papers", () => ({
  acknowledgePracticePaperJob: vi.fn(async () => undefined),
  cancelPracticePaperJob: vi.fn(),
  clarifyPracticePaperJob: vi.fn(),
  confirmPracticePaperFormat: vi.fn(),
  createPracticePaperJob: vi.fn(),
  getPracticePaperJob: vi.fn(),
  retryPracticePaperJob: vi.fn(),
}));
vi.mock("@/services/study/folders", () => ({
  getActiveStudyFolders: vi.fn(),
  updateStudyFolder: vi.fn(async () => undefined),
}));
vi.mock("@/services/study/sources", () => ({
  getActiveSources: vi.fn(async () => []),
  getActiveSourcesForFolderPage: vi.fn(async () => ({ items: [] })),
  deleteSource: vi.fn(async () => undefined),
  updateSource: vi.fn(async () => undefined),
}));
vi.mock("@/services/study/source-upload", () => ({ createUploadedSource: vi.fn() }));
vi.mock("@/services/study/source-files", () => ({ deleteSourceFile: vi.fn(async () => undefined) }));
vi.mock("@/services/study/notebook-import", () => ({
  importUploadedNotebook: vi.fn(async () => ({
    notebook: { id: "notebook-1", folderId: "folder-1", title: "June 2023 Paper 1" },
    file: { storagePath: "uploads/paper.pdf" },
  })),
}));
vi.mock("@/services/study/notebook-files", () => ({ deleteNotebookFile: vi.fn(async () => undefined) }));
vi.mock("@/services/study/notebooks", () => ({ deleteNotebookImportRecords: vi.fn(async () => undefined) }));
vi.mock("@/services/study/practice-papers", () => ({ createUploadedPracticePaper: vi.fn(async () => undefined) }));
vi.mock("@/services/study/exam-practice", () => ({ getExamCourseOptions: vi.fn(async () => []) }));

const papers = await import("@/services/ai/practice-papers");
const folders = await import("@/services/study/folders");
const notebookImport = await import("@/services/study/notebook-import");
const uploadedPapers = await import("@/services/study/practice-papers");
const { default: PracticePaperCreator } = await import("@/components/practice/PracticePaperCreator");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function folder(overrides: Partial<StudyFolder> = {}): StudyFolder {
  return {
    id: "folder-1",
    name: "Analysis",
    subject: "Analysis 3",
    studyLevel: "undergraduate",
    topicIds: [],
    tutorInstructions: "",
    tutorInstructionsUpdatedAt: 0,
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    ...overrides,
  };
}

function job(overrides: Partial<PracticePaperJob> = {}): PracticePaperJob {
  return {
    id: "job-1",
    paperId: "paper-1",
    folderId: "folder-1",
    status: "queued",
    stage: "queued",
    progress: 5,
    title: "Analysis 3 practice final exam",
    failureDismissed: false,
    cancellationRequested: false,
    readyUnread: false,
    retryCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function open() {
  await act(async () => {
    root.render(<PracticePaperCreator />);
  });
  await settle();
  await settle();
}

function button(label: string) {
  return [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim().startsWith(label));
}

async function click(label: string) {
  const target = button(label);
  expect(target, `expected a button labelled "${label}"`).toBeDefined();
  await act(async () => {
    target?.click();
  });
  await settle();
}

function field(label: string) {
  const labelElement = [...document.querySelectorAll("label")].find((candidate) => candidate.textContent?.trim() === label);
  const id = labelElement?.getAttribute("for");
  const control = id ? document.getElementById(id) : null;
  if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) {
    throw new Error(`expected a field labelled "${label}"`);
  }
  return control;
}

async function type(label: string, text: string) {
  const control = field(label);
  const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setValue = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setValue) throw new Error("field has no value setter");
  await act(async () => {
    setValue.call(control, text);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function chooseFile(label: string, file: File) {
  const control = field(label);
  Object.defineProperty(control, "files", { configurable: true, value: [file] });
  await act(async () => {
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/dashboard/practice/papers/new");
  vi.mocked(folders.getActiveStudyFolders).mockResolvedValue([folder()]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("the practice paper builder", () => {
  it("asks for a study folder before anything else", async () => {
    vi.mocked(folders.getActiveStudyFolders).mockResolvedValue([]);
    await open();

    expect(document.body.textContent).toContain("Create a study folder first");
  });

  it("asks Jami for a described exam in the student's own terms", async () => {
    vi.mocked(papers.createPracticePaperJob).mockResolvedValue(job());
    await open();

    expect(field("Module").value).toBe("Analysis 3");
    await click("Generate practice paper");

    expect(vi.mocked(papers.createPracticePaperJob)).toHaveBeenCalledWith(
      expect.objectContaining({
        folderId: "folder-1",
        request: "A complete practice final exam for Analysis 3, in the format that exam uses.",
        coverage: "Everything taught in the module",
        timingMode: "timed",
        tutorEnabled: false,
        sourceIds: [],
      }),
      expect.any(String),
      []
    );
    expect(document.body.textContent).toContain("Queued");
    expect(button("Cancel")).toBeDefined();
  });

  it("reopens a failed request and tries it again", async () => {
    window.history.replaceState(null, "", "/dashboard/practice/papers/new?job=job-1");
    vi.mocked(papers.getPracticePaperJob).mockResolvedValue(
      job({ status: "failed", failureMessage: "The provider timed out." })
    );
    vi.mocked(papers.retryPracticePaperJob).mockResolvedValue(job({ status: "running", stage: "designing" }));
    await open();

    expect(document.body.textContent).toContain("This paper could not be built");
    expect(document.body.textContent).toContain("The provider timed out.");
    await click("Try again");

    expect(vi.mocked(papers.retryPracticePaperJob)).toHaveBeenCalledWith("job-1");
    expect(document.body.textContent).toContain("Designing the paper");
  });

  it("asks Jami's question and resumes with the answer", async () => {
    window.history.replaceState(null, "", "/dashboard/practice/papers/new?job=job-1");
    vi.mocked(papers.getPracticePaperJob).mockResolvedValue(
      job({ status: "needs_clarification", clarificationQuestion: "Is the exam calculator or non-calculator?" })
    );
    vi.mocked(papers.clarifyPracticePaperJob).mockResolvedValue(job({ status: "running" }));
    await open();

    expect(document.body.textContent).toContain("Is the exam calculator or non-calculator?");
    await type("Your answer", "Calculator");
    await click("Answer and continue");

    expect(vi.mocked(papers.clarifyPracticePaperJob)).toHaveBeenCalledWith("job-1", "Calculator");
  });

  it("makes an uploaded paper and opens it", async () => {
    await open();
    await click("Upload a paper");
    await click("Create uploaded paper");
    expect(document.body.textContent).toContain("Choose a folder, name the paper, and add the paper file.");

    await type("Paper title", "June 2023 Paper 1");
    await chooseFile("Paper file", new File(["%PDF"], "paper.pdf", { type: "application/pdf" }));
    await click("Create uploaded paper");

    expect(vi.mocked(notebookImport.importUploadedNotebook)).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "student", folderId: "folder-1", title: "June 2023 Paper 1" })
    );
    expect(vi.mocked(uploadedPapers.createUploadedPracticePaper)).toHaveBeenCalledWith(
      expect.objectContaining({ sourceIds: [], timingMode: "timed", tutorEnabled: false })
    );
    expect(push).toHaveBeenCalledWith("/dashboard/notebooks/notebook-1");
  });
});
