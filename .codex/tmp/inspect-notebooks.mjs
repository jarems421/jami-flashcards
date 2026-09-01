/** Read-only look at one account's notebooks and pages. */
import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const { getAdminDb } = await import("../../services/firebase/admin.ts");
const db = getAdminDb();
const uid = process.argv[2];
const user = db.collection("users").doc(uid);

const notebooks = await user.collection("notebooks").get();
console.log(`notebooks: ${notebooks.size}`);
for (const nb of notebooks.docs) {
  const d = nb.data();
  const pages = await user.collection("notebookPages").where("notebookId", "==", nb.id).get();
  console.log(`  "${d.title}" type=${d.type} pages=${pages.size} updated=${d.updatedAt ? new Date(d.updatedAt).toISOString().slice(0,10) : "?"}`);
  for (const pg of pages.docs.slice(0, 6)) {
    const p = pg.data();
    const strokes = Array.isArray(p.strokes) ? p.strokes.length : (p.inkSvg ? "inkSvg" : 0);
    console.log(`      p${p.pageNumber} type=${p.pageType} status=${p.status} strokes=${strokes} textObjects=${Array.isArray(p.textObjects)?p.textObjects.length:0} size=${JSON.stringify(pg._fieldsProto ? undefined : undefined) ?? ""}`);
  }
}
process.exit(0);
