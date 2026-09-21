import "server-only";

import { mapPracticePaperData } from "@/lib/practice/practice-papers";
import { mapStudyFolderData, type StudyFolder } from "@/lib/workspace/study-folders";
import { createLogger } from "@/lib/observability/logger";
import { getAdminDb } from "@/services/firebase/admin";
import { getExamQuestionCountsByConcept } from "@/services/practice/exam-question-bank.server";
import { featureFlags } from "@/lib/app/feature-flags";
import {
  buildConceptCoverage,
  type ConceptCoverageState,
} from "@/lib/learning/interventions/coverage";
import {
  gapCandidates,
  settleGap,
  type GapVerdict,
} from "@/lib/learning/interventions/gap-detection";
import type { LearningTopicState } from "@/lib/learning/types";

const log = createLogger({ route: "learning.concept_availability" });

/**
 * How many questions exist for each concept, from the two banks the learner
 * profile cannot see.
 *
 * The profile knows what material a student *has* -- cards, notebooks, sources
 * -- because all of it lives in their own subtree. It knows nothing about the
 * licensed exam corpus or about the questions inside generated papers, and
 * both decide whether a concept is workable. Without them, a concept the
 * corpus can serve perfectly well reads as a coverage gap, and Jami offers to
 * build material that already exists.
 *
 * **Unavailable is not empty.** A source that could not be read returns
 * `undefined` rather than zero, and the two mean opposite things: one is "the
 * corpus has nothing on this", the other is "we could not ask". A gap declared
 * on the second would be a product failure caused by an outage.
 */

/** Counts per concept id, plus whether the source could be read at all. */
export type ConceptQuestionCounts = {
  /** Undefined when the bank could not be read; a missing key means genuinely none. */
  byConcept?: Readonly<Record<string, number>>;
  available: boolean;
};

export type ConceptAvailability = {
  pastPaper: ConceptQuestionCounts;
  practice: ConceptQuestionCounts;
};

export const UNAVAILABLE: ConceptQuestionCounts = { available: false };

/**
 * Real exam questions the corpus can serve, by concept.
 *
 * One unfiltered read grouped afterwards, rather than one read per concept:
 * the eligibility rules -- tier, component, licence, paper -- are applied by
 * the bank itself, so asking it once and counting what comes back gives the
 * same answer as asking it sixty times, at a sixtieth of the cost.
 */
async function loadPastPaperCounts(
  uid: string,
  folder: StudyFolder
): Promise<ConceptQuestionCounts> {
  if (!featureFlags.enablePastPaperPractice || !folder.examCourse) return UNAVAILABLE;
  try {
    const { byConcept } = await getExamQuestionCountsByConcept({ uid, folderId: folder.id });
    return { byConcept, available: true };
  } catch (error) {
    // A corpus that cannot be read is not a corpus that is empty.
    log.warn("past_paper.unavailable", { error });
    return UNAVAILABLE;
  }
}

/**
 * Questions inside the student's own generated papers, by concept.
 *
 * Read from the papers rather than from attempts, because a question that
 * exists and has never been sat still counts as material to work through --
 * coverage is about the shelf, not about what has been taken off it.
 */
async function loadPracticeCounts(
  uid: string,
  folder: StudyFolder
): Promise<ConceptQuestionCounts> {
  const specificationId = folder.examCourse?.specificationId;
  try {
    const snapshot = await getAdminDb()
      .collection("users")
      .doc(uid)
      .collection("pastPapers")
      .where("folderId", "==", folder.id)
      .orderBy("updatedAt", "desc")
      .limit(PRACTICE_PAPER_SCAN_LIMIT)
      .get();

    const byConcept: Record<string, number> = {};
    for (const document of snapshot.docs) {
      const paper = mapPracticePaperData(
        document.id,
        document.data() as Record<string, unknown>,
        specificationId
      );
      for (const question of paper.questions) {
        for (const conceptId of question.conceptIds ?? []) {
          byConcept[conceptId] = (byConcept[conceptId] ?? 0) + 1;
        }
      }
    }
    return { byConcept, available: true };
  } catch (error) {
    log.warn("practice.unavailable", { error });
    return UNAVAILABLE;
  }
}

/** Papers read when counting; recent ones, like every other profile read. */
export const PRACTICE_PAPER_SCAN_LIMIT = 30;

/**
 * Both banks, read together.
 *
 * Failure of either costs that bank's counts and nothing else: coverage then
 * reports what it could see and says the rest was unreadable, which is the
 * same fail-safe shape every other Learning Engine read already has.
 */
export async function loadConceptAvailability(input: {
  uid: string;
  folderId: string;
  folder?: StudyFolder;
}): Promise<ConceptAvailability> {
  const uid = input.uid.trim();
  if (!uid || !input.folderId) return { pastPaper: UNAVAILABLE, practice: UNAVAILABLE };

  let folder = input.folder;
  if (!folder) {
    try {
      const snapshot = await getAdminDb()
        .collection("users")
        .doc(uid)
        .collection("studyFolders")
        .doc(input.folderId)
        .get();
      if (!snapshot.exists) return { pastPaper: UNAVAILABLE, practice: UNAVAILABLE };
      folder = mapStudyFolderData(snapshot.id, snapshot.data() as Record<string, unknown>);
    } catch (error) {
      log.warn("folder.unavailable", { error });
      return { pastPaper: UNAVAILABLE, practice: UNAVAILABLE };
    }
  }

  const [pastPaper, practice] = await Promise.all([
    loadPastPaperCounts(uid, folder),
    loadPracticeCounts(uid, folder),
  ]);
  return { pastPaper, practice };
}

/** What one concept has in each bank, for `buildConceptCoverage`. */
export function questionCountsFor(
  availability: ConceptAvailability,
  conceptId: string
): { practice?: number; pastPaper?: number } {
  return {
    ...(availability.practice.available
      ? { practice: availability.practice.byConcept?.[conceptId] ?? 0 }
      : {}),
    ...(availability.pastPaper.available
      ? { pastPaper: availability.pastPaper.byConcept?.[conceptId] ?? 0 }
      : {}),
  };
}

/**
 * Coverage for a folder's concepts, asking the banks only where it matters.
 *
 * The shape the recommendation path can afford. Cheap signals settle almost
 * every concept -- a concept with material is not a gap whatever the corpus
 * holds -- and the expensive scan runs only if at least one concept is still
 * in question. A folder where every concept is stocked never touches the
 * corpus at all, which is the common case and the one Today pays for.
 *
 * Measured before it was built this way: the scan alone exceeded the whole
 * 2,500 ms profile budget, so paying it on every load was never an option.
 * See `scripts/eval/concept-availability-latency.ts`.
 */
export async function loadCoverageWithLazyBanks(input: {
  uid: string;
  folderId: string;
  folder?: StudyFolder;
  topics: readonly LearningTopicState[];
}): Promise<{
  coverage: Map<string, ConceptCoverageState>;
  verdicts: Map<string, GapVerdict>;
  bankLookupPerformed: boolean;
}> {
  // Everything the profile already knows, for nothing.
  const cheap = new Map<string, ConceptCoverageState>(
    input.topics.map((topic) => [topic.topicKey, buildConceptCoverage(topic)])
  );

  const candidates = gapCandidates(input.topics, cheap);
  if (candidates.length === 0) {
    return { coverage: cheap, verdicts: new Map(), bankLookupPerformed: false };
  }

  const availability = await loadConceptAvailability({
    uid: input.uid,
    folderId: input.folderId,
    ...(input.folder ? { folder: input.folder } : {}),
  });

  const coverage = new Map(cheap);
  const verdicts = new Map<string, GapVerdict>();
  for (const candidate of candidates) {
    const conceptId = candidate.topicKey.startsWith("spec:")
      ? candidate.topicKey.slice("spec:".length)
      : "";
    const counts = conceptId ? questionCountsFor(availability, conceptId) : {};
    const settled = buildConceptCoverage(candidate, counts);
    coverage.set(candidate.topicKey, settled);
    verdicts.set(
      candidate.topicKey,
      settleGap({
        ownMaterial: settled.coverage.flashcards + settled.coverage.material,
        ...(counts.pastPaper !== undefined ? { pastPaper: counts.pastPaper } : {}),
        ...(counts.practice !== undefined ? { practice: counts.practice } : {}),
        pastPaperAvailable: availability.pastPaper.available,
        practiceAvailable: availability.practice.available,
      })
    );
  }

  return { coverage, verdicts, bankLookupPerformed: true };
}
