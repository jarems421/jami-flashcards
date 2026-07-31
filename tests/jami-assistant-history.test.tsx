// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JamiAssistantHistory from "@/components/ai/JamiAssistantHistory";
import type { JamiAssistantThread } from "@/lib/ai/jami-assistant-history";

function thread(
  overrides: Partial<JamiAssistantThread> = {}
): JamiAssistantThread {
  return {
    id: "t-1",
    title: "Ohm's law",
    surface: "notebook",
    contextKey: "notebook:nb-1:page:p-1",
    contextLabel: "Circuits",
    context: { surface: "notebook" } as JamiAssistantThread["context"],
    lastMessagePreview: "So V = IR.",
    messageCount: 4,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;
const onOpen = vi.fn();
const onNew = vi.fn();
const onRename = vi.fn();
const onDelete = vi.fn();

async function render(
  props: {
    threads?: JamiAssistantThread[];
    loading?: boolean;
    error?: string | null;
  } = {}
) {
  await act(async () => {
    root.render(
      <JamiAssistantHistory
        threads={props.threads ?? [thread()]}
        loading={props.loading ?? false}
        error={props.error ?? null}
        onOpen={onOpen}
        onNew={onNew}
        onRename={onRename}
        onDelete={onDelete}
      />
    );
  });
}

const text = () => container.textContent ?? "";
const rows = () => [...container.querySelectorAll("article")];
const alert = () => container.querySelector("[role=alert]");

function button(label: string, scope: ParentNode = container) {
  return [...scope.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label
  );
}

async function click(target: HTMLElement | null | undefined) {
  expect(target).toBeTruthy();
  await act(async () => {
    target!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Rename and delete both live behind the row's overflow menu. */
async function openMenuItem(label: string, row: ParentNode = rows()[0]) {
  const menu = row.querySelector<HTMLElement>("summary");
  await click(menu!);
  await click(button(label, row));
}

const nameField = () =>
  container.querySelector<HTMLInputElement>("input#jami-chat-title-t-1");

function type(field: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submitRename() {
  await act(async () => {
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  onOpen.mockClear();
  onNew.mockClear();
  onRename.mockReset().mockResolvedValue(undefined);
  onDelete.mockReset().mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("JamiAssistantHistory listing", () => {
  it("shows progress rather than an empty state while loading", async () => {
    await render({ threads: [], loading: true });
    expect(container.querySelector("[role=status]")).not.toBeNull();
    // "No saved chats yet" during a load reads as data loss.
    expect(text()).not.toContain("No saved chats yet");
  });

  it("invites a first chat when there is nothing saved", async () => {
    await render({ threads: [] });
    expect(text()).toContain("No saved chats yet");
    expect(rows()).toHaveLength(0);
  });

  it("labels a thread with its surface", async () => {
    await render({
      threads: [
        thread({ id: "a", title: "Notebook chat", surface: "notebook" }),
        thread({ id: "b", title: "Learn chat", surface: "learn" }),
        thread({ id: "c", title: "Source chat", surface: "sources" }),
      ],
    });
    expect(rows()).toHaveLength(3);
    expect(rows()[0]!.textContent).toContain("Notebook");
    expect(rows()[1]!.textContent).toContain("Learn");
    expect(rows()[2]!.textContent).toContain("Sources");
  });

  it("opens the thread that was clicked", async () => {
    const second = thread({ id: "t-2", title: "Waves" });
    await render({ threads: [thread(), second] });
    await click(button("Waves", rows()[1]!) ?? rows()[1]!.querySelector("button")!);
    expect(onOpen).toHaveBeenCalledWith(second);
  });

  it("starts a new chat", async () => {
    await render();
    await click(button("New chat"));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("surfaces a load error", async () => {
    await render({ threads: [], error: "Could not load your chats." });
    expect(alert()?.textContent).toContain("Could not load your chats.");
  });
});

describe("JamiAssistantHistory rename", () => {
  it("opens the editor prefilled with the current name", async () => {
    await render();
    await openMenuItem("Rename");
    expect(nameField()?.value).toBe("Ohm's law");
  });

  it("saves a trimmed new name and closes the editor", async () => {
    await render();
    await openMenuItem("Rename");
    type(nameField()!, "  Ohm and Kirchhoff  ");
    await submitRename();

    expect(onRename).toHaveBeenCalledWith(
      expect.objectContaining({ id: "t-1" }),
      "Ohm and Kirchhoff"
    );
    expect(nameField()).toBeNull();
  });

  it("will not save an empty name", async () => {
    await render();
    await openMenuItem("Rename");
    type(nameField()!, "   ");

    expect(button("Save")?.disabled).toBe(true);
    await submitRename();
    expect(onRename).not.toHaveBeenCalled();
  });

  it("caps the name so a chat list stays readable", async () => {
    await render();
    await openMenuItem("Rename");
    expect(nameField()?.maxLength).toBe(80);
  });

  it("keeps the editor open and says why a rename failed", async () => {
    onRename.mockRejectedValue(new Error("Name already in use."));
    await render();
    await openMenuItem("Rename");
    type(nameField()!, "Waves");
    await submitRename();

    expect(alert()?.textContent).toContain("Name already in use.");
    // Closing here would throw away the name the student just typed.
    expect(nameField()?.value).toBe("Waves");
  });

  it("abandons the rename on cancel", async () => {
    await render();
    await openMenuItem("Rename");
    type(nameField()!, "Discarded");
    await click(button("Cancel"));

    expect(onRename).not.toHaveBeenCalled();
    expect(text()).toContain("Ohm's law");
  });

  it("ignores a second submit while the first is still saving", async () => {
    let release: () => void = () => undefined;
    onRename.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    await render();
    await openMenuItem("Rename");
    type(nameField()!, "Waves");
    await submitRename();
    await submitRename();

    expect(onRename).toHaveBeenCalledTimes(1);
    await act(async () => release());
  });

  it("only edits the row that was chosen", async () => {
    await render({ threads: [thread(), thread({ id: "t-2", title: "Waves" })] });
    await openMenuItem("Rename");
    expect(container.querySelectorAll("form")).toHaveLength(1);
    expect(rows()[1]!.textContent).toContain("Waves");
  });
});

describe("JamiAssistantHistory delete", () => {
  it("asks before deleting", async () => {
    await render();
    await openMenuItem("Delete");
    expect(text()).toContain("Delete this chat?");
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("deletes once confirmed", async () => {
    await render();
    await openMenuItem("Delete");
    await click(button("Delete"));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "t-1" }));
  });

  it("backs out on cancel", async () => {
    await render();
    await openMenuItem("Delete");
    await click(button("Cancel"));

    expect(onDelete).not.toHaveBeenCalled();
    expect(text()).not.toContain("Delete this chat?");
  });

  it("keeps the confirmation up when the delete fails", async () => {
    onDelete.mockRejectedValue(new Error("Chat is still in use."));
    await render();
    await openMenuItem("Delete");
    await click(button("Delete"));

    expect(alert()?.textContent).toContain("Chat is still in use.");
    // The row must not look deleted when it is still there.
    expect(text()).toContain("Delete this chat?");
  });

  it("ignores a second confirm while the delete is in flight", async () => {
    let release: () => void = () => undefined;
    onDelete.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    await render();
    await openMenuItem("Delete");
    await click(button("Deleting…") ?? button("Delete"));
    await click(button("Deleting…") ?? button("Delete"));

    expect(onDelete).toHaveBeenCalledTimes(1);
    await act(async () => release());
  });
});

describe("JamiAssistantHistory mode switching", () => {
  // A row in rename or delete mode replaces its own overflow menu, so the only
  // way to reach a second prompt is from another row.
  const twoRows = () => [thread(), thread({ id: "t-2", title: "Waves" })];

  it("clears a pending delete elsewhere when a rename starts", async () => {
    await render({ threads: twoRows() });
    await openMenuItem("Delete", rows()[1]!);
    expect(text()).toContain("Delete this chat?");

    await openMenuItem("Rename", rows()[0]!);
    // Two open prompts would leave the student unsure which row acts next.
    expect(text()).not.toContain("Delete this chat?");
    expect(nameField()).not.toBeNull();
  });

  it("clears an open rename elsewhere when a delete starts", async () => {
    await render({ threads: twoRows() });
    await openMenuItem("Rename", rows()[0]!);
    expect(nameField()).not.toBeNull();

    await openMenuItem("Delete", rows()[1]!);
    expect(nameField()).toBeNull();
    expect(text()).toContain("Delete this chat?");
  });

  it("keeps the menu out of the way while a row is being edited", async () => {
    await render();
    await openMenuItem("Rename");
    expect(rows()[0]!.querySelector("summary")).toBeNull();
  });

  it("prefers its own action error over a stale load error", async () => {
    onRename.mockRejectedValue(new Error("Rename failed."));
    await render({ error: "Could not load your chats." });
    await openMenuItem("Rename");
    await submitRename();

    expect(alert()?.textContent).toContain("Rename failed.");
    expect(alert()?.textContent).not.toContain("Could not load your chats.");
  });
});
