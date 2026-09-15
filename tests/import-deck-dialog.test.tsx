// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ImportDeckDialog from "@/components/study/ImportDeckDialog";

vi.mock("@/lib/study/import/useAnkiImport", () => ({
  useAnkiReader: () => vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

const byText = (text: string) =>
  [...document.querySelectorAll<HTMLElement>("button, label")].find((element) => element.textContent?.includes(text));

describe("importing cards", () => {
  it("imports only when asked, and only once", async () => {
    const onImport = vi.fn(() => new Promise<void>(() => undefined));
    await act(async () => {
      root.render(
        <ImportDeckDialog open folders={[]} progress={null} onDismiss={() => undefined} onImport={onImport} />
      );
    });

    await act(async () => {
      byText("Pasted text")!.click();
    });
    const textarea = document.querySelector("textarea")!;
    await act(async () => {
      setValue(textarea, "Mitosis | Cell division\nOsmosis | Water moving across a membrane");
    });
    expect(document.body.textContent).toContain("2 cards ready to import");
    expect(onImport).not.toHaveBeenCalled();

    const nameField = [...document.querySelectorAll("input")].find((input) => input.placeholder === "Name this deck")!;
    await act(async () => {
      setValue(nameField, "Biology");
    });
    const importButton = byText("Import 2 cards")!;
    await act(async () => {
      importButton.click();
      importButton.click();
    });

    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport).toHaveBeenCalledWith({
      name: "Biology",
      folderId: "",
      cards: [
        { front: "Mitosis", back: "Cell division" },
        { front: "Osmosis", back: "Water moving across a membrane" },
      ],
    });
  });
});
