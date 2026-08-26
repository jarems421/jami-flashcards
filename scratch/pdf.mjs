import { readFileSync } from "node:fs";
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(process.argv[2])) }).promise;
console.log("pages:", doc.numPages);
for (let n = 1; n <= doc.numPages; n += 1) {
  const c = await (await doc.getPage(n)).getTextContent();
  const t = c.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
  if (t) console.log(`--- p${n} ---\n${t}`);
}
