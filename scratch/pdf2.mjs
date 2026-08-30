import { readFileSync } from "node:fs";
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(process.argv[2])) }).promise;
let all = "";
for (let n = 1; n <= doc.numPages; n += 1) {
  const c = await (await doc.getPage(n)).getTextContent();
  all += " " + c.items.map((i) => i.str).join(" ");
}
const text = all.replace(/\s+/g, " ");
const marks = [...text.matchAll(/\[\s*(\d+)\s*marks?\s*\]/gi)].map((m) => Number(m[1]));
console.log("mark allocations found, in order:");
console.log(" ", marks.join(", "));
console.log("count:", marks.length, "| sum:", marks.reduce((a, b) => a + b, 0));
const sections = [...text.matchAll(/Section\s+([A-D])\b/g)].map((m) => m[1]);
console.log("section markers seen:", [...new Set(sections)].join(", "));
