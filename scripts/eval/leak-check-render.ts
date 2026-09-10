import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";

/**
 * Render a few candidate-evidence pages so a person can look at them.
 *
 * Board exemplar scripts are published to show examiners how a scheme was
 * applied, so they very often carry the annotations that go with that: ticks,
 * method-mark codes in the margin, a total in a box. A marker handed a page
 * like that is not reading a student's answer, it is reading the answer key,
 * and every figure from that run would be worthless in a way no aggregate
 * would reveal.
 *
 * Rendering, not judging. The output goes to artifacts/leak-check for
 * inspection.
 *
 *   node scripts/run-ts.mjs scripts/eval/leak-check-render.ts <pdf> <page> [...pages]
 */
const OUT = resolve("artifacts/leak-check");

export default async function main(args: string[]) {
  const [file, ...pages] = args;
  if (!file) throw new Error("Pass a PDF path and one or more page numbers.");
  mkdirSync(OUT, { recursive: true });
  const [pdfjs] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.mjs").catch(() => null),
  ]);
  const data = new Uint8Array(readFileSync(file));
  const pdf = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  console.log(`${file}: ${pdf.numPages} pages`);
  for (const raw of pages.length ? pages : ["1"]) {
    const pageNumber = Number(raw);
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, 1400 / Math.max(1, baseViewport.width)) });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    await page.render({
      canvas: canvas as never,
      canvasContext: context as never,
      viewport,
    }).promise;
    const out = resolve(OUT, `page-${pageNumber}.png`);
    writeFileSync(out, canvas.toBuffer("image/png"));
    console.log(`  wrote ${out}`);
  }
}
