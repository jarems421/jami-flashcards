// @vitest-environment jsdom

import {
  act,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
  type DialogDismissReason,
} from "@/components/ui";

let container: HTMLDivElement;
let root: Root;

async function render(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

async function flushFocus() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function key(target: EventTarget, value: string, shiftKey = false) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        shiftKey,
        bubbles: true,
        cancelable: true,
      })
    );
  });
}

function TestDialog({
  open = true,
  modal,
  dismissible,
  closeOnBackdrop,
  onDismiss = vi.fn(),
}: {
  open?: boolean;
  modal?: boolean;
  dismissible?: boolean;
  closeOnBackdrop?: boolean;
  onDismiss?: (reason: DialogDismissReason) => void;
}) {
  const preferredFocusRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      modal={modal}
      dismissible={dismissible}
      closeOnBackdrop={closeOnBackdrop}
      initialFocusRef={preferredFocusRef}
      className="fixed inset-0"
      onDismiss={onDismiss}
    >
      <DialogBackdrop data-testid="backdrop" />
      <DialogPanel>
        <DialogTitle>Example dialog</DialogTitle>
        <DialogDescription>Example description</DialogDescription>
        <button type="button">First</button>
        <button ref={preferredFocusRef} type="button">
          Preferred
        </button>
        <button type="button">Last</button>
      </DialogPanel>
    </Dialog>
  );
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

describe("Dialog", () => {
  it("portals a labelled modal and moves focus to the requested control", async () => {
    await render(<TestDialog />);
    await flushFocus();

    const panel = document.querySelector<HTMLElement>('[role="dialog"]');
    const title = [...document.querySelectorAll("h2")].find(
      (node) => node.textContent === "Example dialog"
    );
    const description = [...document.querySelectorAll("p")].find(
      (node) => node.textContent === "Example description"
    );

    expect(panel).not.toBeNull();
    expect(container.contains(panel)).toBe(false);
    expect(panel?.getAttribute("aria-modal")).toBe("true");
    expect(panel?.getAttribute("aria-labelledby")).toBe(title?.id);
    expect(panel?.getAttribute("aria-describedby")).toBe(description?.id);
    expect(document.activeElement?.textContent).toBe("Preferred");
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("wraps focus in both directions and recovers focus from outside", async () => {
    const outside = document.createElement("button");
    outside.textContent = "Outside";
    document.body.append(outside);
    await render(<TestDialog />);
    await flushFocus();

    const buttons = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ];
    const first = buttons[0];
    const last = buttons.at(-1)!;

    last.focus();
    key(last, "Tab");
    expect(document.activeElement).toBe(first);

    first.focus();
    key(first, "Tab", true);
    expect(document.activeElement).toBe(last);

    outside.focus();
    key(outside, "Tab");
    expect(document.activeElement).toBe(first);
    outside.remove();
  });

  it("reports Escape and backdrop dismissal without treating panel presses as backdrop", async () => {
    const onDismiss = vi.fn();
    await render(<TestDialog onDismiss={onDismiss} />);
    await flushFocus();

    key(document.activeElement!, "Escape");
    expect(onDismiss).toHaveBeenCalledWith("escape");

    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
    act(() => {
      panel.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    const backdrop = document.querySelector<HTMLElement>(
      '[data-dialog-backdrop="true"]'
    )!;
    act(() => {
      backdrop.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(onDismiss).toHaveBeenLastCalledWith("backdrop");
  });

  it("honours disabled dismissal policies", async () => {
    const onDismiss = vi.fn();
    await render(
      <TestDialog
        dismissible={false}
        closeOnBackdrop={false}
        onDismiss={onDismiss}
      />
    );
    await flushFocus();

    key(document.activeElement!, "Escape");
    const backdrop = document.querySelector<HTMLElement>(
      '[data-dialog-backdrop="true"]'
    )!;
    act(() => {
      backdrop.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("lets an inner control consume Escape", async () => {
    const onDismiss = vi.fn();
    await render(
      <Dialog open className="fixed inset-0" onDismiss={onDismiss}>
        <DialogBackdrop />
        <DialogPanel>
          <DialogTitle>Popover host</DialogTitle>
          <button type="button" onKeyDown={(event) => event.preventDefault()}>
            Inner popover
          </button>
        </DialogPanel>
      </Dialog>
    );
    await flushFocus();

    key(document.activeElement!, "Escape");
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("keeps nested dialogs stacked, locked, and focused independently", async () => {
    const parentClosed = vi.fn();

    function Harness() {
      const [childOpen, setChildOpen] = useState(false);
      const childTriggerRef = useRef<HTMLButtonElement>(null);
      return (
        <Dialog
          open
          initialFocusRef={childTriggerRef}
          className="fixed inset-0"
          onDismiss={() => parentClosed()}
        >
          <DialogBackdrop />
          <DialogPanel data-testid="parent-panel">
            <DialogTitle>Parent</DialogTitle>
            <button
              ref={childTriggerRef}
              type="button"
              onClick={() => setChildOpen(true)}
            >
              Open child
            </button>
          </DialogPanel>
          <Dialog
            open={childOpen}
            className="fixed inset-0"
            onDismiss={() => setChildOpen(false)}
          >
            <DialogBackdrop />
            <DialogPanel>
              <DialogTitle>Child</DialogTitle>
              <button type="button">Close child</button>
            </DialogPanel>
          </Dialog>
        </Dialog>
      );
    }

    document.body.style.overflow = "clip";
    await render(<Harness />);
    await flushFocus();
    const trigger = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Open child"
    )!;
    act(() => trigger.click());
    await flushFocus();

    const parentPanel = document.querySelector<HTMLElement>(
      '[data-testid="parent-panel"]'
    )!;
    expect(parentPanel.getAttribute("aria-hidden")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");

    key(document.activeElement!, "Escape");
    await flushFocus();
    expect(parentClosed).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("hidden");

    key(document.activeElement!, "Escape");
    expect(parentClosed).toHaveBeenCalledTimes(1);

    await render(<div />);
    await flushFocus();
    expect(document.body.style.overflow).toBe("clip");
  });

  it("leaves page scrolling and focus traversal alone in non-modal mode", async () => {
    const onDismiss = vi.fn();
    document.body.style.overflow = "auto";
    await render(<TestDialog modal={false} onDismiss={onDismiss} />);
    await flushFocus();

    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(panel.getAttribute("aria-modal")).toBeNull();
    expect(document.querySelector('[data-dialog-backdrop="true"]')).toBeNull();
    expect(document.body.style.overflow).toBe("auto");

    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    key(outside, "Tab");
    expect(document.activeElement).toBe(outside);

    key(outside, "Escape");
    expect(onDismiss).toHaveBeenCalledWith("escape");
    outside.remove();
  });

  it("restores focus to the opener and tolerates an opener that disappeared", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    await render(<TestDialog />);
    await flushFocus();

    await render(<TestDialog open={false} />);
    await flushFocus();
    expect(document.activeElement).toBe(opener);

    opener.focus();
    await render(<TestDialog />);
    await flushFocus();
    opener.remove();
    await render(<TestDialog open={false} />);
    await flushFocus();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
