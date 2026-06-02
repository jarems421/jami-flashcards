import type { NotebookStroke } from "@/lib/workspace/notebooks";

export function orderNotebookStrokesForRendering(strokes: NotebookStroke[]) {
  return [
    ...strokes.filter((stroke) => stroke.tool === "highlighter"),
    ...strokes.filter((stroke) => stroke.tool !== "highlighter"),
  ];
}
