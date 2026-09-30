import "server-only";

import {
  getCustomStudyHref,
  getQuestionPracticeSetupHref,
  getRevisionStartHref,
} from "@/lib/app/routes";
import { featureFlags } from "@/lib/app/feature-flags";
import { buildStudyActions } from "@/lib/learning/actions/study-actions";
import { missionCopy } from "@/lib/learning/interventions/explain";
import type { LearnerProfile } from "@/lib/learning/types";
import { servableExamSpecificationTopics } from "@/lib/practice/exam-specification-topics";
import { planRevisionNextSteps } from "@/lib/revision/next-steps";
import {
  buildRevisionOptions,
  pickRevisionNeighbour,
  type RevisionConceptOption,
} from "@/lib/revision/options";
import type { RevisionNextStep, RevisionSessionRecord, RevisionTarget } from "@/lib/revision/types";
import { mapStudyFolderData, type StudyFolder } from "@/lib/workspace/study-folders";
import { getAdminDb } from "@/services/firebase/admin";
import { loadLearnerProfile } from "@/services/learning/learner-profile.server";

/**
 * A folder's concepts as a Revision Session sees them: what can be started,
 * what a chosen one resolves to, and what to offer when one finishes.
 *
 * All of it read from the student's own folder and learner profile on the
 * server. A client names a folder and a concept key; whether that concept
 * exists, what it is called and what the engine thinks of it are decided here.
 */

export type RevisionFolderOptions = {
  folder: StudyFolder;
  profile: LearnerProfile;
  options: RevisionConceptOption[];
};

async function loadFolder(uid: string, folderId: string) {
  const snapshot = await getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("studyFolders")
    .doc(folderId)
    .get();
  if (!snapshot.exists) return null;
  const folder = mapStudyFolderData(snapshot.id, snapshot.data() as Record<string, unknown>);
  return folder.archived ? null : folder;
}

export async function loadRevisionOptions(
  uid: string,
  folderId: string
): Promise<RevisionFolderOptions | null> {
  const folder = await loadFolder(uid, folderId);
  if (!folder) return null;
  const profile = await loadLearnerProfile({ uid, folderId, folder });
  if (!profile) return null;
  const headings = new Map<string, string>(
    (folder.examCourse
      ? servableExamSpecificationTopics(folder.examCourse.specificationId)?.topics ?? []
      : []
    ).map((topic) => [`spec:${topic.id}`, topic.label])
  );
  return {
    folder,
    profile,
    options: buildRevisionOptions({
      topics: profile.topics,
      recommendedFocus: profile.recommendedFocus,
      headings,
    }),
  };
}

/**
 * The session a chosen concept becomes, or null if it is not one of this
 * folder's.
 *
 * If the engine has a recommendation on the concept, the session carries it:
 * starting one yourself on a concept Jami was about to suggest is still doing
 * what it suggested.
 */
export function resolveRevisionStart(
  loaded: RevisionFolderOptions,
  topicKey: string
): { target: RevisionTarget; actionId?: string; why: string[] } | null {
  const option = loaded.options.find((candidate) => candidate.topicKey === topicKey);
  if (!option) return null;
  const action = buildStudyActions(loaded.profile, { questionPracticeAvailable: false }).find(
    (candidate) => candidate.target.kind === "topic" && candidate.target.topicKey === topicKey
  );
  const why =
    action?.intervention && action.target.kind === "topic"
      ? missionCopy({
          conceptLabel: action.target.label,
          choice: action.intervention,
          evidence: action.evidence,
        }).explanation.filter(Boolean)
      : [];
  return {
    target: {
      topicKey: option.topicKey,
      source: option.source,
      conceptLabel: option.label,
      folderId: loaded.folder.id,
    },
    ...(action ? { actionId: action.id } : {}),
    why,
  };
}

function idOf(topicKey: string) {
  const separator = topicKey.indexOf(":");
  return separator > 0 ? topicKey.slice(separator + 1) : "";
}

/**
 * What to offer when a session finishes. See `lib/revision/next-steps.ts`.
 *
 * The capabilities come from the folder and the deployment -- whether Jami can
 * write material for this concept, whether the course has real exam questions
 * -- and the neighbour from the engine. A failure to read them costs the
 * suggestions, never the finished session.
 */
export async function planNextStepsForSession(
  uid: string,
  record: RevisionSessionRecord
): Promise<RevisionNextStep[]> {
  const folderId = record.target.folderId;
  if (!folderId) return [];
  const loaded = await loadRevisionOptions(uid, folderId);
  if (!loaded) return [];

  const id = idOf(record.target.topicKey);
  const specification = record.target.source === "specification";
  const hasCourse = Boolean(loaded.folder.examCourse);
  const option = loaded.options.find((candidate) => candidate.topicKey === record.target.topicKey);
  const neighbour = pickRevisionNeighbour(loaded.options, record.target);

  return planRevisionNextSteps(record.steps, {
    target: { ...record.target, folderId },
    canWrite: specification && hasCourse && featureFlags.enableFlashcardAi,
    ...(specification && id ? { conceptId: id } : {}),
    ...(specification && hasCourse && featureFlags.enablePastPaperPractice && id
      ? { examQuestionsHref: getQuestionPracticeSetupHref({ folderId, conceptIds: [id] }) }
      : {}),
    ...(record.target.source === "student-topic" && id && (option?.cards ?? 0) > 0
      ? { reviewCardsHref: getCustomStudyHref({ mode: "custom", topicIds: [id] }) }
      : {}),
    sessionHref: getRevisionStartHref({ folderId, topicKey: record.target.topicKey }),
    ...(neighbour
      ? {
          neighbour: {
            topicKey: neighbour.topicKey,
            conceptLabel: neighbour.label,
            sessionHref: getRevisionStartHref({ folderId, topicKey: neighbour.topicKey }),
          },
        }
      : {}),
  });
}
