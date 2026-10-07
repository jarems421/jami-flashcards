// @vitest-environment jsdom

/*
 * The conversation itself: what a question sends, how the answer arrives,
 * what stops it, saved chats, attached files and the composer.
 *
 * Written against the drawer before it was split into hooks and smaller
 * components, so the split could be checked against what it already did.
 */

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JamiAssistantDrawer from "@/components/ai/JamiAssistantDrawer";
import type { JamiAssistantContext } from "@/lib/ai/jami-assistant";
import {
  getJamiAssistantContextKey,
  type JamiAssistantStoredMessage,
  type JamiAssistantThread,
} from "@/lib/ai/jami-assistant-history";
import type { TutorAttachment } from "@/lib/ai/tutor-attachments";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  getThreads: vi.fn(),
  getThreadMessages: vi.fn(),
  deleteThread: vi.fn(),
  renameThread: vi.fn(),
  upload: vi.fn(),
  discard: vi.fn(),
  hasAcknowledged: vi.fn(),
  acknowledge: vi.fn(),
  dictation: {
    supported: false,
    listening: false,
    start: vi.fn(),
    stop: vi.fn(() => ""),
  },
}));

vi.mock("@/services/ai/jami-assistant", () => ({
  sendJamiAssistantMessage: mocks.send,
}));

vi.mock("@/services/ai/jami-assistant-history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/ai/jami-assistant-history")>()),
  getJamiAssistantThreads: mocks.getThreads,
  getJamiAssistantThreadMessages: mocks.getThreadMessages,
  deleteJamiAssistantThread: mocks.deleteThread,
  renameJamiAssistantThread: mocks.renameThread,
}));

vi.mock("@/services/firebase/client", () => ({
  auth: { currentUser: { uid: "user-1", getIdToken: async () => "token" } },
}));

vi.mock("@/services/profile", () => ({
  loadReasoningEffort: vi.fn().mockResolvedValue("medium"),
  saveReasoningEffort: vi.fn().mockResolvedValue("medium"),
}));

vi.mock("@/services/ai/ai-privacy-notice", () => ({
  hasAcknowledgedAiPrivacyNotice: mocks.hasAcknowledged,
  acknowledgeAiPrivacyNotice: mocks.acknowledge,
}));

vi.mock("@/services/ai/tutor-attachments", () => ({
  uploadTutorAttachment: mocks.upload,
  discardTutorAttachment: mocks.discard,
  getTutorAttachmentUrl: vi.fn(() => new Promise(() => undefined)),
  saveTutorAttachmentAsSource: vi.fn(),
}));

vi.mock("@/services/study/folders", () => ({ getActiveStudyFolders: vi.fn().mockResolvedValue([]) }));

vi.mock("@/hooks/useVoiceDictation", () => ({
  useVoiceDictation: () => mocks.dictation,
}));

vi.mock("@/components/billing/AllowanceHint", () => ({ default: () => null }));

vi.mock("@/components/ai/TutorSettingsPanel", () => ({
  default: ({ activeFolderIds, onBack }: { activeFolderIds?: readonly string[]; onBack: () => void }) => (
    <div data-settings-panel>
      <span>{`folders: ${(activeFolderIds ?? []).join(",")}`}</span>
      <button type="button" onClick={onBack}>
        Back to chat
      </button>
    </div>
  ),
}));

// Stubbed to keep KaTeX and the lazy markdown renderer out of these tests.
vi.mock("@/components/ai/AiResponse", () => ({
  default: ({ content }: { content: string }) => <div data-ai-response>{content}</div>,
}));

const CONTEXT: JamiAssistantContext = { surface: "notebook", notebookId: "notebook-1", pageId: "page-1" };
const CONTEXT_KEY = getJamiAssistantContextKey(CONTEXT);

let container: HTMLDivElement;
let root: Root;
let getContext: ReturnType<typeof vi.fn<() => Promise<JamiAssistantContext>>>;

type DrawerProps = Partial<Parameters<typeof JamiAssistantDrawer>[0]>;

function drawer(props: DrawerProps = {}) {
  return (
    <JamiAssistantDrawer
      userId="user-1"
      open
      onOpenChange={vi.fn()}
      resetKey="reset-1"
      contextKey={CONTEXT_KEY}
      contextLabel="This page"
      historyContextLabel="this page"
      getContext={getContext}
      {...props}
    />
  );
}

async function render(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

function field() {
  const el = document.querySelector<HTMLTextAreaElement>("#jami-assistant-message");
  if (!el) throw new Error("no message field");
  return el;
}

function typeMessage(text: string) {
  const el = field();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function button(label: string | RegExp) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => {
    const name = candidate.getAttribute("aria-label") ?? candidate.textContent ?? "";
    return typeof label === "string" ? name === label : label.test(name);
  });
}

async function click(target: Element | undefined | null) {
  if (!target) throw new Error("nothing to click");
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function ask(text: string) {
  typeMessage(text);
  await click(button("Send message to Jami"));
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** A send that the test finishes by hand: streams, settles or fails. */
function deferredSend() {
  const call: {
    onChunk: (text: string) => void;
    signal: AbortSignal | undefined;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  } = { onChunk: () => undefined, signal: undefined, resolve: () => undefined, reject: () => undefined };
  mocks.send.mockImplementationOnce(
    (_input: unknown, onChunk: (text: string) => void, signal?: AbortSignal) =>
      new Promise((resolve, reject) => {
        call.onChunk = onChunk;
        call.signal = signal;
        call.resolve = resolve;
        call.reject = reject;
      })
  );
  return call;
}

function bodyText() {
  return document.body.textContent ?? "";
}

function thread(over: Partial<JamiAssistantThread> = {}): JamiAssistantThread {
  return {
    id: "thread-1",
    title: "Osmosis questions",
    surface: "notebook",
    contextKey: CONTEXT_KEY,
    contextLabel: "Biology notes",
    context: { surface: "notebook", notebookId: "notebook-1", pageId: "page-1" },
    lastMessagePreview: "",
    messageCount: 2,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function stored(over: Partial<JamiAssistantStoredMessage> & Pick<JamiAssistantStoredMessage, "id" | "role" | "text">): JamiAssistantStoredMessage {
  return { threadId: "thread-1", createdAt: 1, ...over };
}

const SHEET: TutorAttachment = {
  storagePath: "users/user-1/sourceFiles/chat/sheet.pdf",
  fileName: "sheet.pdf",
  fileType: "application/pdf",
  sizeBytes: 1_000,
};

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

beforeEach(() => {
  stubMatchMedia(false);
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
  mocks.send.mockReset();
  mocks.getThreads.mockReset().mockResolvedValue([]);
  mocks.getThreadMessages.mockReset().mockResolvedValue([]);
  mocks.deleteThread.mockReset().mockResolvedValue(undefined);
  mocks.renameThread.mockReset();
  mocks.upload.mockReset();
  mocks.discard.mockReset().mockResolvedValue(undefined);
  mocks.hasAcknowledged.mockReset().mockResolvedValue(true);
  mocks.acknowledge.mockReset().mockResolvedValue(undefined);
  mocks.dictation.supported = false;
  mocks.dictation.listening = false;
  mocks.dictation.start.mockReset();
  mocks.dictation.stop.mockReset().mockReturnValue("");
  getContext = vi.fn<() => Promise<JamiAssistantContext>>().mockResolvedValue(CONTEXT);
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("JamiAssistantDrawer sending a question", () => {
  it("sends the question with the chat so far, the context and the folder-sources choice", async () => {
    mocks.send.mockResolvedValueOnce({
      reply: "Water moves to the more concentrated side.",
      used: [{ kind: "current-context", label: "This page" }],
      savedThread: thread({ lastAssistantMessageId: "answer-1" }),
    });
    await render(drawer());

    await ask("  What is osmosis?  ");
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const [payload, onChunk, signal] = mocks.send.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(
      ["context", "contextLabel", "history", "message", "threadId", "useRelatedSources"].sort()
    );
    expect(payload).toEqual({
      message: "What is osmosis?",
      history: [],
      context: CONTEXT,
      useRelatedSources: true,
      threadId: undefined,
      contextLabel: "this page",
    });
    expect(typeof onChunk).toBe("function");
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    // The box is emptied for the next question.
    expect(field().value).toBe("");
    expect(bodyText()).toContain("Water moves to the more concentrated side.");
    expect(bodyText()).toContain("Used: This page");

    mocks.send.mockResolvedValueOnce({ reply: "Yes, through a membrane.", used: [] });
    await ask("Does it need a membrane?");
    expect(mocks.send.mock.calls[1][0]).toEqual({
      message: "Does it need a membrane?",
      history: [
        { role: "user", text: "What is osmosis?" },
        { role: "model", text: "Water moves to the more concentrated side." },
      ],
      context: CONTEXT,
      useRelatedSources: true,
      threadId: "thread-1",
      contextLabel: "this page",
    });
    // An answer with nothing to show for where it came from says so.
    expect(bodyText()).toContain("Used: General knowledge");
  });

  it("sends only the most recent forty messages as history", async () => {
    await render(drawer());
    for (let turn = 1; turn <= 21; turn += 1) {
      mocks.send.mockResolvedValueOnce({ reply: `Answer ${turn}`, used: [] });
      await ask(`Question ${turn}`);
    }
    mocks.send.mockResolvedValueOnce({ reply: "Last answer", used: [] });
    await ask("Last question");
    const history = mocks.send.mock.calls[21][0].history as { role: string; text: string }[];
    expect(history).toHaveLength(40);
    expect(history[0]).toEqual({ role: "user", text: "Question 2" });
    expect(history.at(-1)).toEqual({ role: "model", text: "Answer 21" });
  });

  it("sends on Enter, and Shift+Enter starts a new line instead", async () => {
    mocks.send.mockResolvedValue({ reply: "Sure.", used: [] });
    await render(drawer());
    typeMessage("Line one");
    await act(async () => {
      field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    });
    expect(mocks.send).not.toHaveBeenCalled();

    await act(async () => {
      field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][0].message).toBe("Line one");
  });

  it("sends the folder-sources choice the student made", async () => {
    mocks.send.mockResolvedValue({ reply: "Sure.", used: [] });
    await render(drawer());
    expect(bodyText()).toContain("Folder sources on");
    const toggle = document.querySelector<HTMLButtonElement>("button[role='switch'][aria-label='Use folder sources']");
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    await click(toggle);
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    expect(bodyText()).toContain("Folder sources off");

    await ask("Only from this page please");
    expect(mocks.send.mock.calls[0][0].useRelatedSources).toBe(false);
  });

  it("offers starting points before the chat begins: a prompt sends, an action runs", async () => {
    mocks.send.mockResolvedValue({ reply: "Here is a hint.", used: [] });
    const run = vi.fn();
    await render(
      drawer({
        quickActions: ["Give me a hint", { label: "Explain it", prompt: "Explain this step by step." }, { label: "Draft cards", run }],
        emptyStateNote: "Jami reads this page only.",
      })
    );
    expect(bodyText()).toContain("How can I help?");
    expect(bodyText()).toContain("Jami reads this page only.");

    await click(button("Draft cards"));
    expect(run).toHaveBeenCalledTimes(1);
    expect(mocks.send).not.toHaveBeenCalled();

    typeMessage("half-typed");
    await click(button("Explain it"));
    expect(mocks.send.mock.calls[0][0].message).toBe("Explain this step by step.");
    // A starting point clears whatever was half-typed.
    expect(field().value).toBe("");
    expect(bodyText()).not.toContain("How can I help?");
  });

  it("follows up from the last answer only", async () => {
    mocks.send.mockResolvedValueOnce({
      reply: "First answer.",
      used: [],
      followUps: [{ label: "Explain more", prompt: "Explain that in more detail." }],
    });
    await render(drawer());
    await ask("First question");
    expect(button("Explain more")).toBeDefined();

    mocks.send.mockResolvedValueOnce({
      reply: "Second answer.",
      used: [],
      followUps: [{ label: "Try one", prompt: "Give me one to try." }],
    });
    await click(button("Explain more"));
    expect(mocks.send.mock.calls[1][0].message).toBe("Explain that in more detail.");
    expect(button("Explain more")).toBeUndefined();
    expect(button("Try one")).toBeDefined();
  });
});

describe("JamiAssistantDrawer while an answer is written", () => {
  it("waits, then streams, then settles on the checked reply", async () => {
    const call = deferredSend();
    await render(drawer());
    await ask("Why does ice float?");
    expect(bodyText()).toContain("Jami is locking in");
    expect(field().disabled).toBe(true);
    expect(button("Send message to Jami")?.disabled).toBe(true);

    await act(async () => call.onChunk("Ice is less"));
    expect(bodyText()).toContain("Ice is less");
    expect(bodyText()).not.toContain("Jami is locking in");

    await act(async () => call.onChunk("Ice is less dense than water"));
    expect(document.querySelectorAll("[data-ai-response]")).toHaveLength(1);

    await act(async () => call.resolve({ reply: "Ice is less dense than water, so it floats.", used: [] }));
    const answers = [...document.querySelectorAll("[data-ai-response]")].map((node) => node.textContent);
    expect(answers).toEqual(["Ice is less dense than water, so it floats."]);
    expect(field().disabled).toBe(false);
  });

  it("escalates the waiting line as the wait goes on", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    deferredSend();
    await render(drawer());
    await ask("A hard one");
    expect(bodyText()).toContain("Jami is locking in");
    await act(async () => vi.advanceTimersByTime(4_000));
    expect(bodyText()).toContain("Cooking");
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(bodyText()).toContain("Ok this one is actually hard");
    await act(async () => vi.advanceTimersByTime(9_000));
    expect(bodyText()).toContain("Reading it again, properly this time");
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(bodyText()).toContain("Nearly there, promise");
  });

  it("drops a half-written answer when the stream fails, and lets the error be dismissed", async () => {
    const call = deferredSend();
    await render(drawer());
    await ask("Explain entropy");
    await act(async () => call.onChunk("Entropy is a measure"));
    await act(async () => call.reject(new Error("The answer was cut off.")));

    expect(bodyText()).not.toContain("Entropy is a measure");
    expect(bodyText()).toContain("Explain entropy");
    const alert = document.querySelector("[role='alert']");
    expect(alert?.textContent).toContain("The answer was cut off.");
    await click(button("Dismiss"));
    expect(document.querySelector("[role='alert']")).toBeNull();
  });

  it("says something generic when the failure has no message", async () => {
    mocks.send.mockRejectedValueOnce("nope");
    await render(drawer());
    await ask("Anything");
    expect(bodyText()).toContain("Jami could not answer that just now. Please try again.");
  });

  it("stops the answer when a new chat is started, without reporting it as a failure", async () => {
    const call = deferredSend();
    await render(drawer());
    await ask("A long question");
    await act(async () => call.onChunk("Part of"));

    await click(button("Start a new Jami chat"));
    expect(call.signal?.aborted).toBe(true);
    expect(bodyText()).toContain("How can I help?");

    await act(async () => call.reject(new DOMException("Aborted", "AbortError")));
    expect(document.querySelector("[role='alert']")).toBeNull();
    expect(bodyText()).not.toContain("Part of");
    // Ready for the next question straight away.
    expect(field().disabled).toBe(false);
  });

  it("ignores an answer that lands after the chat was cleared", async () => {
    const call = deferredSend();
    await render(drawer());
    await ask("A slow question");
    await click(button("Start a new Jami chat"));
    await act(async () => call.resolve({ reply: "Too late.", used: [] }));
    expect(bodyText()).not.toContain("Too late.");
    expect(bodyText()).toContain("How can I help?");
  });

  it("stops the answer, clears the chat and closes when the surface moves on", async () => {
    const call = deferredSend();
    const onOpenChange = vi.fn();
    await render(drawer({ onOpenChange }));
    await ask("About this card");
    await render(drawer({ onOpenChange, resetKey: "reset-2", open: false }));
    expect(call.signal?.aborted).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await render(drawer({ onOpenChange, resetKey: "reset-2" }));
    expect(bodyText()).toContain("How can I help?");
    expect(bodyText()).not.toContain("About this card");
  });

  it("stops the answer when the drawer goes away", async () => {
    const call = deferredSend();
    await render(drawer());
    await ask("A question nobody will see answered");
    act(() => root.unmount());
    expect(call.signal?.aborted).toBe(true);
    // afterEach unmounts a root, so leave it a fresh one.
    root = createRoot(container);
  });

  it("keeps writing the answer while the drawer is put away", async () => {
    const call = deferredSend();
    await render(drawer());
    await ask("Keep going while I write");
    await render(drawer({ open: false }));
    expect(call.signal?.aborted).toBe(false);
    await act(async () => call.resolve({ reply: "Here it is.", used: [] }));
    await render(drawer());
    expect(bodyText()).toContain("Here it is.");
  });
});

describe("JamiAssistantDrawer saved chats", () => {
  const here = thread({ id: "thread-here", title: "Osmosis questions" });
  const elsewhere = thread({
    id: "thread-elsewhere",
    title: "Mitosis card",
    surface: "learn",
    contextKey: "learn:card-9",
    contextLabel: "Mitosis flashcard",
    context: { surface: "learn", cardId: "card-9" },
  });

  it("offers to continue the latest chat from this place, and carries it on", async () => {
    mocks.getThreads.mockResolvedValue([here, elsewhere]);
    mocks.getThreadMessages.mockResolvedValue([
      stored({ id: "q1", role: "user", text: "What is osmosis?" }),
      stored({ id: "a1", role: "assistant", text: "Movement of water.", used: [] }),
    ]);
    await render(drawer());
    await settle();

    await click(button("Continue Osmosis questions"));
    expect(mocks.getThreadMessages).toHaveBeenCalledWith("user-1", "thread-here");
    expect(bodyText()).toContain("Movement of water.");

    mocks.send.mockResolvedValueOnce({ reply: "Yes.", used: [] });
    await ask("Through a membrane?");
    expect(mocks.send.mock.calls[0][0]).toMatchObject({
      threadId: "thread-here",
      history: [
        { role: "user", text: "What is osmosis?" },
        { role: "model", text: "Movement of water." },
      ],
    });
  });

  it("opens the history list, switches chats and starts a new one", async () => {
    mocks.getThreads.mockResolvedValue([here, elsewhere]);
    mocks.getThreadMessages.mockResolvedValue([
      stored({ id: "q1", role: "user", text: "What happens in prophase?", threadId: "thread-elsewhere" }),
      stored({ id: "a1", role: "assistant", text: "Chromosomes condense.", threadId: "thread-elsewhere" }),
    ]);
    await render(drawer());
    await settle();

    await click(button("Open Jami chat history"));
    expect(document.querySelector("section[aria-label='Jami chat history']")).not.toBeNull();
    expect(bodyText()).toContain("Saved chats keep their messages and the files you attached, not notebook snapshots.");
    expect(document.querySelector("#jami-assistant-message")).toBeNull();
    expect(button("Return to current Jami chat")).toBeDefined();

    const open = [...document.querySelectorAll<HTMLButtonElement>("section[aria-label='Jami chat history'] button")].find(
      (candidate) => candidate.textContent?.startsWith("Mitosis card")
    );
    await click(open);
    expect(mocks.getThreadMessages).toHaveBeenCalledWith("user-1", "thread-elsewhere");
    expect(document.querySelector("section[aria-label='Jami chat history']")).toBeNull();
    expect(bodyText()).toContain("Chromosomes condense.");
    expect(bodyText()).toContain("Carrying on a saved chat");
    expect(bodyText()).toContain(
      "This chat started on your flashcards (Mitosis flashcard). Carry on here and Jami picks it up, now with this page in front of it."
    );

    await click(button("Start a new Jami chat"));
    expect(bodyText()).toContain("How can I help?");
    expect(bodyText()).not.toContain("Carrying on a saved chat");
  });

  it("lets the student write again after opening a saved chat mid-answer", async () => {
    mocks.getThreads.mockResolvedValue([here, elsewhere]);
    mocks.getThreadMessages.mockResolvedValue([
      stored({ id: "q1", role: "user", text: "What happens in prophase?", threadId: "thread-elsewhere" }),
      stored({ id: "a1", role: "assistant", text: "Chromosomes condense.", threadId: "thread-elsewhere" }),
    ]);
    const call = deferredSend();
    await render(drawer());
    await settle();
    await ask("A question still being answered");

    await click(button("Open Jami chat history"));
    const open = [...document.querySelectorAll<HTMLButtonElement>("section[aria-label='Jami chat history'] button")].find(
      (candidate) => candidate.textContent?.startsWith("Mitosis card")
    );
    await click(open);

    expect(call.signal?.aborted).toBe(true);
    expect(bodyText()).toContain("Chromosomes condense.");
    expect(field().disabled).toBe(false);
  });

  it("says when a saved chat cannot be opened", async () => {
    mocks.getThreads.mockResolvedValue([here]);
    mocks.getThreadMessages.mockRejectedValue(new Error("That chat is unavailable."));
    await render(drawer());
    await settle();
    await click(button("Open Jami chat history"));
    const open = [...document.querySelectorAll<HTMLButtonElement>("section[aria-label='Jami chat history'] button")].find(
      (candidate) => candidate.textContent?.startsWith("Osmosis questions")
    );
    await click(open);
    expect(document.querySelector("section[aria-label='Jami chat history'] [role='alert']")?.textContent).toContain(
      "That chat is unavailable."
    );
  });

  it("starts a new chat when the open one is deleted", async () => {
    mocks.getThreads.mockResolvedValue([here]);
    mocks.getThreadMessages.mockResolvedValue([
      stored({ id: "q1", role: "user", text: "Old question", threadId: "thread-here" }),
      stored({ id: "a1", role: "assistant", text: "Old answer", threadId: "thread-here" }),
    ]);
    await render(drawer());
    await settle();
    await click(button("Continue Osmosis questions"));
    expect(bodyText()).toContain("Old answer");

    await click(button("Open Jami chat history"));
    const history = document.querySelector("section[aria-label='Jami chat history']");
    const remove = [...(history?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (candidate) => candidate.textContent?.trim() === "Delete"
    );
    await click(remove);
    const confirm = [...(history?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (candidate) => candidate.textContent?.trim() === "Delete"
    );
    await click(confirm);
    expect(mocks.deleteThread).toHaveBeenCalledWith("user-1", "thread-here");
    expect(document.querySelector("section[aria-label='Jami chat history']")).toBeNull();
    expect(bodyText()).toContain("How can I help?");
  });

  it("opens on the list of saved chats when asked to", async () => {
    await render(drawer({ startInHistory: true }));
    expect(document.querySelector("section[aria-label='Jami chat history']")).not.toBeNull();
    expect(bodyText()).toContain("Chat history");
  });
});

describe("JamiAssistantDrawer attached files", () => {
  async function attach(file: File) {
    const input = document.querySelector<HTMLInputElement>("input[type='file']");
    if (!input) throw new Error("no file input");
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
  }

  it("sends a file with the question, and asks Tutor to look when nothing is typed", async () => {
    mocks.upload.mockResolvedValue(SHEET);
    mocks.send.mockResolvedValueOnce({ reply: "Question 2 is about rates.", used: [] });
    await render(drawer());
    expect(button("Send message to Jami")?.disabled).toBe(true);

    await attach(new File(["%PDF"], "sheet.pdf", { type: "application/pdf" }));
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1" }));
    expect(button("Send message to Jami")?.disabled).toBe(false);

    await click(button("Send message to Jami"));
    expect(mocks.send.mock.calls[0][0]).toMatchObject({
      message: "Take a look at what I've attached.",
      attachments: [SHEET],
      newAttachmentCount: 1,
    });
    expect(bodyText()).toContain("sheet.pdf");

    mocks.send.mockResolvedValueOnce({ reply: "It is.", used: [] });
    await ask("Is question 3 the same?");
    // Earlier files stay with the chat, but are not new to this message.
    expect(mocks.send.mock.calls[1][0]).toMatchObject({ attachments: [SHEET], newAttachmentCount: 0 });
  });

  it("carries a failed question's files on the next one, as new", async () => {
    mocks.upload.mockResolvedValue(SHEET);
    mocks.send.mockRejectedValueOnce(new Error("Jami is unavailable."));
    await render(drawer());
    await attach(new File(["%PDF"], "sheet.pdf", { type: "application/pdf" }));
    typeMessage("What is this?");
    await click(button("Send message to Jami"));
    expect(bodyText()).toContain("Jami is unavailable.");

    mocks.send.mockResolvedValueOnce({ reply: "A rates sheet.", used: [] });
    await ask("Try again");
    expect(mocks.send.mock.calls[1][0]).toMatchObject({ attachments: [SHEET], newAttachmentCount: 1 });
  });

  it("attaches a pasted screenshot or a dropped file", async () => {
    mocks.upload.mockResolvedValue(SHEET);
    await render(drawer());
    const screenshot = new File(["png"], "shot.png", { type: "image/png" });
    URL.createObjectURL = vi.fn(() => "blob:shot");
    URL.revokeObjectURL = vi.fn();
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { files: [screenshot] } });
    await act(async () => {
      field().dispatchEvent(paste);
    });
    expect(paste.defaultPrevented).toBe(true);
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ file: screenshot }));

    const dropped = new File(["%PDF"], "notes.pdf", { type: "application/pdf" });
    const composer = field().parentElement;
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { files: [dropped], types: ["Files"] } });
    await act(async () => {
      composer?.dispatchEvent(drop);
    });
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ file: dropped }));
  });
});

describe("JamiAssistantDrawer composer", () => {
  it("dictates into the box and sends what the recogniser settled", async () => {
    mocks.dictation.supported = true;
    mocks.send.mockResolvedValue({ reply: "Sure.", used: [] });
    await render(drawer());
    typeMessage("Typed first");
    await click(button("Dictate your message"));
    expect(mocks.dictation.start).toHaveBeenCalledWith("Typed first");

    mocks.dictation.listening = true;
    mocks.dictation.stop.mockReturnValue("Typed first and then spoken");
    await render(drawer());
    expect(button("Stop dictating")?.getAttribute("aria-pressed")).toBe("true");
    expect(bodyText()).toContain("Listening. Stop to edit what you said, or send it straight away.");

    await click(button("Send message to Jami"));
    expect(mocks.dictation.stop).toHaveBeenCalled();
    expect(mocks.send.mock.calls[0][0].message).toBe("Typed first and then spoken");
  });

  it("stops dictating on a second press and hands the box back", async () => {
    mocks.dictation.supported = true;
    mocks.dictation.listening = true;
    await render(drawer());
    await click(button("Stop dictating"));
    expect(mocks.dictation.stop).toHaveBeenCalledTimes(1);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field());
  });

  it("shows the privacy notice until it is understood", async () => {
    mocks.hasAcknowledged.mockResolvedValue(false);
    await render(drawer());
    await settle();
    expect(bodyText()).toContain("When you use Jami, relevant work may be processed through OpenRouter");
    await click(button("I understand"));
    expect(mocks.acknowledge).toHaveBeenCalledTimes(1);
    expect(bodyText()).not.toContain("When you use Jami, relevant work may be processed through OpenRouter");
  });

  it("opens settings over the chat with the folders in force, and comes back", async () => {
    await render(drawer({ settingsFolderIds: ["folder-a", "folder-b"] }));
    await click(button("Open Jami settings"));
    expect(document.querySelector("[data-settings-panel]")?.textContent).toContain("folders: folder-a,folder-b");
    await click(button("Back to chat"));
    expect(document.querySelector("[data-settings-panel]")).toBeNull();
  });

  it("is a full-screen dialog as a page, and a side panel on a wide screen", async () => {
    await render(drawer({ layout: "page" }));
    expect(document.querySelector("[role='dialog']")?.getAttribute("aria-modal")).toBe("true");
    expect(document.querySelector("[role='dialog']")?.className).toContain("max-w-4xl");

    act(() => root.unmount());
    stubMatchMedia(true);
    root = createRoot(container);
    await render(drawer());
    const panel = document.querySelector<HTMLElement>("[role='dialog']");
    expect(panel?.getAttribute("aria-modal")).toBeNull();
    expect(panel?.className).toContain("max-w-[32rem]");
    expect(panel?.style.backgroundColor).toBe("var(--color-surface-base)");
  });
});
