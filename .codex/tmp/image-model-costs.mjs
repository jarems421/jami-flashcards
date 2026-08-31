import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const res = await fetch("https://openrouter.ai/api/v1/models", {
  headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
});
const { data } = await res.json();
const imageOut = data.filter((m) => m.architecture?.output_modalities?.includes("image"));
console.log(`${imageOut.length} models on OpenRouter can output images\n`);
const rows = imageOut.map((m) => ({
  id: m.id,
  perImage: Number(m.pricing?.image ?? 0),
  perOutputTok: Number(m.pricing?.completion ?? 0),
  ctx: m.context_length,
}));
rows.sort((a, b) => (a.perImage || a.perOutputTok) - (b.perImage || b.perOutputTok));
console.log("per-image   per-Mout    model");
for (const r of rows) {
  console.log(
    `$${r.perImage.toFixed(5).padEnd(11)}$${(r.perOutputTok * 1e6).toFixed(2).padEnd(11)}${r.id}`
  );
}
process.exit(0);
