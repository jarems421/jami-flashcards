import { readFileSync, writeFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
process.env.AI_TUTOR_IMAGES_ENABLED = "true";
const { buildAiCapabilityRegistry } = await import("../../lib/ai/provider-policy.ts");
const gemini = await import("../../lib/ai/gemini.ts");
console.log("tutorImage model:", buildAiCapabilityRegistry(process.env).tutorImage?.modelId);
const at = Date.now();
try {
  const image = await gemini.generateGeminiImage({
    role: "tutorImage",
    prompt:
      "A simple, clear teaching illustration for a GCSE student explaining the water cycle: " +
      "evaporation from the sea, condensation into cloud, precipitation over hills, and runoff " +
      "back to the sea. Clean flat style, plain background, arrows showing the direction of flow.",
    aspectRatio: "4:3",
    imageSize: "1K",
    timeoutMs: 90_000,
  });
  const bytes = Buffer.from(image.data ?? image.base64 ?? "", "base64");
  writeFileSync("tutor-probe.png", bytes);
  console.log(`ok in ${Math.round((Date.now() - at) / 1000)}s, ${bytes.length} bytes -> tutor-probe.png`);
} catch (error) {
  console.log("FAILED:", String(error).slice(0, 220));
}
process.exit(0);
