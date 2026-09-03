/**
 * Draw a spider into somebody's sky.
 *
 * A one-off gift rather than a migration: it writes one finished constellation
 * and the stars that make up its figure, straight through the Admin SDK.
 *
 * Finished, deliberately. An active constellation is where the next earned star
 * lands, and a goal completed tomorrow would drop a 31st star into the middle of
 * the drawing. Finished constellations stay arrangeable, so the figure can still
 * be moved about -- it simply stops collecting.
 *
 *   node --env-file-if-exists=.env.local scripts/add-spider-constellation.mjs <email>
 *   node --env-file-if-exists=.env.local scripts/add-spider-constellation.mjs <email> --apply
 *
 * Without --apply it only reports what it would do.
 */
import process from "node:process";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const [email, ...flags] = process.argv.slice(2);
const apply = flags.includes("--apply");

if (!email) {
  process.stdout.write("usage: add-spider-constellation.mjs <email> [--apply]\n");
  process.exit(1);
}

const CONSTELLATION_ID = "spider";
const CONSTELLATION_NAME = "Arachne";
const MAX_STARS = 40;

/*
 * `size` is ln(targetCards + 1), which the app maps onto 18-52px through a
 * steep curve -- so these are chosen for how they draw, not for what they would
 * have taken to earn. `glow` is read as a 0..1 strength.
 */
const BODY = [
  { key: "eyes", x: 50, y: 30, cards: 60, glow: 1, label: "Eyes" },
  { key: "thorax", x: 50, y: 42, cards: 200, glow: 0.95, label: "Cephalothorax" },
  { key: "waist", x: 50, y: 55, cards: 40, glow: 0.8, label: "Pedicel" },
  { key: "abdomen", x: 50, y: 69, cards: 500, glow: 1, label: "Abdomen" },
  { key: "spinneret", x: 50, y: 86, cards: 120, glow: 0.9, label: "Spinnerets" },
];

const PALPS = [
  { key: "palp-left", x: 44, y: 24, cards: 5, glow: 0.75, label: "Left pedipalp" },
  { key: "palp-right", x: 56, y: 24, cards: 5, glow: 0.75, label: "Right pedipalp" },
];

/**
 * Four pairs of legs, given as the left side and mirrored across the middle.
 *
 * The front two pairs hang off the cephalothorax and the back two off the
 * pedicel, which is what stops the joints all radiating from one point and
 * makes the figure read as a spider rather than as a star burst.
 */
const LEGS = [
  { attach: "thorax", knee: [37, 32], mid: [25, 21], tip: [14, 12] },
  { attach: "thorax", knee: [34, 43], mid: [20, 38], tip: [7, 32] },
  { attach: "waist", knee: [34, 56], mid: [20, 61], tip: [7, 67] },
  { attach: "waist", knee: [37, 66], mid: [26, 77], tip: [15, 88] },
];

const JOINTS = [
  { part: "knee", cards: 35, glow: 0.62, label: "joint" },
  { part: "mid", cards: 8, glow: 0.5, label: "shin" },
  { part: "tip", cards: 30, glow: 0.85, label: "foot" },
];

function buildFigure() {
  const stars = [];
  const lines = [];

  for (const node of [...BODY, ...PALPS]) {
    stars.push({
      id: `spider-${node.key}`,
      x: node.x,
      y: node.y,
      cards: node.cards,
      glow: node.glow,
      label: node.label,
    });
  }

  // The spine, plus the two palps either side of the eyes.
  for (let index = 0; index < BODY.length - 1; index += 1) {
    lines.push([`spider-${BODY[index].key}`, `spider-${BODY[index + 1].key}`]);
  }
  for (const palp of PALPS) {
    lines.push([`spider-${palp.key}`, "spider-eyes"]);
  }

  LEGS.forEach((leg, pair) => {
    for (const side of ["left", "right"]) {
      const mirror = (x) => (side === "left" ? x : 100 - x);
      const ids = JOINTS.map((joint) => {
        const [x, y] = leg[joint.part];
        const id = `spider-leg-${side}-${pair + 1}-${joint.part}`;
        stars.push({
          id,
          x: mirror(x),
          y,
          cards: joint.cards,
          glow: joint.glow,
          label: `${side === "left" ? "Left" : "Right"} leg ${pair + 1} ${joint.label}`,
        });
        return id;
      });

      lines.push([`spider-${leg.attach}`, ids[0]], [ids[0], ids[1]], [ids[1], ids[2]]);
    }
  });

  return { stars, lines };
}

function orderedLine([a, b]) {
  return a < b ? { a, b } : { a: b, b: a };
}

const { stars, lines } = buildFigure();

if (stars.length > MAX_STARS) {
  process.stdout.write(`The figure needs ${stars.length} stars; the cap is ${MAX_STARS}.\n`);
  process.exit(1);
}

const projectId =
  process.env.FIREBASE_ADMIN_PROJECT_ID?.trim() ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.trim()?.replace(/\\n/g, "\n");

if (!projectId || !clientEmail || !privateKey) {
  process.stdout.write("Missing FIREBASE_ADMIN_* environment variables.\n");
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });
}

const auth = getAuth();
const db = getFirestore();

/**
 * Every account on this address, with the providers behind each.
 *
 * Firebase will usually keep one account per email, but it does not have to,
 * and the request named a sign-in method rather than a uid -- so the accounts
 * are listed and the Google one is picked deliberately.
 */
async function findAccounts(address) {
  const matches = [];
  let pageToken;

  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) {
      if (user.email?.toLowerCase() === address.toLowerCase()) matches.push(user);
    }
    pageToken = page.pageToken;
  } while (pageToken);

  return matches;
}

const accounts = await findAccounts(email);

if (!accounts.length) {
  process.stdout.write(`No account found for ${email}.\n`);
  process.exit(1);
}

process.stdout.write(`Accounts on ${email}:\n`);
for (const account of accounts) {
  const providers = account.providerData.map((entry) => entry.providerId).join(", ") || "none";
  process.stdout.write(`  ${account.uid}  providers: ${providers}\n`);
}

const google = accounts.filter((account) =>
  account.providerData.some((entry) => entry.providerId === "google.com")
);

if (google.length !== 1) {
  process.stdout.write(
    google.length
      ? `\n${google.length} Google accounts share this address; refusing to guess.\n`
      : "\nNo Google sign-in account on this address.\n"
  );
  process.exit(1);
}

const uid = google[0].uid;
process.stdout.write(`\nGoogle account: ${uid}\n`);
process.stdout.write(`Figure: ${stars.length} stars, ${lines.length} lines, named ${CONSTELLATION_NAME}.\n`);

const userRef = db.collection("users").doc(uid);
const constellationRef = userRef.collection("constellations").doc(CONSTELLATION_ID);
const existing = await constellationRef.get();

if (existing.exists) {
  process.stdout.write("A spider constellation is already on this account; nothing to do.\n");
  process.exit(0);
}

if (!apply) {
  process.stdout.write("\nDry run. Pass --apply to write it.\n");
  process.exit(0);
}

const createdAt = Date.now();
const batch = db.batch();

batch.set(constellationRef, {
  name: CONSTELLATION_NAME,
  // Finished, so the next earned star does not land in the middle of the
  // drawing. A finished constellation can still be arranged and rejoined.
  status: "finished",
  maxStars: MAX_STARS,
  starCount: stars.length,
  lines: lines.map(orderedLine),
  createdAt,
  finishedAt: createdAt,
});

stars.forEach((star, index) => {
  batch.set(userRef.collection("stars").doc(star.id), {
    goalId: star.id,
    constellationId: CONSTELLATION_ID,
    size: Math.log(star.cards + 1),
    glow: star.glow,
    // Says which scale `size` is on. Without it the star reads as pre-preset,
    // whose sizes were 0..1, and is drawn on entirely the wrong curve.
    starSchemaVersion: 2,
    position: { x: star.x, y: star.y },
    // Carries its own caption, the way the onboarding star does, so a star in
    // the figure names the part it is rather than an errand nobody ran.
    rewardKind: "onboarding",
    rewardLabel: star.label,
    createdAt: createdAt - index,
  });
});

await batch.commit();

process.stdout.write(`Written. ${stars.length} stars and ${lines.length} lines.\n`);
