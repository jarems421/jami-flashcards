import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import type { Page } from "@playwright/test";

/*
 * Bundles the harness (Jami Ink's renderer, js-draw and the scenes) for a
 * blank page, with no app server and no production build. esbuild reads the
 * `@/` alias from tsconfig.json.
 */

const ROOT = process.cwd();
const ENTRY = path.join(ROOT, "e2e", "ink-engine", "harness", "entry.ts");
const JS_DRAW_CSS = path.join(ROOT, "node_modules", "js-draw", "dist", "Editor.css");

/**
 * What the notebook's own stylesheet does to js-draw's host
 * (`.notebook-js-draw-host` in app/globals.css), and js-draw's scroll
 * indicators hidden: they are not ink, and would be counted as a difference.
 */
const NOTEBOOK_JS_DRAW_CSS = `
  .imageEditorContainer, .imageEditorRenderArea { background: transparent !important; height: 100% !important; min-height: 0 !important; }
  .loadingMessage { display: none; }
  .ScrollbarTool-overlay { display: none !important; }
`;

let bundled: Promise<string> | null = null;

function bundle(): Promise<string> {
  bundled ??= build({
    entryPoints: [ENTRY],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    sourcemap: "inline",
    tsconfig: path.join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "warning",
  }).then((result) => result.outputFiles[0].text);
  return bundled;
}

/** A blank white page with the harness loaded and `window.inkHarness` ready. */
export async function openHarness(page: Page): Promise<void> {
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#fff"></body></html>`
  );
  await page.addStyleTag({ content: fs.readFileSync(JS_DRAW_CSS, "utf8") + NOTEBOOK_JS_DRAW_CSS });
  await page.addScriptTag({ content: await bundle() });
  await page.waitForFunction(() => typeof window.inkHarness === "object");
}
