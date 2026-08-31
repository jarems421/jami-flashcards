/**
 * Do Gemini's roles actually happen?
 *
 * Grounded research and image generation are both wired, both gated behind
 * environment flags, and neither has been seen working in this session. Code
 * that exists is not code that runs: the format-research pass produced seven
 * profiles reading "verified, high confidence" with no sections and no tariffs,
 * which is what a pipeline looks like when it is running and not doing the job
 * anyone assumed it was doing.
 *
 * This calls each role once and reports what comes back.
 */
import { readFileSync, writeFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
if (process.argv.includes("--allow-images")) process.env.AI_PAPER_IMAGES_ENABLED = "true";

const { resolveAiProviderPolicy, buildAiCapabilityRegistry } = await import("../../lib/ai/provider-policy.ts");
const gemini = await import("../../lib/ai/gemini.ts");

const policy = resolveAiProviderPolicy(process.env);
const registry = buildAiCapabilityRegistry(process.env);
console.log("geminiReady:", policy.geminiReady);
console.log("research model:", registry.research?.modelId);
console.log("paperImage model:", registry.paperImage?.modelId);
console.log("AI_PAPER_IMAGES_ENABLED:", process.env.AI_PAPER_IMAGES_ENABLED ?? "(unset)");

console.log("\n--- grounded research ---");
const started = Date.now();
const research = await gemini.generateGroundedResearch({
  sanitizedQuery:
    "AQA GCSE Mathematics 8300 Higher tier Paper 1: total marks, duration, calculator policy",
  timeoutMs: 90_000,
});
if (!research.ok) {
  console.log("FAILED:", research.reason);
} else {
  console.log(`ok in ${Math.round((Date.now() - started) / 1000)}s`);
  console.log("citations:", research.citations?.length ?? 0);
  for (const citation of (research.citations ?? []).slice(0, 5)) {
    console.log("  -", (citation.url ?? citation.title ?? "").slice(0, 110));
  }
  console.log("brief (first 400 chars):\n", String(research.brief ?? "").slice(0, 400));
}

if (process.argv.includes("--allow-images")) {
  console.log("\n--- image generation ---");
  const at = Date.now();
  try {
    const image = await gemini.generateGeminiImage({
      role: "paperImage",
      prompt:
        "A clean black-and-white light micrograph of plant leaf cells for a GCSE biology exam paper, " +
        "showing cell walls and chloroplasts, no text or labels, plain white background.",
      aspectRatio: "4:3",
      imageSize: "1K",
      timeoutMs: 90_000,
    });
    const bytes = Buffer.from(image.data ?? image.base64 ?? "", "base64");
    writeFileSync("gemini-probe.png", bytes);
    console.log(`ok in ${Math.round((Date.now() - at) / 1000)}s, ${bytes.length} bytes -> gemini-probe.png`);
    if (image.description) console.log("model said:", String(image.description).slice(0, 200));
  } catch (error) {
    console.log("FAILED:", String(error).slice(0, 200));
  }
}
process.exit(0);
