import { parseInkColor } from "@/lib/ink/color";
import type { InkColor } from "@/lib/ink/model";
import { getNotebookInkColor } from "@/lib/workspace/notebook-ink-data";
import type { NotebookStrokeColor } from "@/lib/workspace/notebooks";

/** What an unreadable colour falls back to: the notebook's black. */
const FALLBACK_COLOR: InkColor = { r: 0x11, g: 0x18, b: 0x27, a: 1 };

/**
 * The colour a stroke of `tool` is drawn in for the colour the student picked.
 *
 * It is `getNotebookInkColor`, which `applyNotebookInkStyle` gives js-draw, so
 * the pen and the highlighter come out the same colour and translucency in
 * both engines. The highlighter's 0.42 is rounded to the 8 bits a saved page
 * keeps (107 of 255, the `6b` in the captured fixtures): live ink then draws
 * exactly what the page will reopen with, which keeps the lift at 0 pixels.
 */
export function inkColorForTool(
  selectedColor: NotebookStrokeColor,
  tool: "pen" | "highlighter"
): InkColor {
  const { color, opacity } = getNotebookInkColor(selectedColor, tool);
  const parsed = parseInkColor(color) ?? FALLBACK_COLOR;
  return { r: parsed.r, g: parsed.g, b: parsed.b, a: Math.round(opacity * 255) / 255 };
}
