/**
 * How big each notebook page document is, and how much of it is ink.
 *
 * Firestore refuses a document over 1 MiB, and ink is an SVG string stored on
 * the page. A page that grows past that stops saving -- which is what "it bugs
 * out after enough strokes" would look like from the outside.
 */
import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const { getAdminDb } = await import("../../services/firebase/admin.ts");
const db = getAdminDb();
const LIMIT = 1048576;
for (const uid of process.argv.slice(2)) {
  const pages = await db.collection("users").doc(uid).collection("notebookPages").get();
  const rows = pages.docs.map((d) => {
    const data = d.data();
    const svg = typeof data.inkSvg === "string" ? data.inkSvg : "";
    const total = Buffer.byteLength(JSON.stringify(data), "utf8");
    return {
      id: d.id,
      page: data.pageNumber,
      totalKB: Math.round(total / 1024),
      inkKB: Math.round(Buffer.byteLength(svg, "utf8") / 1024),
      paths: (svg.match(/<path/g) || []).length,
      pct: Math.round((total / LIMIT) * 100),
    };
  }).sort((a, b) => b.totalKB - a.totalKB);
  console.log(`\n${uid}: ${rows.length} pages`);
  console.log("  docKB  inkKB  paths  %of1MiB  page");
  for (const r of rows.slice(0, 10)) {
    console.log(
      `  ${String(r.totalKB).padStart(5)} ${String(r.inkKB).padStart(6)} ${String(r.paths).padStart(6)} ${String(r.pct).padStart(7)}%  p${r.page}`
    );
  }
  const over = rows.filter((r) => r.pct >= 80);
  if (over.length) console.log(`  !! ${over.length} page(s) at or past 80% of the document limit`);
}
process.exit(0);
