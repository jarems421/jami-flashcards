/**
 * Read several sittings of one component and report what is actually stable.
 *
 * The psychology profile was built from a single June 2022 paper and records
 * "Observed June 2022 tariffs: A 3+1+4+16, B 2+2+4+16 ...". One sitting cannot
 * tell a rule from a coincidence: whether Section A is always 24 marks is a
 * fact about the specification, whether it always opens with a 3-mark question
 * is a fact about that morning. Building a profile from one paper teaches the
 * designer both with equal confidence.
 *
 * So this takes a list of question papers for the same component, extracts each
 * one's tariffs and sections, and prints what holds across all of them beside
 * what varies. What holds goes in the profile; what varies goes in as a range,
 * or not at all.
 *
 * Usage:
 *   node extract-papers.mjs <url> <url> <url> [...]
 *
 * A paper whose tariffs do not sum to the others' total is reported rather than
 * averaged in -- it usually means the extraction missed a page, and a silently
 * wrong profile is the thing this whole exercise exists to stop producing.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pdfjs = require("pdfjs-dist/legacy/build/pdf.mjs");

const urls = process.argv.slice(2).filter((a) => a.startsWith("http"));
if (urls.length === 0) {
  console.log("give me some question paper URLs");
  process.exit(1);
}

/** Lines of a PDF, top to bottom, with items on the same baseline joined. */
async function pdfLines(bytes) {
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const rows = new Map();
    for (const item of content.items) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: item.transform[4], s: item.str });
    }
    pages.push(
      [...rows.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, parts]) => parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " ").trim())
        .filter(Boolean)
    );
  }
  return { pages, pageCount: doc.numPages };
}

const results = [];
for (const url of urls) {
  process.stdout.write(`fetching ${url.split("/").pop()} ... `);
  let bytes;
  try {
    const response = await fetch(url);
    if (!response.ok) { console.log(`HTTP ${response.status}`); continue; }
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    console.log("failed:", String(error).slice(0, 60));
    continue;
  }
  let read;
  try { read = await pdfLines(bytes); } catch (error) {
    console.log("unreadable:", String(error).slice(0, 60));
    continue;
  }
  const flat = read.pages.flat();
  const text = flat.join("\n");

  const tariffs = [...text.matchAll(/\[\s*(\d+)\s*marks?\s*\]/gi)].map((m) => Number(m[1]));
  const sections = [...new Set(
    [...text.matchAll(/\bSection\s+([A-F])\b/g)].map((m) => m[1])
  )].sort();
  const duration = /Time allowed:?\s*([^\n]{0,40})/i.exec(text)?.[1]?.trim();
  const calculator = /you must not use a calculator/i.test(text)
    ? "not_allowed"
    : /calculator/i.test(text) ? "mentioned" : "unstated";
  const stated = /(?:Total|maximum) (?:for this paper |raw mark )?(?:is |of )?(\d{2,3})\b/i.exec(text)?.[1];

  results.push({
    url,
    name: url.split("/").pop(),
    pages: read.pageCount,
    tariffs,
    sum: tariffs.reduce((a, b) => a + b, 0),
    count: tariffs.length,
    sections,
    duration,
    calculator,
    stated: stated ? Number(stated) : undefined,
  });
  console.log(`${read.pageCount}pp, ${tariffs.length} tariffs, sum ${tariffs.reduce((a, b) => a + b, 0)}`);
}

if (results.length === 0) { console.log("nothing readable"); process.exit(1); }

console.log("\n=== per paper ===");
for (const r of results) {
  console.log(
    `${r.name.padEnd(34)} sum ${String(r.sum).padStart(3)}  parts ${String(r.count).padStart(3)}  ` +
    `sections ${r.sections.join("") || "-"}  ${r.duration ?? "?"}  ${r.calculator}`
  );
}

const sums = [...new Set(results.map((r) => r.sum))];
const counts = results.map((r) => r.count);
const sectionSets = [...new Set(results.map((r) => r.sections.join("")))];

console.log("\n=== what holds ===");
console.log("total marks:", sums.length === 1 ? `${sums[0]} in every paper` : `VARIES ${sums.join(", ")} -- check the extraction`);
console.log("sections:", sectionSets.length === 1 ? (sectionSets[0] || "none in any paper") : `VARY: ${sectionSets.join(" | ")}`);
console.log("mark-bearing parts:", Math.min(...counts) === Math.max(...counts)
  ? `${counts[0]} in every paper`
  : `${Math.min(...counts)} to ${Math.max(...counts)}`);

const allTariffs = results.flatMap((r) => r.tariffs);
const dist = {};
for (const t of allTariffs) dist[t] = (dist[t] ?? 0) + 1;
console.log("tariff sizes seen:", Object.entries(dist)
  .sort((a, b) => Number(a[0]) - Number(b[0]))
  .map(([marks, n]) => `${marks}m x${n}`).join(", "));
console.log("largest single tariff:", Math.max(...allTariffs), "| smallest:", Math.min(...allTariffs));

// Where the big questions sit, as a fraction through the paper: the thing a
// designer needs to reproduce and the thing one paper cannot establish.
const positions = results.map((r) => {
  const big = r.tariffs.map((t, i) => ({ t, at: i / (r.tariffs.length - 1) })).filter((x) => x.t >= 4);
  return big.length ? (big.reduce((s, x) => s + x.at, 0) / big.length).toFixed(2) : "-";
});
console.log("mean position of 4+ mark parts (0 = start, 1 = end):", positions.join(", "));
process.exit(0);
