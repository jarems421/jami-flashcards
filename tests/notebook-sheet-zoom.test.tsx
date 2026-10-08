// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/library/SourcePdfReader", () => ({
  useSourcePdfDocument: () => ({ pdf: {}, pageCount: 3, failed: false }),
  SourcePdfPage: ({ pageNumber, width }: { pageNumber: number; width: number }) => (
    <div data-testid="pdf-page" data-page={pageNumber} data-width={width} />
  ),
}));

const { default: NotebookSheetPdf } = await import("@/components/workspace/NotebookSheetPdf");
const { default: NotebookSheetPicker } = await import("@/components/workspace/NotebookSheetPicker");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeAll(() => {
  // The track measures itself to size its pages; jsdom lays nothing out.
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe() {
      this.callback([{ contentRect: { width: 396 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const pageWidths = () => [...host.querySelectorAll("[data-testid=pdf-page]")].map((page) => Number(page.getAttribute("data-width")));

describe("a PDF sheet of several pages", () => {
  async function open() {
    await act(async () =>
      root.render(<NotebookSheetPdf storagePath="users/u/sourceFiles/s/f-paper.pdf" title="Paper 1" fallback={null} />)
    );
  }

  it("zooms in by drawing the pages larger, and fits them back", async () => {
    await open();
    expect(pageWidths()).toEqual([380, 380, 380]);
    expect(host.textContent).toContain("100%");
    expect(button("Zoom out")?.disabled).toBe(true);

    await act(async () => button("Zoom in")!.click());
    expect(pageWidths()).toEqual([475, 475, 475]);
    expect(host.textContent).toContain("125%");

    await act(async () => button("Fit the sheet to the panel")!.click());
    expect(pageWidths()).toEqual([380, 380, 380]);
  });

  it("pans a zoomed page instead of turning it, and still turns pages with the arrows", async () => {
    await open();
    const track = host.querySelector<HTMLElement>('[role="document"] > div')!;
    expect(track.className).toContain("overflow-x-auto");

    await act(async () => button("Zoom in")!.click());
    expect(track.className).toContain("overflow-x-hidden");
    expect(host.textContent).toContain("1 / 3");
    expect(button("Next page")?.disabled).toBe(false);
    expect(button("Previous page")?.disabled).toBe(true);
  });

  it("stops at three times, the largest it draws", async () => {
    await open();
    for (let press = 0; press < 8; press += 1) {
      const zoomIn = button("Zoom in")!;
      if (zoomIn.disabled) break;
      await act(async () => zoomIn.click());
    }
    expect(host.textContent).toContain("300%");
    expect(button("Zoom in")?.disabled).toBe(true);
  });

  it("zooms with Ctrl and the scroll wheel, settling once the gesture stops", async () => {
    vi.useFakeTimers();
    await open();
    const sheet = host.querySelector<HTMLElement>('[role="document"]')!;
    const wheel = new WheelEvent("wheel", { deltaY: -40, ctrlKey: true, clientX: 100, clientY: 100, bubbles: true, cancelable: true });
    await act(async () => {
      sheet.dispatchEvent(wheel);
    });
    expect(wheel.defaultPrevented).toBe(true);
    // Previewed by scaling what is drawn, redrawn only once it settles.
    expect(pageWidths()).toEqual([380, 380, 380]);
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(pageWidths()[0]).toBeGreaterThan(380);

    const plain = new WheelEvent("wheel", { deltaY: 40, bubbles: true, cancelable: true });
    await act(async () => {
      sheet.dispatchEvent(plain);
    });
    // Without Ctrl or Cmd the wheel scrolls, as it always did.
    expect(plain.defaultPrevented).toBe(false);
  });
});

describe("uploading a sheet from the picker", () => {
  function picker(props: Partial<Parameters<typeof NotebookSheetPicker>[0]> = {}) {
    return (
      <NotebookSheetPicker
        open
        replacing={false}
        firstSheet
        notebookSheets={[]}
        folderSheets={[]}
        folderLoading={false}
        folderFailed={false}
        keptPaths={[]}
        upload={null}
        canUpload
        onUpload={vi.fn()}
        onPick={vi.fn()}
        onCancel={vi.fn()}
        {...props}
      />
    );
  }
  const uploadButton = () =>
    [...document.querySelectorAll("button")].find((element) => element.textContent?.includes("Upload a PDF or picture"));

  it("offers an upload that sends the chosen file on", async () => {
    const onUpload = vi.fn();
    await act(async () => root.render(picker({ onUpload })));
    expect(uploadButton()).toBeDefined();
    expect(document.body.textContent).toContain("added to this folder’s sources");

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.accept).toBe("application/pdf,image/jpeg,image/png,image/webp");
    const file = new File(["%PDF"], "Paper 1.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onUpload).toHaveBeenCalledWith(file);
  });

  it("shows an upload under way, keeps the picker open until it lands, and says why one failed", async () => {
    const onCancel = vi.fn();
    await act(async () => root.render(picker({ upload: { progress: 42, error: null }, onCancel })));
    expect(document.body.textContent).toContain("Uploading… 42%");
    expect(document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("42");
    const cancel = [...document.querySelectorAll("button")].find((element) => element.textContent === "Cancel")!;
    expect(cancel.disabled).toBe(true);

    await act(async () => root.render(picker({ upload: { progress: null, error: "Notebook files must be under 20 MB." } })));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Notebook files must be under 20 MB.");
  });

  it("offers no upload where there is no folder to add it to", async () => {
    await act(async () => root.render(picker({ canUpload: false })));
    expect(uploadButton()).toBeUndefined();
  });
});
