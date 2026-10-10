/**
 * The page the harness draws on: a white stage at the top-left of the
 * viewport, showing one window of a notebook sheet, drawn either by js-draw
 * (set up exactly as the notebook sets it up) or by Jami Ink's renderer.
 */

import * as jsDraw from "js-draw";
import type { InkDocument } from "@/lib/ink/model";
import { createInkRenderer, type InkRenderer, type InkRendererOptions } from "@/lib/ink-dom/renderer";
import { createNotebookJsDrawEditor } from "@/lib/workspace/notebook-js-draw-setup";
import { installNotebookInkViewportSynchronizer } from "@/lib/workspace/notebook-ink-runtime";
import {
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
} from "@/lib/workspace/notebooks";

/** The sheet at a zoom: its laid-out size in CSS pixels. */
export type Sheet = { width: number; height: number };
/** The part of the sheet on the stage, in sheet CSS pixels. */
export type View = { left: number; top: number; width: number; height: number };

export function sheetAt(scale: number): Sheet {
  return { width: NOTEBOOK_PAGE_COORDINATE_WIDTH * scale, height: NOTEBOOK_PAGE_COORDINATE_HEIGHT * scale };
}

export function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

export async function frames(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) await nextFrame();
}

let teardown: (() => void) | null = null;

/** A fresh stage the size of the view; whatever was on the last one is taken down. */
export function resetStage(view: View): HTMLDivElement {
  teardown?.();
  teardown = null;
  document.getElementById("ink-stage")?.remove();
  const stage = document.createElement("div");
  stage.id = "ink-stage";
  Object.assign(stage.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: `${view.width}px`,
    height: `${view.height}px`,
    overflow: "hidden",
    background: "#ffffff",
  });
  document.body.appendChild(stage);
  return stage;
}

/** Draws an SVG page with js-draw, configured and windowed as the notebook does it. */
export async function renderWithJsDraw(svg: string, sheet: Sheet, view: View): Promise<void> {
  const stage = resetStage(view);
  const host = document.createElement("div");
  Object.assign(host.style, { position: "absolute", left: "0", top: "0", width: `${view.width}px`, height: `${view.height}px` });
  stage.appendChild(host);
  const editor = createNotebookJsDrawEditor(host, jsDraw);
  const root = editor.getRootElement();
  Object.assign(root.style, {
    width: "100%",
    height: "100%",
    minWidth: "0",
    minHeight: "0",
    background: "transparent",
    pointerEvents: "none",
  });
  const sync = installNotebookInkViewportSynchronizer({
    createScreenSize: (width, height) => jsDraw.Vec2.of(width, height),
    createTransform: (scaleX, scaleY, offsetX, offsetY) =>
      jsDraw.Mat33.translation(jsDraw.Vec2.of(-offsetX, -offsetY)).rightMul(
        jsDraw.Mat33.scaling2D(jsDraw.Vec2.of(scaleX, scaleY))
      ),
    editor,
    getDisplaySize: () => ({ width: view.width, height: view.height }),
    getRenderWindow: () => ({ sheetWidth: sheet.width, sheetHeight: sheet.height, ...view }),
    pageHeight: NOTEBOOK_PAGE_COORDINATE_HEIGHT,
    pageWidth: NOTEBOOK_PAGE_COORDINATE_WIDTH,
    shouldSkip: () => false,
  });
  const pageRect = new jsDraw.Rect2(0, 0, NOTEBOOK_PAGE_COORDINATE_WIDTH, NOTEBOOK_PAGE_COORDINATE_HEIGHT);
  editor.dispatchNoAnnounce(editor.image.setImportExportRect(pageRect), false);
  await editor.loadFromSVG(svg, true);
  editor.dispatchNoAnnounce(editor.image.setImportExportRect(pageRect), false);
  await frames(2);
  sync();
  await frames(2);
  teardown = () => editor.remove();
}

export type EngineStage = { renderer: InkRenderer; host: HTMLDivElement };

export type EngineStageOptions = {
  /** Called once every tile on screen is drawn (what the editor does to drop its static underlay). */
  onVisibleDrawn?: (renderer: InkRenderer) => void;
  /** Options for the renderer itself. */
  renderer?: InkRendererOptions;
  /**
   * What to wait for: the renderer to be idle (the default), or only for every
   * tile on screen to be drawn, leaving background work, a warm-up that holds
   * its frames included, to the caller.
   */
  wait?: "idle" | "visible";
};

/** Draws a document with Jami Ink's renderer and waits until every tile it wants is drawn. */
export async function renderWithEngine(
  doc: InkDocument,
  sheet: Sheet,
  view: View,
  options: EngineStageOptions = {}
): Promise<EngineStage> {
  const stage = resetStage(view);
  const host = document.createElement("div");
  Object.assign(host.style, {
    position: "absolute",
    left: `${-view.left}px`,
    top: `${-view.top}px`,
    width: `${sheet.width}px`,
    height: `${sheet.height}px`,
  });
  stage.appendChild(host);
  const renderer = createInkRenderer(host, options.renderer);
  renderer.setViewport({
    scale: sheet.width / NOTEBOOK_PAGE_COORDINATE_WIDTH,
    devicePixelRatio: window.devicePixelRatio,
    visible: view,
  });
  renderer.setDocument(doc);
  const { onVisibleDrawn } = options;
  const visible = new Promise<void>((resolve) =>
    renderer.whenVisibleDrawn(() => {
      onVisibleDrawn?.(renderer);
      resolve();
    })
  );
  teardown = () => renderer.destroy();
  if (options.wait === "visible") {
    await visible;
    await frames(2);
  } else {
    await whenIdle(renderer);
  }
  return { renderer, host };
}

export async function whenIdle(renderer: InkRenderer): Promise<void> {
  while (!renderer.idle) await nextFrame();
  await frames(2);
}
