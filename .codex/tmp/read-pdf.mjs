/**
 * Text out of an exam board's PDF.
 *
 * A profile is only worth what its source is. Psychology's tariffs -- the line
 * that took the designer from 178 marks to 96 -- were read off a real June 2022
 * question paper, and every profile without that kind of reading is the one
 * that says "80 marks" and nothing else. This is how the reading gets done for
 * the rest of them, so the figures come from the document rather than from
 * anyone's memory of the subject.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfjs = require("pdfjs-dist/legacy/build/pdf.mjs");

const path = process.argv[2];
const from = Number(process.argv[3] ?? 1);
const to = Number(process.argv[4] ?? 0);

const data = new Uint8Array(readFileSync(path));
const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
const last = to > 0 ? Math.min(to, doc.numPages) : doc.numPages;
console.log(`# ${path} — ${doc.numPages} pages\n`);

for (let n = from; n <= last; n += 1) {
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  // Group items into lines by their y position, so "[3 marks]" stays with the
  // question it sits beside rather than becoming a loose token.
  const lines = new Map();
  for (const item of content.items) {
    if (!item.str?.trim()) continue;
    const y = Math.round(item.transform[5]);
    if (!lines.has(y)) lines.set(y, []);
    lines.get(y).push({ x: item.transform[4], s: item.str });
  }
  const text = [...lines.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, parts]) => parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  console.log(`--- page ${n} ---\n${text}\n`);
}
process.exit(0);
