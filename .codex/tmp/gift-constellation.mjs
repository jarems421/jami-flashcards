/**
 * Fill one account's active constellation with a named, drawn sky.
 *
 * Written for a gift rather than for testing, so it is deliberately gentle with
 * what is already there: it renames the existing active constellation instead
 * of creating a second one -- only one may be active, and a real star already
 * earned in it deserves to stay inside the finished picture rather than be
 * archived to make room.
 *
 * Positions are not random. The larger stars sit on a heart traced from the
 * usual parametric curve and are joined into a closed loop; the rest scatter
 * around it, kept clear of the outline so the shape stays readable.
 *
 *   node --conditions=react-server .codex/tmp/gift-constellation.mjs <uid>
 *   node --conditions=react-server .codex/tmp/gift-constellation.mjs <uid> --write
 *   node --conditions=react-server .codex/tmp/gift-constellation.mjs <uid> --clear
 */
import { readFileSync } from "node:fs";

const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getAdminDb } = await import("../../services/firebase/admin.ts");
const { STAR_SCHEMA_VERSION, getEffectiveStarVisualSize } = await import(
  "../../lib/constellation/stars.ts"
);

const UID = process.argv[2];
const NAME = "i love you";
const PREFIX = "gift-star-";
const TOTAL = 40;
const HEART_POINTS = 14;
const MIN_VISUAL = 18;
const MAX_VISUAL = 52;
const CURVE_EXPONENT = 2.9;
const MIN_STORED = Math.log(2);
const MAX_STORED = Math.log(501);

if (!UID) {
  console.log("usage: gift-constellation.mjs <uid> [--write|--clear]");
  process.exit(1);
}

/** The stored size that draws at `visual` pixels: getStarVisualSize, inverted. */
function storedSizeForVisualSize(visual) {
  const normalized = (visual - MIN_VISUAL) / (MAX_VISUAL - MIN_VISUAL);
  return MIN_STORED + normalized ** (1 / CURVE_EXPONENT) * (MAX_STORED - MIN_STORED);
}

/** The classic heart curve, mapped into the sky's 0..100 percentage box. */
function heartAt(t) {
  const x = 16 * Math.sin(t) ** 3;
  const y =
    13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
  return { x: 50 + x * 2.35, y: 46 - y * 2.35 };
}

const heart = Array.from({ length: HEART_POINTS }, (_, index) =>
  heartAt((index / HEART_POINTS) * Math.PI * 2)
);

/** Distance to the nearest heart point, so scattered stars keep their distance. */
function clearsHeart(point, minimum) {
  return heart.every(
    (h) => Math.hypot(h.x - point.x, h.y - point.y) >= minimum
  );
}

let seed = 20_260_901;
const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

const scattered = [];
let attempts = 0;
while (scattered.length < TOTAL - HEART_POINTS && attempts < 8000) {
  attempts += 1;
  const point = { x: 5 + random() * 90, y: 6 + random() * 88 };
  if (!clearsHeart(point, 7)) continue;
  if (scattered.some((s) => Math.hypot(s.x - point.x, s.y - point.y) < 6)) continue;
  scattered.push(point);
}

const db = getAdminDb();
const userRef = db.collection("users").doc(UID);
const clearing = process.argv.includes("--clear");
const writing = process.argv.includes("--write") || clearing;

const constellations = await userRef.collection("constellations").get();
const active = constellations.docs.find(
  (doc) => (doc.data().status ?? "active") !== "finished"
);
if (!active) {
  console.log("no active constellation on this account");
  process.exit(1);
}

const existingStars = await userRef
  .collection("stars")
  .where("constellationId", "==", active.id)
  .get();
const gifted = existingStars.docs.filter((doc) => doc.id.startsWith(PREFIX));
const real = existingStars.docs.length - gifted.length;

console.log(`account:     ${UID}`);
console.log(`constellation: "${active.data().name}" (${active.id})`);
console.log(`stars now:   ${existingStars.docs.length} (${real} earned, ${gifted.length} gifted)`);

if (clearing) {
  if (!gifted.length) {
    console.log("nothing gifted to remove");
    process.exit(0);
  }
  const batch = db.batch();
  for (const doc of gifted) batch.delete(doc.ref);
  batch.update(active.ref, { starCount: real, lines: [], updatedAt: Date.now() });
  await batch.commit();
  console.log(`removed ${gifted.length} gifted stars and their lines`);
  process.exit(0);
}

const wanted = TOTAL - real - gifted.length;
if (wanted <= 0) {
  console.log(`already at ${TOTAL}; pass --clear first`);
  process.exit(0);
}

const now = Date.now();
const placements = [
  ...heart.map((point, index) => ({ point, index, onHeart: true })),
  ...scattered.map((point, index) => ({
    point,
    index: HEART_POINTS + index,
    onHeart: false,
  })),
].slice(0, wanted);

const stars = placements.map(({ point, index, onHeart }) => {
  const jitter = (Math.sin(index * 12.9898) + 1) / 2;
  // The heart carries the large stars so the shape reads first; the scatter
  // spreads across the whole range so the sky does not look uniform.
  const visual = onHeart
    ? 34 + jitter * 18
    : MIN_VISUAL + (30 - MIN_VISUAL) * jitter + (index % 3) * 2;

  return {
    id: `${PREFIX}${String(index).padStart(2, "0")}`,
    doc: {
      goalId: "",
      constellationId: active.id,
      size: storedSizeForVisualSize(Math.min(MAX_VISUAL, visual)),
      glow: 0.45 + jitter * 0.5,
      starSchemaVersion: STAR_SCHEMA_VERSION,
      rewardKind: "goal",
      position: { x: Number(point.x.toFixed(2)), y: Number(point.y.toFixed(2)) },
      createdAt: now - (placements.length - index) * 3_600_000,
    },
  };
});

const heartIds = stars.filter((_, i) => i < HEART_POINTS).map((s) => s.id);
const lines = heartIds.map((id, index) => {
  const next = heartIds[(index + 1) % heartIds.length];
  return id < next ? { a: id, b: next } : { a: next, b: id };
});

const drawn = stars
  .map((s) => getEffectiveStarVisualSize({ size: s.doc.size, isLegacyStar: false }))
  .sort((a, b) => a - b);

console.log(`rename to:   "${NAME}"`);
console.log(`writing:     ${stars.length} stars -> ${real + stars.length} of ${TOTAL}`);
console.log(`drawn sizes: ${drawn[0].toFixed(1)}px to ${drawn[drawn.length - 1].toFixed(1)}px`);
console.log(`lines:       ${lines.length} (a closed heart)`);

if (!writing) {
  console.log("\ndry run; pass --write to persist");
  process.exit(0);
}

const batch = db.batch();
for (const star of stars) {
  batch.set(userRef.collection("stars").doc(star.id), star.doc);
}
batch.update(active.ref, {
  name: NAME,
  starCount: real + stars.length,
  lines,
  updatedAt: now,
});
await batch.commit();

console.log(`\nwritten. "${NAME}" now holds ${real + stars.length} stars.`);
console.log("undo with: node --conditions=react-server .codex/tmp/gift-constellation.mjs " + UID + " --clear");
process.exit(0);
