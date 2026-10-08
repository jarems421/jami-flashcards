"use client";

import { useMemo, useState } from "react";
import { onScreenFloatingRects } from "@/components/ai/JamiFloatingTutor";
import NotebookSheetPanel, { useNotebookSheetFrames } from "@/components/workspace/NotebookSheetPanel";
import NotebookSheetPicker from "@/components/workspace/NotebookSheetPicker";
import ToolbarIconButton from "@/components/workspace/NotebookToolbarIconButton";
import { useFolderSheetChoices, useNotebookSheets, useNotebookSheetUpload } from "@/hooks/useNotebookSheet";
import type { TutorAttachment } from "@/lib/ai/tutor-attachments";
import {
  MAX_NOTEBOOK_SHEETS,
  notebookSheetFromAttachment,
  notebookSheetsFromNotebookFiles,
  type NotebookSheet,
} from "@/lib/workspace/notebook-sheet";
import type { NotebookFile } from "@/lib/workspace/notebooks";

/**
 * Sheets kept beside the page -- question sheets or mark schemes to work from
 * without swiping away -- up to three, and the picker for choosing one.
 */
export function useNotebookSheetsBeside({
  notebookId,
  userId,
  folderId,
  files,
}: {
  notebookId: string;
  userId: string;
  folderId: string;
  /** The notebook's own imported files, offered first in the picker. */
  files: readonly NotebookFile[];
}) {
  const kept = useNotebookSheets(notebookId);
  const frames = useNotebookSheetFrames(
    kept.open,
    Array.from({ length: MAX_NOTEBOOK_SHEETS }, (_, slot) =>
      kept.sheets.some((sheet) => sheet.slot === slot)
    )
  );
  /** What the picker is choosing for: another sheet (no slot), or a different one in a panel. */
  const [picker, setPicker] = useState<{ replaceSlot: number | null } | null>(null);
  const folderChoices = useFolderSheetChoices({ userId, folderId, enabled: picker !== null });
  const notebookChoices = useMemo(() => notebookSheetsFromNotebookFiles(files), [files]);
  const sheetUpload = useNotebookSheetUpload({ userId, folderId });

  const keep = (sheet: NotebookSheet) => {
    // Measured before the new panel exists, so it lands clear of the Tutor
    // card, pinned answers and the other sheets rather than on top of one.
    const onScreen = onScreenFloatingRects();
    const { slot, added } = kept.add(sheet);
    if (added && onScreen.length > 0) frames[slot].moveClearOf(onScreen);
  };

  /** What the picker was opened for, done with `sheet`: a new panel, or this panel's sheet changed. */
  const choose = (sheet: NotebookSheet) => {
    const replaceSlot = picker?.replaceSlot ?? null;
    if (replaceSlot !== null) kept.replace(replaceSlot, sheet);
    else keep(sheet);
    setPicker(null);
  };

  return {
    kept,
    frames,
    picker,
    setPicker,
    folderChoices,
    notebookChoices,
    keep,
    choose,
    sheetUpload,
    canUpload: Boolean(folderId),
    /** A file sent to the Tutor, kept beside the page from the chat itself. */
    keepAttachment: (attachment: TutorAttachment) => {
      const sheet = notebookSheetFromAttachment(attachment);
      if (sheet) keep(sheet);
    },
  };
}

export type NotebookSheetsBesideController = ReturnType<typeof useNotebookSheetsBeside>;

/** The toolbar button: keeps a first sheet, or shows and hides the ones kept. */
export function NotebookSheetsButton({ sheets }: { sheets: NotebookSheetsBesideController }) {
  const { kept, setPicker } = sheets;
  const count = kept.sheets.length;
  return (
    <ToolbarIconButton
      label={
        count === 0
          ? "Keep a sheet beside the page"
          : kept.open
            ? count > 1 ? "Hide sheets" : "Hide sheet"
            : count > 1
              ? `Show ${count} sheets`
              : `Show sheet: ${kept.sheets[0].sheet.title}`
      }
      icon="sheet"
      active={kept.open}
      pressed={count > 0 ? kept.open : undefined}
      onClick={() => {
        if (count > 0) kept.setOpen(!kept.open);
        else setPicker({ replaceSlot: null });
      }}
    >
      {count > 0 && !kept.open ? (
        // Kept but hidden: one tap brings them back.
        <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" />
      ) : null}
    </ToolbarIconButton>
  );
}

/** The kept sheets' panels and the picker; nothing at all while `hidden`. */
export default function NotebookSheetsLayer({
  sheets,
  hidden,
}: {
  sheets: NotebookSheetsBesideController;
  hidden: boolean;
}) {
  const { kept, frames, picker, setPicker, folderChoices, notebookChoices, choose, sheetUpload, canUpload } = sheets;
  return (
    <>
      {!hidden && kept.open
        ? kept.sheets.map((entry) => (
            <NotebookSheetPanel
              key={entry.slot}
              frame={frames[entry.slot]}
              sheet={entry.sheet}
              page={entry.page ?? 0}
              sheetCount={kept.sheets.length}
              onChange={() => setPicker({ replaceSlot: entry.slot })}
              onPageChange={(page) => kept.setPage(entry.slot, page)}
              onAdd={
                kept.sheets.length < MAX_NOTEBOOK_SHEETS
                  ? () => setPicker({ replaceSlot: null })
                  : undefined
              }
              onHide={() => kept.setOpen(false)}
              onClose={() => kept.remove(entry.slot)}
            />
          ))
        : null}
      <NotebookSheetPicker
        open={picker !== null && !hidden}
        replacing={picker?.replaceSlot != null}
        firstSheet={kept.sheets.length === 0}
        notebookSheets={notebookChoices}
        folderSheets={folderChoices.sheets}
        folderLoading={folderChoices.loading}
        folderFailed={folderChoices.failed}
        keptPaths={kept.sheets.map((entry) => entry.sheet.storagePath)}
        upload={sheetUpload.upload}
        canUpload={canUpload}
        onUpload={(file) => void sheetUpload.start(file, choose)}
        onPick={choose}
        onCancel={() => {
          sheetUpload.clear();
          setPicker(null);
        }}
      />
    </>
  );
}
