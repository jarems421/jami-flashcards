// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicExamAttempt } from "@/lib/practice/exam-projections";
import type { ExamSession, ExamSessionQuestion } from "@/lib/practice/exam-questions";

/**
 * Characterization tests for the past-paper session page.
 *
 * Written before the page was broken into components, to describe what it
 * already did: which layout a question is answered in, how a typed answer is
 * saved and sent, and what each state of the marking says.
 */

vi.mock("@/components/providers/UserProvider", () => ({
  useUser: () => ({ user: { uid: "student" } }),
}));
// A blank page, read back the way the sheet reads the real editor.
vi.mock("@/components/workspace/NotebookInkEditor", async () => {
  const React = await import("react");
  return {
    NotebookInkEditor: React.forwardRef<unknown, Record<string, unknown>>(function MockInkEditor(_props, ref) {
      React.useImperativeHandle(ref, () => ({
        clear: () => undefined,
        getHistoryState: () => ({ undoDepth: 0, redoDepth: 0 }),
        hasInk: () => false,
        isInteracting: () => false,
        redo: () => undefined,
        serialize: () => "",
        serializeAsync: async () => "",
        serializeWarm: () => "",
        setEraserMode: () => undefined,
        undo: () => undefined,
      }));
      return <div data-testid="ink-surface" />;
    }),
  };
});
vi.mock("@/components/practice/ExamSheetPageBackground", () => ({ default: () => null }));
vi.mock("@/components/practice/ExamQuestionAssets", () => ({ default: () => null }));
vi.mock("@/components/practice/ExamQuestionMarkReport", () => ({
  default: ({ attempt }: { attempt: { id: string } }) => <div data-testid="mark-report">{attempt.id}</div>,
}));
vi.mock("@/components/billing/AllowanceHint", () => ({ default: () => null }));
vi.mock("@/components/ai/JamiAssistantDrawer", () => ({ default: () => null }));
vi.mock("@/services/billing/plan-summary-store", () => ({ notifyAllowanceSpent: vi.fn() }));
vi.mock("@/services/study/notebooks", () => ({ getActiveNotebooks: vi.fn(async () => []) }));
vi.mock("@/services/study/exam-practice", () => ({
  ExamScratchpadTooLargeError: class ExamScratchpadTooLargeError extends Error {},
  loadExamScratchpad: vi.fn(async () => [] as string[]),
  saveExamScratchpad: vi.fn(async () => undefined),
  loadPastPaperPracticeSession: vi.fn(),
  saveExamAnswerDraft: vi.fn(async () => undefined),
  submitExamAnswer: vi.fn(),
  reviewExamAnswer: vi.fn(async () => undefined),
  finishPastPaperPracticeSession: vi.fn(async () => undefined),
  deletePastPaperPracticeAnswers: vi.fn(async () => undefined),
  saveExamAttemptToNotebook: vi.fn(async () => ({ notebookId: "notebook-1" })),
}));

const exam = await import("@/services/study/exam-practice");
const { default: ExamSessionWorkspace } = await import("@/components/practice/ExamSessionWorkspace");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function question(overrides: Partial<ExamSessionQuestion> = {}): ExamSessionQuestion {
  return {
    id: "q1",
    label: "1",
    prompt: "Explain why the sky is blue.",
    marks: 4,
    assets: [],
    difficulty: "medium",
    origin: "official_past_paper",
    provenance: {
      board: "aqa",
      boardLabel: "AQA",
      qualification: "gcse",
      specificationId: "aqa-physics",
      specificationTitle: "Physics",
      componentCode: "8463/1H",
      componentTitle: "Paper 1",
      year: 2023,
      series: "June",
      paperReference: "8463/1H",
      questionNumber: "1",
      sourceUrl: "",
      sourceSha256: "",
    },
    contentVersion: "v1",
    topicIds: [],
    attemptId: "s1_q1_1",
    ...overrides,
  };
}

function attempt(overrides: Partial<PublicExamAttempt> = {}): PublicExamAttempt {
  return {
    id: "s1_q1_1",
    userId: "student",
    sessionId: "s1",
    questionId: "q1",
    attemptNumber: 1,
    answerText: "",
    status: "draft",
    workingIncluded: false,
    reviewUsed: false,
    startedAt: 1,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function session(overrides: Partial<ExamSession> = {}): ExamSession {
  return {
    id: "s1",
    userId: "student",
    folderId: "folder-1",
    folderName: "Physics",
    subject: "Physics",
    studyLevel: "early-secondary",
    requestedMix: { easy: 0, medium: 1, hard: 0 },
    topicIds: [],
    questions: [question()],
    status: "active",
    answeredCount: 0,
    awardedTotal: 0,
    maxTotal: 4,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;
const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");

// jsdom lays nothing out, so the working sheet's frame is given a width to fit its page to.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("data-notebook-page-frame") ? 600 : 0;
    },
  });
});

afterAll(() => {
  if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
});

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function open(data: { session: ExamSession; attempts: PublicExamAttempt[] }) {
  vi.mocked(exam.loadPastPaperPracticeSession).mockResolvedValue(data);
  await act(async () => {
    root.render(<ExamSessionWorkspace sessionId="s1" />);
  });
  await settle();
  await settle();
}

function button(label: string) {
  return [...document.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.trim().startsWith(label)
  );
}

function answerBox() {
  const box = document.querySelector("textarea");
  if (!box) throw new Error("expected an answer box");
  return box;
}

async function type(text: string) {
  const box = answerBox();
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!setValue) throw new Error("textarea has no value setter");
  await act(async () => {
    setValue.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("answering a question with no paper of its own", () => {
  it("shows the question with its source, and the answer box beside it", async () => {
    await open({ session: session(), attempts: [attempt()] });

    expect(document.body.textContent).toContain("Question 1");
    expect(document.body.textContent).toContain("AQA · June 2023 · 8463/1H · Q1");
    expect(document.body.textContent).toContain("Your answer");
    expect(answerBox()).toBeDefined();
  });

  it("holds the mark button until there is something to send", async () => {
    await open({ session: session(), attempts: [attempt()] });
    expect(button("Mark answer")?.disabled).toBe(true);

    await type("Blue light scatters more.");
    expect(button("Mark answer")?.disabled).toBe(false);
  });

  it("saves a typed answer once typing pauses", async () => {
    await open({ session: session(), attempts: [attempt()] });
    vi.useFakeTimers();
    await type("Blue light scatters more.");
    expect(vi.mocked(exam.saveExamAnswerDraft)).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(vi.mocked(exam.saveExamAnswerDraft)).toHaveBeenCalledWith(
      "s1",
      "s1_q1_1",
      "Blue light scatters more.",
      undefined
    );
  });

  it("sends the latest typed answer to be marked", async () => {
    vi.mocked(exam.submitExamAnswer).mockResolvedValue({ attempt: attempt({ status: "marking" }) });
    await open({ session: session(), attempts: [attempt()] });
    await type("Blue light scatters more.");

    await act(async () => {
      button("Mark answer")?.click();
    });
    await settle();

    expect(vi.mocked(exam.submitExamAnswer)).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "s1",
        questionId: "q1",
        attemptNumber: 1,
        answerText: "Blue light scatters more.",
      })
    );
    expect(document.body.textContent).toContain("Jami is marking this one");
  });

  it("splits an answer into parts on request", async () => {
    await open({ session: session(), attempts: [attempt()] });
    await act(async () => {
      button("Answer in parts")?.click();
    });

    expect(document.querySelectorAll("textarea")).toHaveLength(2);
    expect(button("Add part (c)")).toBeDefined();
    expect(button("Use one box")).toBeDefined();
  });
});

describe("answering on the question's own sheet", () => {
  it("heads the sheet with the question and folds the typed answer away", async () => {
    await open({
      session: session({ questions: [question({ origin: "jami_generated" })] }),
      attempts: [attempt()],
    });

    expect(document.querySelector('section[aria-label="Answer sheet"] header')?.textContent).toContain(
      "Question 1"
    );
    expect(document.body.textContent).toContain("Jami-created · not from a past paper");
    expect(document.body.textContent).toContain("Type your answer");
    expect(document.body.textContent).toContain("Optional");
  });
});

describe("while and after an answer is marked", () => {
  it("says a marking is under way, and offers to run a stranded one again", async () => {
    await open({ session: session(), attempts: [attempt({ status: "marking" })] });
    expect(document.body.textContent).toContain("Jami is marking this one");
    expect(button("Mark it again")).toBeUndefined();

    act(() => root.unmount());
    root = createRoot(container);
    await open({ session: session(), attempts: [attempt({ status: "marking", updatedAt: 0 })] });
    expect(document.body.textContent).toContain("This one is taking too long");
    expect(button("Mark it again")).toBeDefined();
  });

  it("explains a failed marking and offers a retry when it could work", async () => {
    await open({
      session: session(),
      attempts: [
        attempt({
          status: "marking_failed",
          markingFailure: { code: "marking_failed", message: "The marker stopped part way.", at: 1 },
        }),
      ],
    });

    expect(document.body.textContent).toContain("Jami couldn't mark this one");
    expect(document.body.textContent).toContain("The marker stopped part way.");
    expect(button("Retry marking")).toBeDefined();
  });

  it("leads with the mark report once marked", async () => {
    await open({ session: session(), attempts: [attempt({ status: "marked", answerText: "Because." })] });

    expect(document.querySelector('[data-testid="mark-report"]')?.textContent).toBe("s1_q1_1");
    expect(document.querySelector('section[aria-label="Answer sheet"]')).toBeNull();
  });

  it("shows the session's score when it is finished", async () => {
    await open({
      session: session({ status: "completed", awardedTotal: 3, maxTotal: 4 }),
      attempts: [attempt({ status: "marked", answerText: "Because." })],
    });

    expect(document.body.textContent).toContain("Session complete");
    expect(document.body.textContent).toContain("3/4");
    expect(button("Delete my answers")).toBeDefined();
  });
});
