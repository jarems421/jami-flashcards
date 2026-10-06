// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import JamiAssistantDrawer from "@/components/ai/JamiAssistantDrawer";
import type { JamiAssistantContext } from "@/lib/ai/jami-assistant";
import { getJamiAssistantContextKey } from "@/lib/ai/jami-assistant-history";

const sendJamiAssistantMessage = vi.fn();
const listJamiAssistantThreads = vi.fn();

vi.mock("@/services/ai/jami-assistant", () => ({
  sendJamiAssistantMessage: (...args: unknown[]) =>
    sendJamiAssistantMessage(...args),
}));

vi.mock("@/services/ai/jami-assistant-history", () => ({
  listJamiAssistantThreads: (...args: unknown[]) =>
    listJamiAssistantThreads(...args),
  saveJamiAssistantThread: vi.fn().mockResolvedValue(undefined),
  deleteJamiAssistantThread: vi.fn().mockResolvedValue(undefined),
  renameJamiAssistantThread: vi.fn().mockResolvedValue(undefined),
  loadJamiAssistantThread: vi.fn().mockResolvedValue(null),
}));

const requestTutorStudyMaterial = vi.fn();

vi.mock("@/services/ai/tutor-study-material", () => ({
  requestTutorStudyMaterial: (...args: unknown[]) => requestTutorStudyMaterial(...args),
}));

vi.mock("@/services/firebase/client", () => ({
  auth: { currentUser: { uid: "user-1" } },
}));

vi.mock("@/services/profile", () => ({
  loadReasoningEffort: vi.fn().mockResolvedValue("medium"),
  saveReasoningEffort: vi.fn().mockResolvedValue("medium"),
}));

// Stubbed to keep KaTeX and the lazy markdown renderer out of these tests.
vi.mock("@/components/ai/AiResponse", () => ({
  default: ({ content }: { content: string }) => (
    <div data-ai-response>{content}</div>
  ),
}));

const CONTEXT = {
  surface: "notebook",
  notebookId: "notebook-1",
  pageId: "page-1",
} as unknown as JamiAssistantContext;

// Derived rather than written out, so the test cannot drift from the key the
// drawer actually compares against.
const CONTEXT_KEY = getJamiAssistantContextKey(CONTEXT);

let container: HTMLDivElement;
let root: Root;
let getContext: Mock<() => Promise<JamiAssistantContext>>;

function render(over: Partial<{ contextKey: string }> = {}) {
  act(() => {
    root.render(
      <JamiAssistantDrawer
        userId="user-1"
        open
        onOpenChange={vi.fn()}
        resetKey="reset-1"
        contextKey={over.contextKey ?? CONTEXT_KEY}
        contextLabel="This page"
        historyContextLabel="this page"
        getContext={getContext}
      />
    );
  });
}

function field() {
  return document.querySelector<HTMLTextAreaElement>("textarea");
}

function typeMessage(text: string) {
  const el = field();
  if (!el) throw new Error("no message field");
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function sendButton() {
  return [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label")?.match(/send/i) || b.type === "submit"
  );
}

beforeEach(() => {
  // jsdom ships no matchMedia; the drawer uses it to pick side-panel layout.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));

  // jsdom implements no scrolling; the drawer keeps the newest turn in view.
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();

  sendJamiAssistantMessage.mockReset();
  listJamiAssistantThreads.mockReset().mockResolvedValue([]);
  getContext = vi.fn().mockResolvedValue(CONTEXT);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("JamiAssistantDrawer", () => {
  it("inline, carries the conversation in a card in the page rather than a dialog over it", async () => {
    const onOpenChange = vi.fn();
    act(() => {
      root.render(
        <JamiAssistantDrawer
          layout="inline"
          userId="user-1"
          open
          onOpenChange={onOpenChange}
          resetKey="reset-1"
          contextKey={CONTEXT_KEY}
          contextLabel="This page"
          historyContextLabel="this page"
          getContext={getContext}
        />
      );
    });
    // In the page where it was rendered, not portalled into a dialog.
    const card = container.querySelector("section[aria-label=\"Jami chat\"]");
    expect(card).not.toBeNull();
    expect(document.querySelector("[role=\"dialog\"]")).toBeNull();
    expect(card?.querySelector("h2")?.textContent).toBe("Jami");
    // The reply box is ready for the next question.
    expect(document.activeElement).toBe(card?.querySelector("textarea"));
    // Closing hands back to the page.
    const close = [...(card?.querySelectorAll("button") ?? [])].find((button) => button.getAttribute("aria-label") === "Close Jami assistant");
    act(() => close?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("will not send an empty or whitespace-only message", async () => {
    render();
    typeMessage("   ");
    const send = sendButton();
    await act(async () => {
      send?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(sendJamiAssistantMessage).not.toHaveBeenCalled();
  });

  it("refuses to answer when the notebook changed under the question", async () => {
    // Page turns keep one notebook conversation; changing notebooks does not.
    getContext.mockResolvedValue({
      ...CONTEXT,
      notebookId: "notebook-2",
    } as JamiAssistantContext);
    render({ contextKey: CONTEXT_KEY });

    typeMessage("What does this say?");
    await act(async () => {
      sendButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Answering against the wrong page is worse than refusing.
    expect(sendJamiAssistantMessage).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/study context changed/i);
  });

  it("surfaces a failure instead of leaving the question hanging", async () => {
    sendJamiAssistantMessage.mockRejectedValue(new Error("Jami is unavailable."));
    render();

    typeMessage("Explain this");
    await act(async () => {
      sendButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(sendJamiAssistantMessage).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toMatch(/unavailable/i);
  });

  it("ignores a second send while the first is still in flight", async () => {
    let release: (value: unknown) => void = () => undefined;
    sendJamiAssistantMessage.mockImplementation(
      () => new Promise((resolve) => {
        release = resolve;
      })
    );
    render();

    typeMessage("First question");
    await act(async () => {
      sendButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    typeMessage("Second question");
    await act(async () => {
      sendButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Double-sending would bill a second request and interleave two answers.
    expect(sendJamiAssistantMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ reply: "Answered.", followUps: [], used: [] });
    });
  });

  it("keeps the question on screen while the answer is being written", async () => {
    let release: (value: unknown) => void = () => undefined;
    sendJamiAssistantMessage.mockImplementation(
      () => new Promise((resolve) => {
        release = resolve;
      })
    );
    render();

    typeMessage("Why is this wrong?");
    await act(async () => {
      sendButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.body.textContent).toContain("Why is this wrong?");

    await act(async () => {
      release({ reply: "Because of the sign.", followUps: [], used: [] });
    });
    expect(document.body.textContent).toContain("Because of the sign.");
  });

  it("sends what was asked elsewhere once, as soon as it opens", async () => {
    sendJamiAssistantMessage.mockResolvedValue({ reply: "Enzymes speed reactions up.", followUps: [], used: [] });
    const drawer = (
      <JamiAssistantDrawer
        userId="user-1"
        open
        onOpenChange={vi.fn()}
        resetKey="reset-1"
        contextKey={CONTEXT_KEY}
        contextLabel="Enzymes notes"
        historyContextLabel="Enzymes notes"
        getContext={getContext}
        initialMessage="What do enzymes do?"
      />
    );
    await act(async () => {
      root.render(drawer);
    });
    // A re-render with the same message must not ask it again.
    await act(async () => {
      root.render(drawer);
    });

    expect(sendJamiAssistantMessage).toHaveBeenCalledTimes(1);
    expect(sendJamiAssistantMessage.mock.calls[0]?.[0]).toMatchObject({ message: "What do enzymes do?" });
    expect(document.body.textContent).toContain("Enzymes speed reactions up.");
  });

  it("draws the surface's material controls, told whether the chat has begun", async () => {
    sendJamiAssistantMessage.mockResolvedValue({ reply: "Sure.", followUps: [], used: [] });
    const controls = vi.fn(({ conversationStarted }: { conversationStarted: boolean }) => (
      <p data-controls>{conversationStarted ? "started" : "not started"}</p>
    ));
    act(() => {
      root.render(
        <JamiAssistantDrawer
          userId="user-1"
          open
          onOpenChange={vi.fn()}
          resetKey="reset-1"
          contextKey={CONTEXT_KEY}
          contextLabel="This page"
          historyContextLabel="this page"
          getContext={getContext}
          contextControls={controls}
        />
      );
    });
    expect(document.querySelector("[data-controls]")?.textContent).toBe("not started");

    typeMessage("Help");
    await act(async () => {
      sendButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.querySelector("[data-controls]")?.textContent).toBe("started");
  });
});

describe("JamiAssistantDrawer floating over a notebook", () => {
  let onOpenChange: Mock<(open: boolean) => void>;

  function renderFloating(open: boolean, onAnswerInsert?: (text: string) => boolean) {
    act(() => {
      root.render(
        <JamiAssistantDrawer
          userId="user-1"
          open={open}
          onOpenChange={onOpenChange}
          resetKey="reset-1"
          contextKey={CONTEXT_KEY}
          contextLabel="Current notebook page"
          historyContextLabel="this notebook"
          getContext={getContext}
          layout="floating"
          onAnswerInsert={onAnswerInsert}
        />
      );
    });
  }

  function button(label: RegExp) {
    return [...document.querySelectorAll("button")].find((b) =>
      label.test(b.getAttribute("aria-label") ?? b.textContent ?? "")
    );
  }

  beforeEach(() => {
    // A tablet: wide enough to float rather than take the whole screen.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    localStorage.clear();
    onOpenChange = vi.fn();
  });

  it("is a card over the page, not a modal that stops writing", () => {
    renderFloating(true);
    const panel = document.querySelector<HTMLElement>("[role='dialog']");
    expect(panel?.getAttribute("aria-modal")).toBeNull();
    expect(panel?.style.width).toBe("360px");
    expect(document.querySelector("[data-dialog-backdrop]")).toBeNull();
  });

  it("folds the chat's own actions into one menu on a small card", () => {
    renderFloating(true);
    // The window's controls stay out; history and a new chat do not crowd them.
    expect(button(/make jami full size/i)).toBeDefined();
    expect(button(/open jami chat history/i)).toBeUndefined();

    const more = button(/more jami options/i);
    act(() => more?.click());
    expect(more?.getAttribute("aria-expanded")).toBe("true");
    const items = [...document.querySelectorAll("[role='menu'] [role^='menuitem']")].map(
      (item) => item.textContent
    );
    expect(items).toEqual(expect.arrayContaining(["New chat", "Chat history"]));

    const history = [...document.querySelectorAll<HTMLElement>("[role='menuitem']")].find(
      (item) => item.textContent === "Chat history"
    );
    act(() => history?.click());
    expect(document.querySelector("[role='menu']")).toBeNull();
    expect(document.body.textContent).toContain("Chat history");
  });

  it("lays the chat's actions out again once the card is wide", () => {
    localStorage.setItem(
      "jami:tutor-card:v1",
      JSON.stringify({ rect: { x: 20, y: 20, width: 600, height: 600 }, maximised: false })
    );
    renderFloating(true);
    expect(button(/more jami options/i)).toBeUndefined();
    expect(button(/open jami chat history/i)).toBeDefined();
  });

  it("shrinks to a pill that brings the card back", () => {
    renderFloating(true);
    act(() => button(/shrink jami/i)?.click());
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    renderFloating(false);
    const pill = button(/^open jami$/i);
    expect(pill).toBeDefined();
    act(() => pill?.click());
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
  });

  it("closing outright leaves nothing behind", () => {
    renderFloating(true);
    act(() => button(/close jami/i)?.click());
    renderFloating(false);
    expect(button(/^open jami$/i)).toBeUndefined();
  });

  it("keeps one answer beside the page", async () => {
    sendJamiAssistantMessage.mockResolvedValue({
      reply: "Swap the signs in the second bracket.",
      followUps: [],
      used: [],
    });
    renderFloating(true);
    typeMessage("Is my factorising right?");
    await act(async () => {
      sendButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    onOpenChange.mockClear();
    act(() => button(/keep beside page/i)?.click());
    // The chat stays open for the next question, with the answer beside it.
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(sendButton()).toBeDefined();

    const pinned = () => document.querySelector("[aria-label='Pinned answer from Jami']");
    expect(pinned()?.textContent).toContain("Swap the signs in the second bracket.");
    expect(pinned()?.textContent).not.toContain("Is my factorising right?");
    // Nothing to open while the chat is already open.
    expect(pinned()?.textContent).not.toContain("Open chat");

    // Put the chat away, and the pin stays with the way back to it.
    renderFloating(false);
    expect(pinned()?.textContent).toContain("Open chat");

    act(() => button(/unpin/i)?.click());
    expect(pinned()).toBeNull();
    expect(button(/^open jami$/i)).toBeDefined();
  });

  /*
   * Copying an answer into a text box left its table as pipes and its maths as
   * dollar signs. The whole answer goes to the page as it was written, for the
   * page to show the way the chat does.
   */
  it("adds a whole answer to the page as it was written", async () => {
    const reply = ["| Quantity | Formula |", "| --- | --- |", "| Area | $\\pi r^2$ |"].join("\n");
    sendJamiAssistantMessage.mockResolvedValue({ reply, followUps: [], used: [] });
    const onAnswerInsert = vi.fn(() => true);
    renderFloating(true, onAnswerInsert);
    typeMessage("What is the area of a circle?");
    await act(async () => {
      sendButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => button(/add this answer to the page/i)?.click());
    expect(onAnswerInsert).toHaveBeenCalledWith(reply);
    expect(button(/answer added to page/i)).toBeDefined();
  });

  /*
   * On an iPad the buttons under an answer are small and easy to miss, and
   * holding the answer only started selecting its text. Holding it opens the
   * same actions, larger, where the finger is.
   */
  it("opens the answer's actions when it is pressed and held", async () => {
    const reply = "Use $v^2 = u^2 + 2as$ with $u = 0$.";
    sendJamiAssistantMessage.mockResolvedValue({ reply, followUps: [], used: [] });
    const onAnswerInsert = vi.fn(() => true);
    renderFloating(true, onAnswerInsert);
    typeMessage("Which equation?");
    await act(async () => {
      sendButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const answer = document.querySelector<HTMLElement>("[data-answer-hold='true']");
    expect(answer?.textContent).toContain("with");

    function press(type: string, x = 40, y = 40) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
      Object.defineProperties(event, {
        pointerId: { value: 1 },
        pointerType: { value: "touch" },
        isPrimary: { value: true },
      });
      act(() => {
        answer?.dispatchEvent(event);
      });
    }
    const menuItems = () =>
      [...document.querySelectorAll("[aria-label='Answer actions'] [role='menuitem']")].map(
        (item) => item.textContent
      );

    vi.useFakeTimers();
    try {
      // A press that moves is a scroll, and opens nothing.
      press("pointerdown");
      press("pointermove", 40, 80);
      act(() => vi.advanceTimersByTime(600));
      expect(menuItems()).toEqual([]);

      press("pointerdown");
      act(() => vi.advanceTimersByTime(600));
      expect(menuItems()).toEqual(["Add to page", "Keep beside page", "Select text"]);
    } finally {
      vi.useRealTimers();
    }

    const add = [...document.querySelectorAll<HTMLElement>("[role='menuitem']")].find(
      (item) => item.textContent === "Add to page"
    );
    act(() => add?.click());
    expect(onAnswerInsert).toHaveBeenCalledWith(reply);
    expect(menuItems()).toEqual([]);
    expect(button(/answer added to page/i)).toBeDefined();
  });

  it("gives holding back to the system once Select text is chosen", async () => {
    sendJamiAssistantMessage.mockResolvedValue({ reply: "An answer.", followUps: [], used: [] });
    renderFloating(true, vi.fn(() => true));
    typeMessage("A question");
    await act(async () => {
      sendButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const answer = document.querySelector<HTMLElement>("[data-answer-hold='true']");
    const event = new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 });
    Object.defineProperties(event, {
      pointerId: { value: 1 },
      pointerType: { value: "touch" },
      isPrimary: { value: true },
    });
    vi.useFakeTimers();
    try {
      act(() => {
        answer?.dispatchEvent(event);
      });
      act(() => vi.advanceTimersByTime(600));
    } finally {
      vi.useRealTimers();
    }
    const select = [...document.querySelectorAll<HTMLElement>("[role='menuitem']")].find(
      (item) => item.textContent === "Select text"
    );
    act(() => select?.click());
    expect(document.querySelector("[data-answer-hold='true']")).toBeNull();
    expect(answer?.textContent).toContain("An answer.");
  });

  it("offers no Add to page where there is no page to add to", async () => {
    sendJamiAssistantMessage.mockResolvedValue({ reply: "An answer.", followUps: [], used: [] });
    renderFloating(true);
    typeMessage("A question");
    await act(async () => {
      sendButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(button(/add this answer to the page/i)).toBeUndefined();
  });
});

describe("JamiAssistantDrawer study material", () => {
  beforeEach(() => {
    requestTutorStudyMaterial.mockReset();
  });

  const savedThread = {
    id: "thread-1",
    title: "Separating variables",
    surface: "notebook",
    contextKey: CONTEXT_KEY,
    contextLabel: "This page",
    context: { surface: "notebook", notebookId: "notebook-1", pageId: "page-1" },
    lastMessagePreview: "",
    messageCount: 2,
    createdAt: 1,
    updatedAt: 1,
    lastAssistantMessageId: "answer-1",
  };

  it("starts making flashcards the moment Tutor agrees, and says so", async () => {
    requestTutorStudyMaterial.mockReturnValue(new Promise(() => undefined));
    sendJamiAssistantMessage.mockResolvedValue({
      reply: "Making you flashcards on separating variables now.",
      used: [],
      studyMaterialRequest: { kind: "flashcards", focus: "separating variables", count: 6 },
      savedThread,
    });
    render();

    typeMessage("can you make me flashcards on this?");
    await act(async () => {
      sendButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.body.textContent).toContain("Making your flashcards");
    expect(requestTutorStudyMaterial).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread-1", messageId: "answer-1", kind: "flashcards", context: CONTEXT })
    );
  });

  it("offers practice questions under a teaching answer, and makes them on a press", async () => {
    requestTutorStudyMaterial.mockReturnValue(new Promise(() => undefined));
    sendJamiAssistantMessage.mockResolvedValue({
      reply: "Divide so every y term sits with dy.",
      used: [],
      followUps: [{ label: "Explain more", prompt: "Explain that in more detail." }],
      studyMaterialOffers: ["flashcards", "practice"],
      savedThread,
    });
    render();

    typeMessage("when do I divide the x over?");
    await act(async () => {
      sendButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const offer = [...document.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Practice questions")
    );
    expect(offer).toBeDefined();
    expect(document.body.textContent).toContain("Make flashcards");
    expect(requestTutorStudyMaterial).not.toHaveBeenCalled();

    await act(async () => {
      offer?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.body.textContent).toContain("Writing your practice set");
    expect(requestTutorStudyMaterial).toHaveBeenCalledWith(expect.objectContaining({ kind: "practice" }));
  });
});
