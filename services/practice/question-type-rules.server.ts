import type { ExamFormatProfileVersion } from "@/lib/practice/exam-formats";
import type { PracticePaperAssessmentProfile } from "@/lib/practice/practice-papers";
import {
  questionTypeRuleKey,
  ruleSetId,
  subjectFallbacks,
  withoutAddedTariffs,
  type QuestionTypeRule,
  type QuestionTypeRuleSet,
} from "@/lib/practice/question-types";
import { getAdminDb } from "@/services/firebase/admin";

/**
 * Researched question-type rules, filed by board, qualification and subject.
 *
 * Server-side only, through the admin SDK: the collection denies every client
 * read and write, because the rules are derived from licensed mark schemes.
 * Marking and generation read
 * them through here, and a missing, slow or broken read returns no rules --
 * the hand-written conventions are the fallback, so a lookup can make marking
 * better and never make it fail.
 */

export const QUESTION_TYPE_RULES_COLLECTION = "examQuestionTypeRules";

const CACHE_MS = 10 * 60_000;
const READ_TIMEOUT_MS = 2_500;
const cache = new Map<string, { at: number; rules: QuestionTypeRule[] }>();

export async function loadQuestionTypeRules(
  profile: Partial<PracticePaperAssessmentProfile> | undefined,
  title = ""
): Promise<QuestionTypeRule[]> {
  const key = questionTypeRuleKey(profile, title);
  if (!key) return [];
  const id = ruleSetId(key);
  const cached = cache.get(id);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.rules;
  try {
    const db = getAdminDb();
    const collection = db.collection(QUESTION_TYPE_RULES_COLLECTION);
    const ids = subjectFallbacks(key.subject).map((subject) => ruleSetId({ ...key, subject }));
    const snapshots = await Promise.race([
      db.getAll(...ids.map((candidate) => collection.doc(candidate))),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), READ_TIMEOUT_MS)),
    ]);
    // A read that ran out of time is not an answer. Cached as "no rules", one slow read on a
    // loaded machine took the rules away from every marking on it for ten minutes.
    if (!snapshots) return [];
    // The most specific subject that has rules: longest first.
    const found = snapshots.find((snapshot) => snapshot.exists);
    // Read through withoutAddedTariffs: sets saved before it carry tariffs no question has.
    const rules = found ? ((found.data() as Partial<QuestionTypeRuleSet>).rules ?? []).map(withoutAddedTariffs) : [];
    cache.set(id, { at: Date.now(), rules });
    return rules;
  } catch {
    return [];
  }
}

/** The rules for an exam-format profile's component: its board, qualification and subject. */
export async function loadRulesForFormat(profile: Pick<ExamFormatProfileVersion, "boardLabel" | "qualificationLabel" | "subject">) {
  return loadQuestionTypeRules({
    awardingBodyOrInstitution: profile.boardLabel,
    qualificationOrModule: `${profile.qualificationLabel} ${profile.subject}`,
    studyLevel: profile.qualificationLabel,
  });
}

export async function saveQuestionTypeRules(set: QuestionTypeRuleSet) {
  const id = ruleSetId(set);
  await getAdminDb().collection(QUESTION_TYPE_RULES_COLLECTION).doc(id).set(JSON.parse(JSON.stringify(set)));
  cache.delete(id);
  return id;
}

export async function listQuestionTypeRuleSets() {
  const snapshot = await getAdminDb().collection(QUESTION_TYPE_RULES_COLLECTION).get();
  return snapshot.docs.map((document) => ({ id: document.id, ...(document.data() as QuestionTypeRuleSet) }));
}
