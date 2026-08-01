"use client";

import {
  memo,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import NotebookTextBlockOptions from "@/components/workspace/NotebookTextBlockOptions";
import {
  MAX_NOTEBOOK_TEXT_BLOCK_TEXT,
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
  type NotebookPageColor,
  type NotebookTextBlock,
  type NotebookTextBlockResizeEdge,
} from "@/lib/workspace/notebooks";

const TEXT_COLOR_CLASS: Record<NotebookPageColor, string> = {
  white: "text-slate-950 placeholder:text-slate-400",
  black: "text-[#f8fafc] placeholder:text-slate-500",
};

// Each edge keeps a generous 32px invisible hit area, but the visible
// affordance is a slim grip bar sitting on the border, not a bubble.
const RESIZE_HANDLES: Array<{
  edge: NotebookTextBlockResizeEdge;
  label: string;
  positionClass: string;
  gripClass: string;
}> = [
  {
    edge: "top",
    label: "Resize text box from top edge",
    positionClass: "left-1/2 top-0 h-8 w-8 -translate-x-1/2 -translate-y-1/2",
    gripClass: "h-[3px] w-4",
  },
  {
    edge: "right",
    label: "Resize text box from right edge",
    positionClass: "right-0 top-1/2 h-8 w-8 -translate-y-1/2 translate-x-1/2",
    gripClass: "h-4 w-[3px]",
  },
  {
    edge: "bottom",
    label: "Resize text box from bottom edge",
    positionClass: "bottom-0 left-1/2 h-8 w-8 -translate-x-1/2 translate-y-1/2",
    gripClass: "h-[3px] w-4",
  },
  {
    edge: "left",
    label: "Resize text box from left edge",
    positionClass: "left-0 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2",
    gripClass: "h-4 w-[3px]",
  },
];

type Props = {
  textBlocks: NotebookTextBlock[];
  pageColor: NotebookPageColor;
  editingEnabled: boolean;
  selectedTextBlockId: string | null;
  editingTextBlockId: string | null;
  /** Block currently being dragged or resized; its chrome is hidden. */
  activeTextGestureId: string | null;
  openTextBlockOptionsId: string | null;
  onPointerDown: (block: NotebookTextBlock, event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (block: NotebookTextBlock, event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (block: NotebookTextBlock, event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (block: NotebookTextBlock, event: ReactPointerEvent<HTMLElement>) => void;
  onSelect: (blockId: string) => void;
  onSetOptionsOpen: (blockId: string, open: boolean) => void;
  onToggleOutline: (blockId: string) => void;
  onDelete: (blockId: string) => void;
  onOptionsKeyDown: (
    blockId: string,
    event: ReactKeyboardEvent<HTMLDivElement>
  ) => void;
  onStartResize: (
    block: NotebookTextBlock,
    edge: NotebookTextBlockResizeEdge,
    event: ReactPointerEvent<HTMLElement>
  ) => void;
  onResize: (event: ReactPointerEvent<HTMLElement>) => void;
  onStopResize: (event: ReactPointerEvent<HTMLElement>) => void;
  onChangeText: (blockId: string, text: string) => void;
  onStopEditing: () => void;
};

function NotebookTextEditor({
  block,
  pageColor,
  onSelect,
  onChangeText,
  onStopEditing,
}: {
  block: NotebookTextBlock;
  pageColor: NotebookPageColor;
  onSelect: (blockId: string) => void;
  onChangeText: (blockId: string, text: string) => void;
  onStopEditing: () => void;
}) {
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    editorRef.current?.focus();
  }, []);

  return (
    <textarea
      ref={editorRef}
      value={block.text}
      maxLength={MAX_NOTEBOOK_TEXT_BLOCK_TEXT}
      // The box beneath owns dragging; typing must not start one.
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onStopEditing();
        }
      }}
      onFocus={() => onSelect(block.id)}
      onChange={(event) => onChangeText(block.id, event.target.value)}
      placeholder="Type here..."
      data-notebook-text-editor="true"
      className={`notebook-text-editor h-full w-full resize-none rounded-[0.45rem] bg-transparent p-2 pr-16 text-sm font-medium leading-6 outline-none ${TEXT_COLOR_CLASS[pageColor]}`}
    />
  );
}

/**
 * The typed text boxes floating above the ink surface.
 *
 * Positions are percentages of the fixed page coordinate space, so a box keeps
 * its place on the sheet at any zoom.
 */
function NotebookTextBlockLayer({
  textBlocks,
  pageColor,
  editingEnabled,
  selectedTextBlockId,
  editingTextBlockId,
  activeTextGestureId,
  openTextBlockOptionsId,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onSelect,
  onSetOptionsOpen,
  onToggleOutline,
  onDelete,
  onOptionsKeyDown,
  onStartResize,
  onResize,
  onStopResize,
  onChangeText,
  onStopEditing,
}: Props) {
  const onBlack = pageColor === "black";
  const frameBorderClass = onBlack ? "border-white/55" : "border-slate-950/40";

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {textBlocks.map((block) => {
        const selected = selectedTextBlockId === block.id;
        const editing = editingTextBlockId === block.id;
        const gesturing = activeTextGestureId === block.id;
        const displayText = block.text.trim()
          ? block.text
          : selected
            ? "Tap again to type"
            : "";
        const idleBorderClass = block.outlineVisible
          ? onBlack
            ? "border-white/30"
            : "border-slate-950/25"
          : "border-transparent";
        const optionsOpen = openTextBlockOptionsId === block.id;
        // Flip the popover above the box when it sits low on the page.
        const optionsOpenAbove =
          block.y + block.height / 2 > NOTEBOOK_PAGE_COORDINATE_HEIGHT / 2;
        const optionsAlignFromLeft = block.x + block.width < 420;

        return (
          <div
            key={block.id}
            className={`notebook-text-object pointer-events-auto absolute rounded-[0.45rem] border bg-transparent transition-[border-color,box-shadow] duration-150 ${
              editing
                ? `cursor-text ${frameBorderClass} shadow-[0_2px_12px_rgba(0,0,0,0.12)]`
                : selected
                  ? `cursor-grab touch-none select-none ${frameBorderClass} active:cursor-grabbing`
                  : `cursor-grab touch-none select-none ${idleBorderClass} active:cursor-grabbing`
            }`}
            style={{
              left: `${(block.x / NOTEBOOK_PAGE_COORDINATE_WIDTH) * 100}%`,
              top: `${(block.y / NOTEBOOK_PAGE_COORDINATE_HEIGHT) * 100}%`,
              width: `${(block.width / NOTEBOOK_PAGE_COORDINATE_WIDTH) * 100}%`,
              height: `${(block.height / NOTEBOOK_PAGE_COORDINATE_HEIGHT) * 100}%`,
            }}
            onPointerDown={(event) => onPointerDown(block, event)}
            onPointerMove={(event) => onPointerMove(block, event)}
            onPointerUp={(event) => onPointerUp(block, event)}
            onPointerCancel={(event) => onPointerCancel(block, event)}
          >
            {selected && editingEnabled && !gesturing ? (
              <>
                <NotebookTextBlockOptions
                  blockId={block.id}
                  open={optionsOpen}
                  outlineVisible={block.outlineVisible}
                  openAbove={optionsOpenAbove}
                  alignFromLeft={optionsAlignFromLeft}
                  onOpenChange={(open) => onSetOptionsOpen(block.id, open)}
                  onToggleOutline={() => onToggleOutline(block.id)}
                  onDelete={() => onDelete(block.id)}
                  onKeyDown={(event) => onOptionsKeyDown(block.id, event)}
                />
                {RESIZE_HANDLES.map((handle) => (
                  <button
                    key={handle.edge}
                    type="button"
                    data-text-resize-handle="true"
                    aria-label={handle.label}
                    title={handle.label}
                    className={`group absolute z-20 inline-grid touch-none place-items-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-selected-border)] ${handle.positionClass}`}
                    onPointerDown={(event) =>
                      onStartResize(block, handle.edge, event)
                    }
                    onPointerMove={onResize}
                    onPointerUp={onStopResize}
                    onPointerCancel={onStopResize}
                  >
                    <span
                      aria-hidden="true"
                      className={`rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition group-hover:scale-110 ${
                        onBlack ? "bg-white/75" : "bg-slate-950/55"
                      } ${handle.gripClass}`}
                    />
                  </button>
                ))}
              </>
            ) : null}

            {editing && editingEnabled ? (
              <NotebookTextEditor
                block={block}
                pageColor={pageColor}
                onSelect={onSelect}
                onChangeText={onChangeText}
                onStopEditing={onStopEditing}
              />
            ) : (
              <button
                type="button"
                aria-label={
                  block.text.trim()
                    ? `Select text box: ${block.text.slice(0, 80)}`
                    : "Select empty text box"
                }
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(block.id);
                }}
                className={`h-full w-full overflow-hidden whitespace-pre-wrap rounded-[0.45rem] border-0 bg-transparent p-2 pr-10 text-left text-sm font-medium leading-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-selected-border)] ${
                  onBlack ? "text-[#f8fafc]" : "text-slate-950"
                } ${block.text.trim() ? "" : "opacity-60"}`}
              >
                {displayText}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export { NotebookTextBlockLayer };

export default memo(NotebookTextBlockLayer);
