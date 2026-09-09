import "server-only";

import { isOfficialExamBoardUrl, type ExamBoardId } from "@/lib/practice/exam-formats";
import {
  boardHasSourcePattern,
  distinctQuestionPaperUrls,
  examSourceCandidates,
  markSchemeUrlsFor,
  type ExamSeries,
  type ExamSourceCandidate,
} from "@/lib/practice/exam-source-patterns";
import { getAdminDb } from "@/services/firebase/admin";

/**
 * Finding a board's papers by asking for them, not by reading a listing.
 *
 * The previous version parsed each board's past-paper page for links to PDFs.
 * There are none: all three England boards serve a JavaScript search
 * interface, and the HTML behind it contains zero PDF links -- measured, on
 * all three. So it found nothing, silently, and a student clicking "find
 * matching questions" waited on a crawl that could never succeed.
 *
 * A board's files do have addresses, they are just not listed anywhere. So the
 * addresses are generated and checked with a HEAD request, which is cheap,
 * cannot be wrong about whether a file exists, and needs no HTML at all.
 */
const PROBE_CONCURRENCY = 8;
const PROBE_TIMEOUT_MS = 12_000;

async function exists(url: string) {
  if (!/^https:\/\//.test(url)) return false;
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: { "User-Agent": "Jami licensed exam corpus discovery" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const type = response.headers.get("content-type")?.split(";")[0]?.trim();
    return type === "application/pdf";
  } catch {
    return false;
  }
}

/** Check a list of URLs a few at a time, stopping when `until` is satisfied. */
async function probe(urls: string[], stopAfterFirst: boolean) {
  const found: string[] = [];
  for (let at = 0; at < urls.length; at += PROBE_CONCURRENCY) {
    const batch = urls.slice(at, at + PROBE_CONCURRENCY);
    const results = await Promise.all(batch.map(async (url) => ((await exists(url)) ? url : null)));
    for (const url of results) if (url) found.push(url);
    if (stopAfterFirst && found.length > 0) break;
  }
  return found;
}

export type ExamSourceSearch = {
  board: ExamBoardId;
  specificationId: string;
  componentCode: string;
  years: number[];
  series?: ExamSeries[];
};

/**
 * The papers a board actually serves for one component, over several years.
 *
 * A paper is confirmed before its mark scheme is looked for at all, because
 * most generated addresses are wrong by construction and there is no point
 * pairing something that does not exist. A paper without a scheme is dropped:
 * `markSchemeFor` has the principle -- a fabricated pairing gets marked
 * against, and the resulting figure measures the fabrication.
 */
export async function findExamPapersByPattern(
  search: ExamSourceSearch
): Promise<ExamSourceCandidate[]> {
  if (!boardHasSourcePattern(search.board)) return [];
  const seriesList = search.series ?? ["June", "November"];
  const confirmed: ExamSourceCandidate[] = [];
  for (const year of search.years) {
    for (const series of seriesList) {
      const candidates = examSourceCandidates({
        board: search.board,
        specificationId: search.specificationId,
        componentCode: search.componentCode,
        year,
        series,
      }).filter(
        (candidate) =>
          isOfficialExamBoardUrl(search.board, candidate.questionPaperUrl) &&
          isOfficialExamBoardUrl(search.board, candidate.markSchemeUrl)
      );
      if (candidates.length === 0) continue;

      const papers = await probe(distinctQuestionPaperUrls(candidates), true);
      const questionPaperUrl = papers[0];
      if (!questionPaperUrl) continue;

      const schemes = await probe(markSchemeUrlsFor(candidates, questionPaperUrl), true);
      const markSchemeUrl = schemes[0];
      if (!markSchemeUrl) continue;

      confirmed.push({
        questionPaperUrl,
        markSchemeUrl,
        label: `${search.specificationId}/${search.componentCode} ${series} ${year}`,
      });
    }
  }
  return confirmed;
}

/** A board root is re-read at most once a day, however many sessions ask. */
const DISCOVERY_INTERVAL_MS = 24 * 60 * 60 * 1_000;

/**
 * Note that a course came up short, and record that it did.
 *
 * This runs behind the student rather than in front of them. Nothing it finds
 * can reach the session that triggered it, because ingestion is owner-run and
 * licence-gated, so the student is never made to wait on it.
 */
export async function queueOfficialExamSourceDiscovery(input: {
  board: ExamBoardId;
  specificationId: string;
  subject: string;
}) {
  const db = getAdminDb();
  const id = `${input.board}_${input.specificationId}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 200);
  const ref = db.collection("examSourceDiscoveries").doc(id);
  const existing = (await ref.get()).data();
  const now = Date.now();
  if (typeof existing?.searchedAt === "number" && now - existing.searchedAt < DISCOVERY_INTERVAL_MS) return;
  await ref.set(
    {
      board: input.board,
      specificationId: input.specificationId,
      subject: input.subject,
      status: "needs_owner_review",
      searchedAt: now,
      requestCount: (existing?.requestCount ?? 0) + 1,
      patternAvailable: boardHasSourcePattern(input.board),
      updatedAt: now,
    },
    { merge: true }
  );
}
