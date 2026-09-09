import "server-only";

import { getAdminDb } from "@/services/firebase/admin";
import {
  ENGLAND_MATHS_AND_SCIENCE,
  type ExamCorpusTarget,
} from "@/lib/practice/exam-corpus-plan";
import { EXAM_BOARD_LABELS, type ExamBoardId } from "@/lib/practice/exam-formats";
import { buildExamPaperManifest } from "@/lib/practice/exam-ingestion-manifest";
import { getExamQuestionRights } from "@/lib/practice/exam-question-rights";
import { findExamPapersByPattern } from "@/services/practice/exam-source-discovery.server";
import { startExamIngestionJob } from "@/services/practice/exam-ingestion-job.server";

/**
 * Seeding the course catalogue from a list a person maintains.
 *
 * The catalogue is what ingestion checks a paper against, and it was being
 * filled by nightly AI research that found about one and a half entries per
 * board -- eighteen in total, none of them maths or science, so no paper in
 * the rollout could be ingested at all. Which specifications a board currently
 * offers is a fact, not a judgement, and a checked-in list of them is
 * reviewable in a diff and cannot hallucinate a qualification that does not
 * exist.
 *
 * The AI research still runs and still adds what it finds. This only
 * guarantees the courses actually being ingested are there.
 */
export async function seedExamFormatCatalogue(targets: readonly ExamCorpusTarget[] = ENGLAND_MATHS_AND_SCIENCE) {
  const db = getAdminDb();
  const now = Date.now();
  let batch = db.batch();
  let operations = 0;
  const commits: Array<Promise<unknown>> = [];
  let seeded = 0;

  for (const target of targets) {
    for (const component of target.components) {
      const id = `${target.board}-${target.specificationId}-${component.code}`
        .replace(/[^A-Za-z0-9_-]/g, "-")
        .toLowerCase();
      const entry = {
        id,
        board: target.board,
        boardLabel: EXAM_BOARD_LABELS[target.board],
        qualification: target.level,
        subject: target.subject,
        specificationCode: target.specificationId,
        specificationTitle: target.specificationTitle,
        componentCode: component.code,
        componentTitle: component.title,
        ...(component.tier ? { tier: component.tier } : {}),
        status: "current" as const,
        officialUrls: [],
        aliases: [],
        source: "owner_rollout",
        discoveredAt: now,
        updatedAt: now,
      };
      batch.set(db.collection("examFormatCatalogue").doc(id), entry, { merge: true });
      operations += 1;
      seeded += 1;
      if (operations >= 400) {
        commits.push(batch.commit());
        batch = db.batch();
        operations = 0;
      }
    }
  }
  commits.push(batch.commit());
  await Promise.all(commits);
  return { seeded };
}

export type ExamRolloutBatch = {
  id: string;
  board: ExamBoardId;
  specificationId: string;
  subject: string;
  years: number[];
  /** One ingestion job per paper found, in the order they were found. */
  jobIds: string[];
  papersFound: number;
  papersWithoutSources: number;
  createdAt: number;
};

/**
 * Queue every paper a course has, ready to be worked through.
 *
 * Discovery and ingestion are deliberately separate: finding the papers is
 * cheap and involves no model at all, so the list of what will be ingested --
 * and therefore what it will cost -- is known before a single paid call is
 * made.
 */
export async function queueExamCorpusBatch(input: {
  board: ExamBoardId;
  specificationId: string;
  years: number[];
  dryRun: boolean;
}): Promise<ExamRolloutBatch> {
  const target = ENGLAND_MATHS_AND_SCIENCE.find(
    (item) => item.board === input.board && item.specificationId === input.specificationId
  );
  if (!target) throw new Error("specification_not_in_rollout");
  const rights = getExamQuestionRights(`${input.board}-2026`, 1);
  if (!rights) throw new Error("board_rights_missing");

  const jobIds: string[] = [];
  let papersFound = 0;
  let papersWithoutSources = 0;

  for (const component of target.components) {
    const found = await findExamPapersByPattern({
      board: input.board,
      specificationId: input.specificationId,
      componentCode: component.code,
      years: input.years,
    });
    if (found.length === 0) {
      papersWithoutSources += 1;
      continue;
    }
    for (const candidate of found) {
      const manifest = buildExamPaperManifest({
        candidate,
        course: {
          board: input.board,
          boardLabel: EXAM_BOARD_LABELS[input.board],
          qualification: target.level,
          subject: target.subject,
          specificationCode: target.specificationId,
          specificationTitle: target.specificationTitle,
          componentCode: component.code,
          componentTitle: component.title,
        },
        rightsKey: rights.key,
        rightsVersion: rights.version,
      });
      if (!manifest) continue;
      papersFound += 1;
      const job = await startExamIngestionJob({ manifest, dryRun: input.dryRun });
      jobIds.push(job.id);
    }
  }

  const db = getAdminDb();
  const batch: ExamRolloutBatch = {
    id: `${input.board}_${input.specificationId}_${Date.now()}`.replace(/[^A-Za-z0-9_-]/g, "-"),
    board: input.board,
    specificationId: input.specificationId,
    subject: target.subject,
    years: input.years,
    jobIds,
    papersFound,
    papersWithoutSources,
    createdAt: Date.now(),
  };
  await db.collection("examCorpusBatches").doc(batch.id).set(batch);
  return batch;
}
