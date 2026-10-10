"use client";
import { forwardRef } from "react";
import { JamiInkEditor } from "@/components/workspace/JamiInkEditor";
import { JsDrawInkEditor } from "@/components/workspace/JsDrawInkEditor";
import type {
  NotebookInkEditorHandle,
  NotebookInkEditorProps,
} from "@/components/workspace/notebook-ink-editor-types";
import { featureFlags } from "@/lib/app/feature-flags";

export type { NotebookInkEditorHandle };

/**
 * A notebook page's ink, in notebooks and on the exam working sheet.
 *
 * Jami's own engine when `enableJamiInk` is on (`docs/notebook-ink.md`),
 * js-draw otherwise. Both take the same props and answer the same handle, so
 * neither caller knows which one it has.
 */
export const NotebookInkEditor = forwardRef<NotebookInkEditorHandle, NotebookInkEditorProps>(
  function NotebookInkEditor(props, forwardedRef) {
    const Editor = featureFlags.enableJamiInk ? JamiInkEditor : JsDrawInkEditor;
    return <Editor {...props} ref={forwardedRef} />;
  }
);
