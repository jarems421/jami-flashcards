/**
 * Fill the paper-testing account's active constellation to forty stars.
 *
 * There is no way to look at a full sky without completing forty goals, so the
 * only feedback the redesign has had is a harness. This writes the real
 * documents, through the real size curve, so the page can be judged as a
 * student would see it.
 *
 * Sizes are chosen by inverting getStarVisualSize rather than by picking
 * targetCards and hoping: the curve has an exponent of 2.9 over a 1..500 card
 * range, so evenly spaced goals cluster almost every star at the small end.
 * Asking for an even spread of *drawn* sizes and solving back for the stored
 * value is what actually fills the range.
 *
 * Every star carries starSchemaVersion, without which parseStarData dates it as
 * pre-preset and reads its size on the old 0..1 scale.
 *
 *   node .codex/tmp/fill-constellation.mjs           # dry run
 *   node .codex/tmp/fill-constellation.mjs --write
 *   node .codex/tmp/fill-constellation.mjs --clear    # remove what this wrote
 */
import { readFileSync } from "node:fs";

const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getAdminDb } = await import("../../services/firebase/admin.ts");
const { STAR_SCHEMA_VERSION, getDefaultStarPosition, getEffectiveStarVisualSize } =
  await import("../../lib/constellation/stars.ts");
const { MAX_STARS_PER_CONSTELLATION } = await import(
  "../../lib/constellation/constellations.ts"
);

const UID = "PPm4x6PcMMQiZlmEKJ8rHCeVMm63";
const SEED_PREFIX = "seed-sky-";
const MIN_VISUAL = 18;
const MAX_VISUAL = 52;
const CURVE_EXPONENT = 2.9;
const MIN_STORED = Math.log(2); // a 1-card goal
const MAX_STORED = Math.log(501); // the 500-card reference

/** The stored size that draws at `visual` pixels: getStarVisualSize, inverted. */
function storedSizeForVisualSize(visual) {
  const normalized = (visual - MIN_VISUAL) / (MAX_VISUAL - MIN_VISUAL);
  return MIN_STORED + normalized ** (1 / CURVE_EXPONENT) * (MAX_STORED - MIN_STORED);
}

const db = getAdminDb();
const userRef = db.collection("users").doc(UID);
const clearing = process.argv.includes("--clear");
const writing = process.argv.includes("--write") || clearing;

const constellationsSnapshot = await userRef.collection("constellations").get();
const active = constellationsSnapshot.docs.find(
  (doc) => (doc.data().status ?? "active") !== "finished"
);

if (!active) {
  console.log("no active constellation on this account; open the Stars page once first");
  process.exit(1);
}

const existingStars = await userRef
  .collection("stars")
  .where("constellationId", "==", active.id)
  .get();
const seeded = existingStars.docs.filter((doc) => doc.id.startsWith(SEED_PREFIX));
const real = existingStars.docs.length - seeded.length;

console.log(`constellation: ${active.data().name} (${active.id})`);
console.log(`  stars now:   ${existingStars.docs.length} (${real} real, ${seeded.length} seeded)`);

/*
 * Stars written between the presets being deleted and the schema marker
 * arriving carry neither, so parseStarData dates them as pre-preset and reads
 * their size on the old 0..1 scale -- an onboarding star drawn at 42px instead
 * of 18px. Nothing else can tell, so they are repaired here.
 */
const undated = existingStars.docs.filter((doc) => {
  const data = doc.data();
  return (
    data.presetId === undefined &&
    data.starSchemaVersion === undefined &&
    typeof data.size === "number" &&
    data.size > 0 &&
    data.size <= 1
  );
});
if (undated.length) {
  console.log(`  misdated:    ${undated.length} star(s) carrying no scale marker`);
}

if (clearing) {
  if (!seeded.length) {
    console.log("nothing seeded to remove");
    process.exit(0);
  }
  const batch = db.batch();
  for (const doc of seeded) batch.delete(doc.ref);
  batch.update(active.ref, { starCount: real, updatedAt: Date.now() });
  await batch.commit();
  console.log(`removed ${seeded.length} seeded stars; starCount back to ${real}`);
  process.exit(0);
}

const maxStars = active.data().maxStars ?? MAX_STARS_PER_CONSTELLATION;
const wanted = maxStars - real;

if (wanted <= 0) {
  console.log(`already full at ${maxStars}; pass --clear to remove seeded stars first`);
  process.exit(0);
}

const now = Date.now();
const stars = Array.from({ length: wanted }, (_, index) => {
  const id = `${SEED_PREFIX}${String(index + 1).padStart(2, "0")}`;
  // An even spread of drawn sizes, nudged so it does not read as a gradient.
  const along = wanted === 1 ? 0.5 : index / (wanted - 1);
  const jitter = (Math.sin(index * 12.9898) + 1) / 2;
  // Jitter is symmetric around the ramp and allowed to overshoot at the ends,
  // so the spread reaches 18 and 52 instead of stopping short of both.
  const spread = Math.min(1, Math.max(0, along + (jitter - 0.5) * 0.18));
  const visual = MIN_VISUAL + (MAX_VISUAL - MIN_VISUAL) * spread;

  return {
    id,
    doc: {
      goalId: "",
      constellationId: active.id,
      size: storedSizeForVisualSize(visual),
      glow: 0.25 + jitter * 0.7,
      starSchemaVersion: STAR_SCHEMA_VERSION,
      rewardKind: "goal",
      // Seeded from the id, the same call the real write paths make, so these
      // scatter the way earned stars do rather than landing on a grid.
      position: getDefaultStarPosition(id),
      createdAt: now - (wanted - index) * 86_400_000,
    },
  };
});

const drawn = stars
  .map((star) =>
    getEffectiveStarVisualSize({
      size: star.doc.size,
      isLegacyStar: false,
    })
  )
  .sort((a, b) => a - b);

console.log(`  writing:     ${wanted} stars -> ${real + wanted} of ${maxStars}`);
console.log(`  drawn sizes: ${drawn[0].toFixed(1)}px to ${drawn[drawn.length - 1].toFixed(1)}px`);
console.log(
  `  sparkling:   ${drawn.filter((size) => size >= 30).length} of ${wanted} (>= 30px)`
);

if (!writing) {
  console.log("\ndry run; pass --write to persist");
  process.exit(0);
}

const batch = db.batch();
for (const doc of undated) {
  batch.update(doc.ref, { starSchemaVersion: STAR_SCHEMA_VERSION });
}
for (const star of stars) {
  batch.set(userRef.collection("stars").doc(star.id), star.doc);
}
batch.update(active.ref, { starCount: real + wanted, updatedAt: now });
await batch.commit();

console.log(`\nwritten. ${active.data().name} is now full at ${real + wanted} stars.`);
console.log("undo with: node .codex/tmp/fill-constellation.mjs --clear");
process.exit(0);
