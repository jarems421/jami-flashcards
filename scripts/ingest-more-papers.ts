/**
 * Add more sittings of the papers the corpus already holds.
 *
 * The corpus is one sitting deep on almost every course -- June 2023 -- so a
 * student who works through Biology has seen all of it. This walks the same
 * internal endpoints the corpus workspace does, for a checked-in list of
 * papers, so adding fifty-two of them is one command rather than fifty-two
 * trips through the UI. It is the same API, the same reviewer authentication
 * and the same spend: the token is the owner's and has to be supplied.
 *
 * It does not, and cannot, sign anything off. Every paper it ingests lands
 * unchecked, and `isExamQuestionServable` holds all of it back from students
 * until a person spot-checks the paper. That gate is the point of the gate.
 *
 *   JAMI_BASE_URL=https://… JAMI_REVIEWER_UID=… \
 *     node --env-file-if-exists=.env.local scripts/run-ts.mjs scripts/ingest-more-papers.ts -- --dry-run --limit 1
 *
 * A reviewer's ID token lives an hour and fifty-two papers do not fit in one,
 * so the token is minted here rather than pasted: the admin credentials in
 * .env.local sign a custom token for `JAMI_REVIEWER_UID`, which is exchanged
 * for an ID token and re-minted before it expires. Pasting one still works --
 * set `JAMI_REVIEWER_TOKEN` instead -- and is the right choice on a machine
 * that should not hold the admin key.
 *
 * Flags:
 *   --dry-run      Run every stage, write nothing to the bank. Costs the same.
 *   --limit N      Stop after N papers. Start at 1.
 *   --course ID    Only this specification, e.g. 8461. Repeatable.
 *   --sittings N   How many extra sittings per paper (default 2).
 *   --force        Ingest even a sitting the corpus already holds.
 */
import process from "node:process";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";
import {
  EXAM_INGESTION_STAGE_LABELS,
  isExamIngestionFinished,
  type ExamIngestionJob,
} from "@/lib/practice/exam-ingestion-job";
import type { ExamPaperManifestDraft } from "@/lib/practice/exam-ingestion-manifest";
import type { ExamQuestion } from "@/lib/practice/exam-questions";

/**
 * The papers to deepen, by the component code the catalogue and the corpus
 * both use. Higher tier only where a course is tiered: a Foundation paper is a
 * different paper with different questions, and adding both tiers doubles a
 * bill and a spot-checking queue that is already the slow half of this.
 *
 * AQA Mathematics (8300) is deliberately absent -- maths is Edexcel here.
 */
const TARGETS: ReadonlyArray<{ board: string; specificationId: string; components: string[] }> = [
  // Combined Science is three sciences and six Higher papers, not two.
  { board: "aqa", specificationId: "8464", components: ["B/1H", "B/2H", "C/1H", "C/2H", "P/1H", "P/2H"] },
  { board: "aqa", specificationId: "8461", components: ["1H", "2H"] },
  { board: "aqa", specificationId: "8462", components: ["1H", "2H"] },
  { board: "aqa", specificationId: "8463", components: ["1H", "2H"] },
  { board: "aqa", specificationId: "8035", components: ["1", "2", "3"] },
  { board: "aqa", specificationId: "8700", components: ["1", "2"] },
  { board: "aqa", specificationId: "8702", components: ["1", "2"] },
  { board: "pearson_edexcel", specificationId: "1MA1", components: ["1MA1/1H", "1MA1/2H", "1MA1/3H"] },
  { board: "pearson_edexcel", specificationId: "1BS0", components: ["1BS0/01", "1BS0/02"] },
  /*
   * Reading and Writing only. Paper 1 is Listening and Paper 2 is Speaking --
   * a listening paper's PDF is unanswerable without its audio, so ingesting
   * one would put questions in front of a student that cannot be attempted and
   * cannot be fairly marked.
   */
  { board: "pearson_edexcel", specificationId: "1FR0", components: ["1FR0/3H", "1FR0/4H"] },
];

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const values = (name: string) =>
  args.flatMap((item, index) => (item === `--${name}` && args[index + 1] ? [args[index + 1]] : []));

const BASE_URL = (process.env.JAMI_BASE_URL ?? "").replace(/\/$/, "");
const PASTED_TOKEN = process.env.JAMI_REVIEWER_TOKEN ?? "";
const REVIEWER_UID = process.env.JAMI_REVIEWER_UID ?? "";
const WEB_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "";
const DRY_RUN = flag("dry-run");
const FORCE = flag("force");
const LIMIT = Number(value("limit") ?? Number.POSITIVE_INFINITY);
const SITTINGS = Math.max(1, Number(value("sittings") ?? 2));
const ONLY = new Set(values("course"));

/**
 * A reviewer ID token that outlives the run.
 *
 * Firebase ID tokens expire an hour after they are issued and nothing renews a
 * string pasted into an environment variable, so a fifty-two paper run died
 * somewhere around the thirtieth. The admin key already on this machine can
 * sign a custom token for the reviewer, and Identity Toolkit exchanges that
 * for an ID token -- which makes the expiry this script's problem to solve
 * rather than the operator's to keep noticing.
 *
 * Re-minted five minutes early, because a token that expires between the
 * request being sent and the stage being authorised fails the same way.
 */
let minted: { token: string; expiresAt: number } | null = null;

async function reviewerToken() {
  if (PASTED_TOKEN) return PASTED_TOKEN;
  if (minted && Date.now() < minted.expiresAt - 5 * 60_000) return minted.token;
  const custom = await getAdminAuth().createCustomToken(REVIEWER_UID);
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    }
  );
  const body = (await response.json().catch(() => null)) as
    | { idToken?: string; expiresIn?: string; error?: { message?: string } }
    | null;
  if (!response.ok || !body?.idToken) {
    throw new Error(`token_mint_failed: ${body?.error?.message ?? response.status}`);
  }
  minted = {
    token: body.idToken,
    expiresAt: Date.now() + Number(body.expiresIn ?? 3600) * 1000,
  };
  return minted.token;
}

async function internal(path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-jami-firebase-id-token": await reviewerToken(),
      ...(init.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(`${response.status} ${String(body?.error ?? "request_failed")}`);
  }
  return body ?? {};
}

/** Every sitting already held, so this only ever adds. */
async function heldSittings() {
  const snapshot = await getAdminDb().collection("examQuestions").select("provenance").get();
  const held = new Map<string, Set<string>>();
  for (const doc of snapshot.docs) {
    const p = (doc.data() as ExamQuestion).provenance;
    if (!p) continue;
    const key = `${p.specificationId}|${p.componentCode}`;
    held.set(key, (held.get(key) ?? new Set()).add(`${p.series} ${p.year}`));
  }
  return held;
}

/** Newest first, so "two more sittings" means the two most recent it has not got. */
function newestFirst(left: ExamPaperManifestDraft, right: ExamPaperManifestDraft) {
  return right.year - left.year || right.series.localeCompare(left.series);
}

async function ingestOne(manifest: ExamPaperManifestDraft) {
  const started = await internal("/api/internal/exam-questions/ingest", {
    method: "POST",
    body: JSON.stringify({ manifest, dryRun: DRY_RUN }),
  });
  let job = started.job as ExamIngestionJob;
  /*
   * The same guard the workspace uses. A job that is still not finished after
   * sixty stages is not going to be, and walking it further is only spending.
   */
  for (let step = 0; step < 60 && !isExamIngestionFinished(job); step += 1) {
    process.stdout.write(`\r    ${EXAM_INGESTION_STAGE_LABELS[job.stage]}…`.padEnd(60));
    const stepped = await internal(
      `/api/internal/exam-questions/ingest/${encodeURIComponent(job.id)}`,
      { method: "POST" }
    );
    job = stepped.job as ExamIngestionJob;
  }
  process.stdout.write(`\r${" ".repeat(62)}\r`);
  return job;
}

export default async function main() {
  if (!BASE_URL || (!PASTED_TOKEN && !REVIEWER_UID)) {
    console.error(
      "JAMI_BASE_URL is required, with one of JAMI_REVIEWER_UID or JAMI_REVIEWER_TOKEN.\n\n" +
        "  JAMI_REVIEWER_UID   your uid from PAPER_QUALITY_REVIEWER_UIDS. The script mints\n" +
        "                      its own token from the admin key in .env.local and renews it,\n" +
        "                      so a long run does not stop an hour in.\n" +
        "  JAMI_REVIEWER_TOKEN a token you pasted yourself, for a machine that should not\n" +
        "                      hold the admin key. Expires in an hour; the run stops cleanly\n" +
        "                      and resumes where it left off when you rerun it."
    );
    process.exitCode = 1;
    return;
  }
  if (!PASTED_TOKEN && !WEB_API_KEY) {
    console.error("NEXT_PUBLIC_FIREBASE_API_KEY is needed to exchange a minted token.");
    process.exitCode = 1;
    return;
  }
  if (!PASTED_TOKEN) {
    // Said out loud, because acting as the reviewer without signing in is the
    // whole point of the allowlist this is satisfying.
    console.log(`Minting reviewer tokens for ${REVIEWER_UID} from the local admin key.\n`);
  }

  const held = await heldSittings();
  const planned: ExamPaperManifestDraft[] = [];
  const unavailable: string[] = [];

  for (const target of TARGETS) {
    if (ONLY.size > 0 && !ONLY.has(target.specificationId)) continue;
    let manifests: ExamPaperManifestDraft[];
    try {
      const found = await internal("/api/internal/exam-questions/discover", {
        method: "POST",
        body: JSON.stringify({ board: target.board, specificationId: target.specificationId }),
      });
      manifests = (found.manifests ?? []) as ExamPaperManifestDraft[];
    } catch (error) {
      console.error(`  ${target.specificationId}: discovery failed -- ${(error as Error).message}`);
      continue;
    }
    for (const component of target.components) {
      const already = held.get(`${target.specificationId}|${component}`) ?? new Set<string>();
      const candidates = manifests
        .filter((manifest) => manifest.componentCode === component)
        .filter((manifest) => FORCE || !already.has(`${manifest.series} ${manifest.year}`))
        .sort(newestFirst)
        .slice(0, SITTINGS);
      if (candidates.length < SITTINGS) {
        unavailable.push(
          `${target.specificationId} ${component}: discovery offered ${candidates.length} of ${SITTINGS}`
        );
      }
      planned.push(...candidates);
    }
  }

  const queue = planned.slice(0, Number.isFinite(LIMIT) ? LIMIT : planned.length);
  console.log(
    `${queue.length} paper${queue.length === 1 ? "" : "s"} to ingest` +
      `${DRY_RUN ? " (dry run -- nothing is written)" : ""}\n`
  );
  for (const note of unavailable) console.log(`  not available: ${note}`);
  if (unavailable.length) console.log("");

  const results: Array<{ paper: string; outcome: string }> = [];
  for (const [index, manifest] of queue.entries()) {
    const name = `${manifest.specificationId} ${manifest.componentCode} ${manifest.series} ${manifest.year}`;
    console.log(`[${index + 1}/${queue.length}] ${name}`);
    try {
      const job = await ingestOne(manifest);
      if (job.stage === "failed") {
        results.push({ paper: name, outcome: `failed -- ${job.error ?? "stopped"}` });
        console.log(`    stopped: ${job.error ?? "no reason recorded"}`);
        continue;
      }
      const outcome =
        `${job.extracted ?? 0} extracted · ${job.published ?? 0} published · ` +
        `${job.needsReview ?? 0} to review`;
      results.push({ paper: name, outcome });
      console.log(`    ${outcome}`);
      for (const issue of (job.issueSummary ?? []).slice(0, 3)) {
        console.log(`      ${issue.count}× ${issue.issue}`);
      }
    } catch (error) {
      const message = (error as Error).message;
      results.push({ paper: name, outcome: `error -- ${message}` });
      console.log(`    error: ${message}`);
      // An expired token or a lost reviewer will fail every remaining paper
      // the same way, so stop rather than spend the list failing.
      if (/^40[13]/.test(message) || message.startsWith("token_mint_failed")) {
        console.log(
          PASTED_TOKEN
            ? "\n    Authentication failed -- the pasted token has most likely expired."
            : "\n    Authentication failed -- check the uid is in PAPER_QUALITY_REVIEWER_UIDS."
        );
        console.log("    Stopping. Rerunning skips every paper that already landed.");
        break;
      }
    }
  }

  console.log("\nSummary");
  for (const row of results) console.log(`  ${row.paper.padEnd(34)} ${row.outcome}`);
  if (!DRY_RUN && results.length > 0) {
    console.log(
      "\nNothing here is servable yet. Each paper needs your spot-check before a\n" +
        "student sees any of it -- run scripts/eval/corpus-readiness.ts to see what\n" +
        "is waiting."
    );
  }
}
