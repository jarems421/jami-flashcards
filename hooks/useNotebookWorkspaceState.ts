"use client";

import { useState } from "react";
import type { NotebookPageSwipeMotion } from "@/lib/workspace/notebook-carousel";
import type {
  NotebookEraserMode,
  NotebookEraserSize,
} from "@/lib/workspace/notebook-eraser";
import type { NotebookPagePan } from "@/lib/workspace/notebook-inking";
import { NOTEBOOK_PEN_SMOOTHING_DEFAULT } from "@/lib/workspace/notebook-pen-feel";
import type {
  NotebookPage,
  NotebookStrokeColor,
} from "@/lib/workspace/notebooks";

export type NotebookPageFrameSize = { width: number; height: number };
export type NotebookConfirmRequest =
  | { kind: "clear-page" }
  | { kind: "delete-page"; page: NotebookPage };

export function useNotebookDrawingToolState() {
  const [penColor, setPenColor] = useState<NotebookStrokeColor>("black");
  const [penThicknessPercent, setPenThicknessPercent] = useState(50);
  const [highlighterColor, setHighlighterColor] =
    useState<NotebookStrokeColor>("yellow");
  const [highlighterThicknessPercent, setHighlighterThicknessPercent] =
    useState(50);
  const [eraserMode, setEraserMode] =
    useState<NotebookEraserMode>("precision");
  const [eraserWidth, setEraserWidth] =
    useState<NotebookEraserSize>("medium");
  const [penMenuOpen, setPenMenuOpen] = useState(false);
  const [highlighterMenuOpen, setHighlighterMenuOpen] = useState(false);
  const [eraserMenuOpen, setEraserMenuOpen] = useState(false);
  const [touchInkHintVisible, setTouchInkHintVisible] = useState(false);
  // The stored preferences are read on the client after mount, so the server
  // and the first client render agree. See `readNotebookScribbleErasePreference`
  // and `readNotebookPenSmoothingPreference`.
  const [scribbleToErase, setScribbleToErase] = useState(true);
  const [penSmoothingPercent, setPenSmoothingPercent] = useState(
    NOTEBOOK_PEN_SMOOTHING_DEFAULT
  );
  return {
    penSmoothingPercent,
    setPenSmoothingPercent,
    penColor,
    setPenColor,
    penThicknessPercent,
    setPenThicknessPercent,
    highlighterColor,
    setHighlighterColor,
    highlighterThicknessPercent,
    setHighlighterThicknessPercent,
    eraserMode,
    setEraserMode,
    eraserWidth,
    setEraserWidth,
    penMenuOpen,
    setPenMenuOpen,
    highlighterMenuOpen,
    setHighlighterMenuOpen,
    eraserMenuOpen,
    setEraserMenuOpen,
    touchInkHintVisible,
    setTouchInkHintVisible,
    scribbleToErase,
    setScribbleToErase,
  };
}

export function useNotebookNavigationState() {
  const [pageZoom, setPageZoom] = useState(1);
  const [pagePan, setPagePan] = useState<NotebookPagePan>({ x: 0, y: 0 });
  const [frameSize, setFrameSize] = useState<NotebookPageFrameSize>({
    width: 0,
    height: 0,
  });
  const [pageSwipeMotion, setPageSwipeMotion] =
    useState<NotebookPageSwipeMotion | null>(null);
  const [pageSwipeInkSnapshot, setPageSwipeInkSnapshot] = useState<{
    pageId: string;
    svg: string;
  } | null>(null);

  return {
    pageZoom,
    setPageZoom,
    pagePan,
    setPagePan,
    frameSize,
    setFrameSize,
    pageSwipeMotion,
    setPageSwipeMotion,
    pageSwipeInkSnapshot,
    setPageSwipeInkSnapshot,
  };
}

export function useNotebookPageCreationState() {
  const [showAddPagesDialog, setShowAddPagesDialog] = useState(false);
  const [notebookFile, setNotebookFile] = useState<File | null>(null);
  const [notebookUploadProgress, setNotebookUploadProgress] = useState<
    number | null
  >(null);
  const [addingNotebookFile, setAddingNotebookFile] = useState(false);
  const [createPageActive, setCreatePageActive] = useState(false);
  const [createPageProgress, setCreatePageProgress] = useState(0);
  const [creatingPage, setCreatingPage] = useState(false);
  const [createPageBounce, setCreatePageBounce] = useState(false);
  const [deletingPageId, setDeletingPageId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] =
    useState<NotebookConfirmRequest | null>(null);
  const [inkEditorMountRevision, setInkEditorMountRevision] = useState(0);

  return {
    showAddPagesDialog,
    setShowAddPagesDialog,
    notebookFile,
    setNotebookFile,
    notebookUploadProgress,
    setNotebookUploadProgress,
    addingNotebookFile,
    setAddingNotebookFile,
    createPageActive,
    setCreatePageActive,
    createPageProgress,
    setCreatePageProgress,
    creatingPage,
    setCreatingPage,
    createPageBounce,
    setCreatePageBounce,
    deletingPageId,
    setDeletingPageId,
    confirmDialog,
    setConfirmDialog,
    inkEditorMountRevision,
    setInkEditorMountRevision,
  };
}

export function useNotebookPanelState() {
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [pagesDrawerOpen, setPagesDrawerOpen] = useState(false);
  const [isPhoneLayout, setIsPhoneLayout] = useState(false);
  const [phoneFullEditing, setPhoneFullEditing] = useState(false);

  return {
    assistantOpen,
    setAssistantOpen,
    pagesDrawerOpen,
    setPagesDrawerOpen,
    isPhoneLayout,
    setIsPhoneLayout,
    phoneFullEditing,
    setPhoneFullEditing,
  };
}
