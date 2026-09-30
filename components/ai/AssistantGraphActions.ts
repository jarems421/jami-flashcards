"use client";

import { createContext, useContext } from "react";
import type { NotebookGraphDraft } from "@/lib/workspace/notebook-graphs";

/**
 * What a graph in a Tutor answer can do where it is being read.
 *
 * Graphs are drawn inside the markdown renderer, which knows nothing of the
 * notebook. The drawer, which does, provides this; a surface with no page to
 * add to provides nothing, and the graph shows without the button.
 */
export type AssistantGraphActions = {
  canInsert: boolean;
  /** The graph being added, keyed by its source, while the write is in flight. */
  insertingKey: string | null;
  isInserted: (key: string) => boolean;
  insert: (key: string, graph: NotebookGraphDraft) => void;
  /**
   * Whether a drawn figure (a fenced `svg` block) can be added too. It lands as
   * a picture rather than an editable graph, so it is offered separately.
   */
  canInsertDrawing: boolean;
  insertDrawing: (key: string, svg: string) => void;
};

export const AssistantGraphActionsContext = createContext<AssistantGraphActions | null>(null);

export function useAssistantGraphActions() {
  return useContext(AssistantGraphActionsContext);
}
