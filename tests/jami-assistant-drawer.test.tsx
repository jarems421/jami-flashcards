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
});

describe("JamiAssistantDrawer floating over a notebook", () => {
  let onOpenChange: Mock<(open: boolean) => void>;

  function renderFloating(open: boolean) {
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

    act(() => button(/keep beside page/i)?.click());
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    renderFloating(false);

    const pinned = document.querySelector("[aria-label='Pinned answer from Jami']");
    expect(pinned?.textContent).toContain("Swap the signs in the second bracket.");
    expect(pinned?.textContent).not.toContain("Is my factorising right?");

    act(() => button(/unpin/i)?.click());
    expect(document.querySelector("[aria-label='Pinned answer from Jami']")).toBeNull();
    expect(button(/^open jami$/i)).toBeDefined();
  });
});
