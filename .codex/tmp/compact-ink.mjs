/**
 * Thin the points out of legacy ink on one account.
 *
 * Dry by default. Only pages whose ink actually shrinks are written, and each
 * write keeps the original under `inkDataBeforeCompaction` so it can be put
 * back -- this is somebody's handwriting, not a cache.
 *
 *   node --conditions=react-server .codex/tmp/compact-ink.mjs <uid>
 *   node --conditions=react-server .codex/tmp/compact-ink.mjs <uid> --write
 *   node --conditions=react-server .codex/tmp/compact-ink.mjs <uid> --restore
 */
import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const { getAdminDb } = await import("../../services/firebase/admin.ts");
const { compactNotebookInkSvg } = await import("../../lib/workspace/notebook-ink-compaction.ts");

const uid = process.argv[2];
const writing = process.argv.includes("--write");
const restoring = process.argv.includes("--restore");
if (!uid) { console.log("usage: compact-ink.mjs <uid> [--write|--restore]"); process.exit(1); }

const db = getAdminDb();
const pages = await db.collection("users").doc(uid).collection("notebookPages").get();
const kb = (n) => `${(n / 1024).toFixed(1)}KB`;

if (restoring) {
  const batch = db.batch();
  let n = 0;
  for (const doc of pages.docs) {
    const original = doc.data().inkDataBeforeCompaction;
    if (!original) continue;
    batch.update(doc.ref, { inkData: original, inkDataBeforeCompaction: null });
    n += 1;
  }
  if (!n) { console.log("nothing to restore"); process.exit(0); }
  await batch.commit();
  console.log(`restored ${n} page(s)`);
  process.exit(0);
}

let totalBefore = 0, totalAfter = 0, changed = 0;
const updates = [];
for (const doc of pages.docs) {
  const data = doc.data();
  const svg = data.inkData?.svg;
  if (typeof svg !== "string" || !svg) continue;

  const result = compactNotebookInkSvg(svg);
  totalBefore += result.bytesBefore;
  totalAfter += result.bytesAfter;
  if (result.bytesAfter >= result.bytesBefore) continue;

  changed += 1;
  const saved = 100 - Math.round((result.bytesAfter / result.bytesBefore) * 100);
  console.log(
    `p${data.pageNumber} ${doc.id}: ${kb(result.bytesBefore)} -> ${kb(result.bytesAfter)} (-${saved}%), ` +
    `points ${result.pointsBefore} -> ${result.pointsAfter}, ` +
    `${result.simplifiedPaths} strokes thinned, ${result.skippedPaths} left alone`
  );
  updates.push({
    ref: doc.ref,
    inkData: { ...data.inkData, svg: result.svg },
    original: data.inkDataBeforeCompaction ?? data.inkData,
  });
}

if (!changed) { console.log("nothing to compact"); process.exit(0); }
const saved = 100 - Math.round((totalAfter / totalBefore) * 100);
console.log(`\n${changed} page(s): ${kb(totalBefore)} -> ${kb(totalAfter)} (-${saved}% overall)`);

if (!writing) { console.log("\ndry run; pass --write to persist"); process.exit(0); }

const batch = db.batch();
for (const u of updates) {
  batch.update(u.ref, { inkData: u.inkData, inkDataBeforeCompaction: u.original });
}
await batch.commit();
console.log(`\nwritten. undo with --restore`);
process.exit(0);
