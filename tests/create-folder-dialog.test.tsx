// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CreateFolderDialog from "@/components/workspace/CreateFolderDialog";

const createStudyFolder = vi.fn();

vi.mock("@/services/study/folders", () => ({
  createStudyFolder: (...a: unknown[]) => createStudyFolder(...a),
}));

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
const onCreated = vi.fn();

async function render(open = true) {
  await act(async () => {
    root.render(
      <CreateFolderDialog
        open={open}
        userId="user-1"
        onClose={onClose}
        onCreated={onCreated}
      />
    );
  });
}

const form = () => document.querySelector("form");
/** The Input primitive renders no explicit type attribute. */
const nameField = () =>
  document.querySelector<HTMLInputElement>("[data-dialog-autofocus='true']");
const submitButton = () =>
  document.querySelector<HTMLButtonElement>("button[type=submit]");

function type(field: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  await act(async () => {
    form()?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
  });
}

beforeEach(() => {
  createStudyFolder.mockReset().mockResolvedValue({ id: "folder-1" });
  onClose.mockClear();
  onCreated.mockClear();
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
});

describe("CreateFolderDialog", () => {
  it("renders nothing while closed", async () => {
    await render(false);
    expect(form()).toBeNull();
  });

  it("will not submit an empty name", async () => {
    await render();
    await submit();
    expect(createStudyFolder).not.toHaveBeenCalled();
    // The rule only appears once the student has tried, not on first sight.
    expect(document.body.textContent).toMatch(/name/i);
  });

  it("keeps submit disabled until the name is valid", async () => {
    await render();
    expect(submitButton()?.disabled).toBe(true);

    type(nameField()!, "Physics");
    expect(submitButton()?.disabled).toBe(false);
  });

  it("creates the folder and reports it back", async () => {
    await render();
    type(nameField()!, "Physics");
    await submit();

    expect(createStudyFolder).toHaveBeenCalledTimes(1);
    expect(createStudyFolder.mock.calls[0]?.[0]).toBe("user-1");
    expect(createStudyFolder.mock.calls[0]?.[1]).toMatchObject({
      name: "Physics",
    });
    expect(onCreated).toHaveBeenCalledWith({ id: "folder-1" });
  });

  it("cannot be submitted twice from the button", async () => {
    let release: (value: unknown) => void = () => undefined;
    createStudyFolder.mockImplementation(
      () => new Promise((resolve) => {
        release = resolve;
      })
    );
    await render();
    type(nameField()!, "Physics");

    // Note the guard here is structural: handleSubmit has no `saving` check,
    // so it is the disabled fieldset that stops a second press. Removing that
    // fieldset would create the folder twice.
    await act(async () => {
      submitButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      submitButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(createStudyFolder).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ id: "folder-1" });
    });
  });

  it("locks the form while saving", async () => {
    let release: (value: unknown) => void = () => undefined;
    createStudyFolder.mockImplementation(
      () => new Promise((resolve) => {
        release = resolve;
      })
    );
    await render();
    type(nameField()!, "Physics");
    await submit();

    expect(document.querySelector("fieldset")?.disabled).toBe(true);

    await act(async () => {
      release({ id: "folder-1" });
    });
  });

  it("surfaces a failure and leaves the dialog open to retry", async () => {
    createStudyFolder.mockRejectedValue(new Error("Folder already exists."));
    await render();
    type(nameField()!, "Physics");
    await submit();

    expect(document.body.textContent).toContain("Folder already exists.");
    expect(onCreated).not.toHaveBeenCalled();
    expect(form()).not.toBeNull();
  });
});
