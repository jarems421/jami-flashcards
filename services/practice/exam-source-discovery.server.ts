import "server-only";

import * as cheerio from "cheerio";
import { getExamSourceConnector } from "@/lib/practice/exam-source-connectors";
import { getAdminDb } from "@/services/firebase/admin";
import { isOfficialExamBoardUrl, type ExamBoardId } from "@/lib/practice/exam-formats";

function pairKey(value: string) {
  return value.toLowerCase().replace(/mark[-_ ]?scheme|question[-_ ]?paper|\b(?:ms|qp)\b/g, "").replace(/[^a-z0-9]/g, "");
}

export async function discoverOfficialExamSources(input: { board: ExamBoardId; specificationId: string }) {
  const connector = getExamSourceConnector(input.board);
  if (!connector) return [];
  const links: Array<{ url: string; label: string; scheme: boolean; key: string }> = [];
  for (const catalogueUrl of connector.catalogueUrls) {
    try {
      const response = await fetch(catalogueUrl, { headers: { "User-Agent": "Jami licensed exam corpus discovery" }, signal: AbortSignal.timeout(12_000) });
      if (!response.ok) continue;
      const html = await response.text();
      const $ = cheerio.load(html);
      $("a[href]").each((_index, element) => {
        const href = $(element).attr("href") ?? "";
        let url: string;
        try { url = new URL(href, catalogueUrl).toString(); } catch { return; }
        const label = `${$(element).text()} ${url}`.replace(/\s+/g, " ").trim();
        if (!/\.pdf(?:\?|$)/i.test(url) || !isOfficialExamBoardUrl(input.board, url)) return;
        if (input.specificationId && !label.toLowerCase().includes(input.specificationId.toLowerCase())) return;
        links.push({ url, label: label.slice(0, 300), scheme: /mark\s*scheme|markscheme|[_-]ms(?:[_\-.])/i.test(label), key: pairKey(label) });
      });
    } catch { /* one board root may be temporarily unavailable */ }
  }
  const papers = links.filter((item) => !item.scheme);
  const schemes = links.filter((item) => item.scheme);
  return papers.flatMap((paper) => {
    const scheme = schemes.find((candidate) => candidate.key === paper.key) ?? schemes.find((candidate) => candidate.key.includes(paper.key) || paper.key.includes(candidate.key));
    return scheme ? [{ questionPaperUrl: paper.url, markSchemeUrl: scheme.url, label: paper.label }] : [];
  }).slice(0, 50);
}

/** A board root is re-read at most once a day, however many sessions ask. */
const DISCOVERY_INTERVAL_MS = 24 * 60 * 60 * 1_000;

/**
 * Note that a course came up short, and go looking for its papers.
 *
 * This runs behind the student rather than in front of them. A crawl of a
 * board's catalogue takes seconds and produces links, not questions -- nothing
 * it finds can reach the session that triggered it, because ingestion is
 * owner-run and licence-gated. So the student is never made to wait on it; the
 * shortage they see is the honest answer, and this quietly builds the queue
 * that makes the answer better next term.
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
  await ref.set({
    board: input.board, specificationId: input.specificationId, subject: input.subject,
    status: "searching", searchedAt: now, requestCount: (existing?.requestCount ?? 0) + 1,
  }, { merge: true });
  const pairs = await discoverOfficialExamSources({ board: input.board, specificationId: input.specificationId })
    .catch(() => [] as Array<{ questionPaperUrl: string; markSchemeUrl: string; label: string }>);
  await ref.set({
    status: "needs_owner_review", pairs: pairs.slice(0, 50), pairCount: pairs.length, updatedAt: Date.now(),
  }, { merge: true });
}
