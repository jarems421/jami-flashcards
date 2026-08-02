/**
 * Creates a deliberately large notebook so the ink split can be measured
 * rather than argued about.
 *
 * The split exists because opening a notebook used to fetch every page in
 * full. At three pages per notebook that is impossible to feel, so this builds
 * a notebook big enough to tell the difference on a real device.
 *
 * Writes real documents to whichever project the admin credentials point at.
 * It refuses to run without --yes, names the notebook so it is obvious what it
 * is, and everything it creates is removed by deleting that notebook in the
 * app.
 *
 *   node scripts/seed-large-notebook.mjs --pages 100 --yes
 *   node scripts/seed-large-notebook.mjs --pages 100 --split --yes
 *
 * Without --split, pages are written in the pre-split shape with ink inline,
 * which is what a notebook created before this change looks like. Open it,
 * time it, then draw on a few pages to convert them and compare.
 */
import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const NOTEBOOK_TITLE = "Ink split load test - safe to delete";
/** Firestore caps a batch at 500 operations; each page costs up to two. */
const OPERATIONS_PER_BATCH = 400;

function loadEnvLocal() {
  let raw;
  try {
    raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    // CI injects credentials directly; a missing file is not an error.
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
}

/** Roughly the SVG a page of dense handwriting produces. */
function buildInkSvg(pageNumber) {
  const paths = Array.from({ length: 60 }, (_unused, index) => {
    const y = 40 + index * 20;
    const points = Array.from(
      { length: 40 },
      (_p, step) => `${60 + step * 20},${y + Math.sin(step + pageNumber) * 6}`
    ).join(" ");
    return `<path d="M${points}" stroke="#111" stroke-width="2" fill="none"/>`;
  }).join("");
  return `<svg viewBox="0 0 900 1240" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
}

async function main() {
  const args = process.argv.slice(2);
  const pageCount = Number(args[args.indexOf("--pages") + 1]) || 100;
  const useSplitShape = args.includes("--split");

  loadEnvLocal();
  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.trim()?.replace(
    /\\n/g,
    "\n"
  );
  if (!projectId || !clientEmail || !privateKey) {
    console.error("Missing Firebase Admin credentials.");
    process.exit(1);
  }

  const email = args.includes("--email")
    ? args[args.indexOf("--email") + 1]
    : "jarems421@gmail.com";

  if (!args.includes("--yes")) {
    console.log(
      `\nWould create "${NOTEBOOK_TITLE}" with ${pageCount} pages ` +
        `(${useSplitShape ? "split" : "legacy inline"} ink)\n` +
        `  project: ${projectId}\n  account: ${email}\n\n` +
        "This writes real documents. Re-run with --yes to proceed.\n" +
        "Delete the notebook in the app to remove everything it creates.\n"
    );
    return;
  }

  if (getApps().length === 0) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }
  const db = getFirestore();
  const user = await getAuth().getUserByEmail(email);
  const userRef = db.collection("users").doc(user.uid);

  const folder = (await userRef.collection("studyFolders").limit(1).get())
    .docs[0];
  if (!folder) {
    console.error("No study folder found. Create one in the app first.");
    process.exit(1);
  }

  const now = Date.now();
  const notebookRef = userRef.collection("notebooks").doc();
  await notebookRef.set({
    folderId: folder.id,
    title: NOTEBOOK_TITLE,
    type: "free_working",
    topicIds: [],
    sourceIds: [],
    pageColor: "white",
    pageStyle: "lined",
    archived: false,
    createdAt: now,
    updatedAt: now,
  });

  let batch = db.batch();
  let operations = 0;
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const svg = buildInkSvg(pageNumber);
    const pageRef = userRef.collection("notebookPages").doc();
    const inkData = { version: 2, format: "js-draw-svg", svg };

    batch.set(pageRef, {
      notebookId: notebookRef.id,
      folderId: folder.id,
      pageNumber,
      pageType: "free_working",
      textBlocks: [],
      imageRefs: [],
      pageColor: "white",
      pageStyle: "lined",
      status: "working",
      contentRevision: 1,
      createdAt: now,
      updatedAt: now,
      ...(useSplitShape
        ? { thumbnail: { inkSvg: svg.slice(0, 24_000), strokes: [], inkOmitted: false } }
        : { inkData }),
    });
    operations += 1;

    if (useSplitShape) {
      batch.set(userRef.collection("notebookPageInk").doc(pageRef.id), {
        notebookId: notebookRef.id,
        inkData,
        contentRevision: 1,
        updatedAt: now,
      });
      operations += 1;
    }

    if (operations >= OPERATIONS_PER_BATCH) {
      await batch.commit();
      batch = db.batch();
      operations = 0;
    }
  }
  if (operations > 0) await batch.commit();

  const bytes = buildInkSvg(1).length * pageCount;
  console.log(
    `\nCreated "${NOTEBOOK_TITLE}" (${notebookRef.id}) with ${pageCount} pages.\n` +
      `Ink shape: ${useSplitShape ? "split" : "legacy inline"}\n` +
      `Roughly ${(bytes / 1_000_000).toFixed(1)} MB of ink across the notebook.\n` +
      "Open it on the device you care about and time it, then delete it in the app.\n"
  );
}

main().catch((error) => {
  console.error("Seeding failed:", error?.message ?? error);
  process.exit(1);
});
