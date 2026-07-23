import {
  prepareNotebookPageSnapshotForPersistence,
  type NotebookInkData,
  type NotebookStroke,
  type NotebookStrokeColor,
  type NotebookStrokeTool,
} from "@/lib/workspace/notebooks";

export const NOTEBOOK_INK_VERSION = 2;
export const NOTEBOOK_INK_FORMAT = "js-draw-svg";

const PEN_COLORS: Record<string, string> = {
  black: "#111827",
  white: "#f8fafc",
  red: "#ef4444",
  green: "#22c55e",
  yellow: "#fde047",
  pink: "#f9a8d4",
};

function escapeAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

export function getNotebookInkColor(
  color: NotebookStrokeColor,
  tool: NotebookStrokeTool
) {
  const resolved = color.startsWith("#") ? color : PEN_COLORS[color] ?? PEN_COLORS.black;
  return {
    color: resolved,
    opacity: tool === "highlighter" ? 0.42 : 1,
  };
}

export function legacyStrokesToJsDrawSvg(
  strokes: NotebookStroke[],
  width: number,
  height: number
) {
  const paths = strokes.flatMap((stroke) => {
    if (stroke.points.length === 0) return [];
    const { color, opacity } = getNotebookInkColor(stroke.color, stroke.tool);
    const path = stroke.points
      .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(" ");
    return [
      `<path d="${escapeAttribute(path)}" fill="none" stroke="${escapeAttribute(
        color
      )}" stroke-width="${stroke.width}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}" />`,
    ];
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${paths.join(
    ""
  )}</svg>`;
}

export function makeNotebookInkData(svg: string): NotebookInkData {
  const inkData: NotebookInkData = {
    version: NOTEBOOK_INK_VERSION,
    format: NOTEBOOK_INK_FORMAT,
    svg,
  };
  prepareNotebookPageSnapshotForPersistence({
    typedContent: "",
    textBlocks: [],
    inkData,
    pageColor: "white",
    pageStyle: "plain",
    status: "blank",
  });
  return inkData;
}
