"use client";

import { useCallback, useMemo, useState } from "react";
import AppPage from "@/components/layout/AppPage";
import { Button, EmptyState, FeedbackBanner, SectionHeader, Skeleton } from "@/components/ui";
import RevisionPlanBuilder, {
  type PlanScopeOption,
} from "@/components/planning/RevisionPlanBuilder";
import PlanActiveView from "@/components/planning/PlanActiveView";
import PlanDraftPreview from "@/components/planning/PlanDraftPreview";
import PlanWithJami from "@/components/planning/PlanWithJami";
import type { PlanNotice } from "@/lib/ai/assistant-plan";
import { usePlanInterview } from "@/hooks/usePlanInterview";
import { loadPlanNotices } from "@/services/planning/plan-draft";
import { useUser } from "@/components/providers/UserProvider";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useFeedback } from "@/hooks/useFeedback";
import { useStudyActions } from "@/hooks/useStudyActions";
import { featureFlags } from "@/lib/app/feature-flags";
import { type RevisionPlan, type RevisionPlanDraft } from "@/lib/planning/types";
import { normalizeRevisionPlanDraft } from "@/lib/planning/normalize-plan";
import type { Deck } from "@/lib/study/decks";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { getDecks } from "@/services/study/decks";
import { getActiveStudyFolders } from "@/services/study/folders";
import {
  archiveRevisionPlan,
  loadRevisionPlans,
  saveRevisionPlan,
} from "@/services/planning/revision-plans";

/**
 * Where a plan is made and looked after.
 *
 * Today shows the day; this shows the shape. Keeping them apart means the
 * agenda on the home page can stay quiet -- it is read every morning and most
 * mornings has nothing new to say -- while the decisions behind it have room.
 *
 * The shape is drawn as the week it is, rather than described as a row of
 * chips. A student who set two sittings on a Tuesday should be able to see two
 * sittings on a Tuesday, and should have somewhere to put the essay that is due
 * on Thursday.
 */

/**
 * Whether a read failed because the rules refused it.
 *
 * Worth telling apart from an ordinary outage: a student can retry a network
 * blip forever and it will never work if the rules for this collection have not
 * reached the project. Saying "try again in a moment" to that is sending
 * somebody to press a button that cannot succeed.
 */
function isPermissionDenied(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "permission-denied"
  );
}

/** Whether the interview has put anything in the plan yet. */
function hasContent(draft: RevisionPlanDraft) {
  return draft.scopes.length > 0 || draft.sessions.length > 0 || (draft.exams?.length ?? 0) > 0;
}

function planId() {
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function RevisionPlanPage() {
  const { user } = useUser();
  const { feedback, showError, clear } = useFeedback();
  const [plans, setPlans] = useState<RevisionPlan[]>([]);
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  /**
   * Whether the student is changing a running plan with Jami, with the plan
   * and the conversation side by side. Nothing changes until they start the
   * new version.
   */
  const [reshaping, setReshaping] = useState(false);
  const [notices, setNotices] = useState<PlanNotice[]>([]);
  /** Set when saved plans could not be read, which is not the same as having none. */
  const [plansUnavailable, setPlansUnavailable] = useState<"denied" | "error" | null>(null);
  /**
   * Which way in the student chose: Jami's questions, which is where a new plan
   * starts, or the full builder, one press away on the same screen.
   */
  const [route, setRoute] = useState<"jami" | "manual">("jami");

  const uid = user?.uid;
  // What the engine suggests, which fills each day of a running plan.
  const studyActions = useStudyActions(uid ?? "", Boolean(uid) && featureFlags.enableStudyActions);

  const load = useCallback(async () => {
    if (!uid) {
      return {
        plans: [],
        folders: [],
        decks: [],
        plansProblem: null as "denied" | "error" | null,
      };
    }
    /*
     * The saved plans are read on their own terms.
     *
     * Three reads used to share one `Promise.all`, so a student who had never
     * made a plan -- or whose project had not yet been given the rules for the
     * collection -- got "your plan could not be loaded" on a page whose entire
     * job is making their first one. Folders and decks are what the builder
     * genuinely cannot work without; the plans are not.
     */
    const [plansResult, loadedFolders, loadedDecks] = await Promise.all([
      loadRevisionPlans(uid).then(
        (plans) => ({ plans, problem: null as "denied" | "error" | null }),
        (error: unknown) => ({
          plans: [] as RevisionPlan[],
          problem: (isPermissionDenied(error) ? "denied" : "error") as "denied" | "error",
        })
      ),
      getActiveStudyFolders(uid),
      getDecks(uid),
    ]);

    return {
      plans: plansResult.plans,
      plansProblem: plansResult.problem,
      folders: loadedFolders,
      decks: loadedDecks,
    };
  }, [uid]);

  const { loading } = useDashboardData({
    requestKey: uid ?? "",
    load,
    apply: (value) => {
      setPlans(value.plans);
      setPlansUnavailable(value.plansProblem);
      setFolders(value.folders);
      setDecks(value.decks);
      // What Jami noticed is worth having ready before anyone types, and it is
      // never worth blocking the page for.
      void loadPlanNotices().then(setNotices);
    },
    // Only folders and decks reach here now; the plans read reports itself.
    onError: () =>
      showError("Your folders and decks could not be loaded, so there is nothing to plan over yet."),
  });

  const active = plans.find((plan) => plan.status === "active") ?? null;

  const options = useMemo<PlanScopeOption[]>(
    () => [
      ...folders.map((folder) => ({
        key: `folder:${folder.id}`,
        label: folder.name,
        folderId: folder.id,
      })),
      // Decks that sit in no folder: the Learning Engine scopes a profile to one
      // or the other, and a loose deck would otherwise be unreachable from here.
      ...decks
        .filter((deck) => (deck.folderIds?.length ?? 0) === 0)
        .map((deck) => ({ key: `deck:${deck.id}`, label: deck.name, deckId: deck.id })),
    ],
    [decks, folders]
  );

  /*
   * The interview, held here so the plan it is building survives a trip into
   * the full builder and back. What it knows about each subject is what the
   * student named their folders and what the Learning Engine has counted.
   */
  const interviewContext = useMemo(
    () => ({
      notices,
      scopeNames: new Map(options.map((option) => [option.key, option.label])),
    }),
    [notices, options]
  );
  const interview = usePlanInterview(interviewContext);

  const handleSave = useCallback(
    async (draft: RevisionPlanDraft) => {
      if (!uid) return;
      setSaving(true);
      clear();
      try {
        const saved = await saveRevisionPlan(uid, active?.id ?? planId(), draft);
        setPlans((current) => [saved, ...current.filter((plan) => plan.id !== saved.id)]);
        setEditing(false);
        // A change made with Jami is finished once it is started.
        setReshaping(false);
        setRoute("jami");
        interview.begin();
      } catch (error) {
        showError(
          isPermissionDenied(error)
            ? "Jami is not allowed to save plans on this project yet. The Firestore rules need deploying."
            : "That plan could not be saved. Try again."
        );
      } finally {
        setSaving(false);
      }
    },
    [active?.id, clear, interview, showError, uid]
  );

  const handleArchive = useCallback(async () => {
    if (!uid || !active) return;
    clear();
    try {
      await archiveRevisionPlan(uid, active.id);
      setPlans((current) =>
        current.map((plan) => (plan.id === active.id ? { ...plan, status: "archived" } : plan))
      );
    } catch {
      showError("That plan could not be finished. Try again.");
    }
  }, [active, clear, showError, uid]);

  if (!featureFlags.enableRevisionPlans) {
    return (
      <AppPage title="Revision plan">
        <EmptyState
          title="Revision plans aren't switched on"
          description="This surface is still being finished."
        />
      </AppPage>
    );
  }

  return (
    <AppPage title="Revision plan">
      {feedback ? (
        <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={clear} />
      ) : null}

      {/*
        * Said once, quietly, and not in place of the page.
        *
        * A student can still shape a plan with Jami while this is true; what
        * they cannot do is keep it, so the notice says exactly that rather than
        * suggesting a retry that cannot work.
        */}
      {plansUnavailable ? (
        <p className="app-subtle-panel rounded-xl px-4 py-3 text-sm leading-6 text-text-secondary">
          {plansUnavailable === "denied"
            ? "Saved plans can't be read on this project yet — the Firestore rules for them still need deploying. You can build a plan here, but it won't save until then."
            : "Jami couldn't read your saved plans just now. You can still build one, and anything already saved will reappear once the connection settles."}
        </p>
      ) : null}

      {loading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : editing || (!active && route === "manual") ? (
        <section className="app-panel px-5 py-6 sm:px-7 sm:py-7">
          <SectionHeader
            title={active ? "Edit your plan" : "Build your plan"}
            description={
              active
                ? "Changing the shape changes what tomorrow asks for. Nothing you have already done is lost."
                : "Nothing is saved yet. Set it out however you like, then go back to Jami or start it."
            }
          />
          <div className="mt-6">
            <RevisionPlanBuilder
              key={active && !reshaping ? `active:${active.id}` : "interview"}
              options={options}
              // What the interview has built so far, whether it is a new plan or
              // a change to the running one; the running plan as saved otherwise.
              initial={
                !active || reshaping
                  ? hasContent(interview.draft)
                    ? interview.draft
                    : undefined
                  : active
              }
              saving={saving}
              onSave={handleSave}
              onCancel={active ? () => setEditing(false) : undefined}
              // Back to Jami carrying the edits, so the next answer builds on them.
              onBack={
                active
                  ? undefined
                  : (draft) => {
                      interview.setDraft(draft);
                      setRoute("jami");
                    }
              }
              backLabel="Back to Jami"
            />
          </div>
        </section>
      ) : !active || reshaping ? (
        /*
         * The questions and the plan, side by side.
         *
         * Jami asks, the student answers by tapping or typing, and the plan on
         * the right fills in with each answer -- so it is built in front of them
         * rather than handed over. It starts only from the last check, after
         * Jami has asked whether anything should change.
         */
        <div className="space-y-4 sm:space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SectionHeader
              title={reshaping ? "Change your plan with Jami" : "Plan your revision"}
              description={
                reshaping
                  ? "Tell Jami what's changed and watch the plan update. Nothing changes until you start the new version."
                  : "Four quick questions, and Jami builds the plan beside you as you answer. Tap an answer or say it in your own words."
              }
            />
            {reshaping ? (
              <Button type="button" variant="secondary" onClick={() => setReshaping(false)}>
                Back to your plan
              </Button>
            ) : null}
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <section className="app-panel px-5 py-6 sm:px-7 sm:py-7">
              <PlanWithJami
                interview={interview}
                options={options}
                notices={notices}
                saving={saving}
                startLabel={reshaping ? "Start the new version" : "Start this plan"}
                onStart={() => void handleSave(interview.draft)}
                onEditByHand={() => (active ? setEditing(true) : setRoute("manual"))}
              />
            </section>
            {/* Sticky on a wide screen: the plan is what the questions are
                building, so it should not scroll away from them. */}
            <div className="lg:sticky lg:top-4">
              <PlanDraftPreview
                draft={interview.draft}
                options={options}
                step={interview.step}
                onEdit={() => (active ? setEditing(true) : setRoute("manual"))}
                onJumpToStep={reshaping ? undefined : interview.jumpTo}
              />
            </div>
          </div>
        </div>
      ) : uid ? (
        <PlanActiveView
          uid={uid}
          planVersion={active.updatedAt}
          actions={studyActions.actions}
          folders={folders}
          decks={decks}
          onEdit={() => setEditing(true)}
          onArchive={() => void handleArchive()}
          onChangeWithJami={(message) => {
            interview.begin({
              draft: normalizeRevisionPlanDraft(active).draft,
              reshaping: true,
              message,
            });
            setReshaping(true);
          }}
        />
      ) : null}
    </AppPage>
  );
}
