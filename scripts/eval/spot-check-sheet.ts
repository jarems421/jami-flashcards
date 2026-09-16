/**
 * A paper's spot-check, as one file you can open without running anything.
 *
 * The check itself is a person looking at extracted questions beside the mark
 * scheme they were paired with -- that is the whole point of the gate, and it
 * is the one step no model may do on the owner's behalf. What it does not need
 * is a dev server: the images are already rendered and stored, so they are
 * inlined into a single HTML file that opens from disk, on any device, with
 * nothing running.
 *
 * The material stays on the owner's own machine. These are licensed exam-board
 * questions, and the licence covers storage, display to students and marking
 * inference -- not publishing them to a third-party host, which is what an
 * uploaded page would be.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/spot-check-sheet.ts [--paper=<id>] [--size=6] [--out=<path>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";
import type { ExamQuestion } from "@/lib/practice/exam-questions";

function flag(args: string[], name: string) {
  const match = args.find((arg) => arg.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : undefined;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function inlineImage(storagePath: string | undefined) {
  if (!storagePath) return null;
  try {
    const [bytes] = await getAdminStorageBucket().file(storagePath).download();
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Evenly spaced through the paper, so a sample cannot all come from page two. */
function sample<T>(items: T[], size: number): T[] {
  if (items.length <= size) return items;
  const step = items.length / size;
  return Array.from({ length: size }, (_, index) => items[Math.floor(index * step)]);
}

export default async function main(args: string[] = []) {
  const paperFilter = flag(args, "paper");
  const size = Number(flag(args, "size") ?? "6");
  const out = resolve(flag(args, "out") ?? "spot-check.html");

  const db = getAdminDb();
  const papers = await db.collection("examPapers").get();
  const sections: string[] = [];

  for (const paperDoc of papers.docs) {
    if (paperFilter && paperDoc.id !== paperFilter) continue;
    const paper = paperDoc.data();
    const questionDocs = await db.collection("examQuestions")
      .where("paperId", "==", paperDoc.id)
      .where("review.status", "==", "approved")
      .get();
    const questions = questionDocs.docs
      .map((doc) => ({ ...doc.data(), id: doc.id }) as ExamQuestion)
      .sort((a, b) => (a.label ?? "").localeCompare(b.label ?? "", undefined, { numeric: true }));
    if (questions.length === 0) continue;

    const drawn = sample(questions, size);
    const cards: string[] = [];
    for (const question of drawn) {
      const questionImage = await inlineImage(question.assets?.[0]?.storagePath);
      const schemeImage = await inlineImage(question.reviewAssets?.[0]?.storagePath);
      cards.push(`
        <article class="q">
          <header>
            <h3>${escapeHtml(question.label ?? question.id)}</h3>
            <!-- Named so a question this sample throws back can be named to spot-check.ts. -->
            <code class="qid">${escapeHtml(question.id)}</code>
            <span class="tariff">${question.marks} mark${question.marks === 1 ? "" : "s"}</span>
            <span class="calc">${
              question.calculatorAllowed === undefined
                ? "calculator policy unknown"
                : question.calculatorAllowed ? "calculator" : "non-calculator"
            }</span>
          </header>
          <div class="pair">
            <figure>
              <figcaption>What the student sees</figcaption>
              ${questionImage ? `<img src="${questionImage}" alt="${escapeHtml(question.label ?? "")}">` : `<p class="missing">No question image stored.</p>`}
            </figure>
            <figure>
              <figcaption>The mark scheme page it was paired with</figcaption>
              ${schemeImage ? `<img src="${schemeImage}" alt="Mark scheme page">` : `<p class="missing">No scheme page stored.</p>`}
            </figure>
          </div>
        </article>`);
    }

    sections.push(`
      <section>
        <h2>${escapeHtml(paper.specificationId)}/${escapeHtml(paper.componentCode)} ${escapeHtml(paper.series)} ${paper.year}</h2>
        <p class="meta">
          ${questions.length} approved question${questions.length === 1 ? "" : "s"},
          ${drawn.length} drawn evenly through the paper.
          <code>${paperDoc.id}</code>
        </p>
        ${cards.join("")}
      </section>`);
  }

  const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spot check</title>
<style>
  :root { color-scheme: light dark; --ink: #14181f; --muted: #5b6472; --line: #dfe3ea; --ground: #fbfbfd; --card: #ffffff; --accent: #1f5f4f; }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #e8ebf0; --muted: #9aa4b2; --line: #2b313b; --ground: #14171c; --card: #1b1f26; --accent: #6fcfb4; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--ground); color: var(--ink); font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 32px 20px 80px; }
  h1 { font-size: 1.6rem; margin: 0 0 6px; letter-spacing: -0.01em; }
  .lede { color: var(--muted); margin: 0 0 28px; max-width: 60ch; }
  .lede strong { color: var(--ink); }
  section { margin: 0 0 44px; }
  h2 { font-size: 1.15rem; margin: 0 0 4px; }
  .meta { color: var(--muted); font-size: 0.85rem; margin: 0 0 18px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.82em; background: var(--card); border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; }
  .qid { color: var(--muted); user-select: all; }
  .q { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px 16px; margin: 0 0 16px; }
  .q header { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
  .q h3 { font-size: 1rem; margin: 0; }
  .tariff, .calc { font-size: 0.78rem; color: var(--muted); border: 1px solid var(--line); border-radius: 99px; padding: 1px 9px; }
  .pair { display: grid; gap: 16px; grid-template-columns: 1fr; }
  @media (min-width: 900px) { .pair { grid-template-columns: 1fr 1fr; } }
  figure { margin: 0; }
  figcaption { font-size: 0.78rem; color: var(--muted); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.06em; }
  img { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
  .missing { color: var(--muted); font-style: italic; border: 1px dashed var(--line); border-radius: 6px; padding: 20px; text-align: center; }
  .what { background: var(--card); border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 8px; padding: 14px 16px; margin: 0 0 30px; }
  .what h2 { font-size: 0.95rem; margin: 0 0 8px; }
  .what ol { margin: 0; padding-left: 20px; color: var(--muted); }
  .what li { margin: 3px 0; }
</style>
</head>
<body>
<main>
  <h1>Spot check</h1>
  <p class="lede">
    A sample of the questions that would go live, each beside the mark scheme page it was
    paired with. <strong>Nothing here has been served to anyone.</strong>
  </p>
  <div class="what">
    <h2>What you are looking for</h2>
    <ol>
      <li>Is the question complete — nothing cut off at the top or bottom, and any figure it refers to actually present?</li>
      <li>Does the mark scheme page beside it belong to that question, rather than the one before or after?</li>
      <li>Does the tariff shown match what the paper prints?</li>
    </ol>
  </div>
  ${sections.join("")}
</main>
</body>
</html>`;

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html, "utf8");
  const mb = (Buffer.byteLength(html, "utf8") / 1_048_576).toFixed(1);
  console.log(`Wrote ${out} (${mb} MB)`);
}
