"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AppPage from "@/components/layout/AppPage";
import { Button, EmptyState, FeedbackBanner, SectionHeader, Skeleton } from "@/components/ui";
import RevisionPlanBuilder, {
  type PlanScopeOption,
} from "@/components/planning/RevisionPlanBuilder";
import PlanWeekTimetable from "@/components/planning/PlanWeekTimetable";
import PinToDayDialog from "@/components/planning/PinToDayDialog";
import PlanDraftPreview from "@/components/planning/PlanDraftPreview";
import PlanWithJami from "@/components/planning/PlanWithJami";
import type { PlanNotice } from "@/lib/ai/assistant-plan";
import { loadPlanNotices } from "@/services/planning/plan-draft";
import { useUser } from "@/components/providers/UserProvider";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useFeedback } from "@/hooks/useFeedback";
import { useStudyActions } from "@/hooks/useStudyActions";
import { featureFlags } from "@/lib/app/feature-flags";
import {
  PLAN_WEEKDAY_FULL_LABELS,
  planScopeKey,
  type PinnedPlanItem,
  type RevisionPlan,
  type RevisionPlanDraft,
  type RevisionPlanEntry,
} from "@/lib/planning/types";
import {
  planDaysBetween,
  planWeekdayOf,
  planWeekStartDayKey,
} from "@/lib/planning/plan-schedule";
import { buildPlanWeek, PLAN_WEEK_LENGTH } from "@/lib/planning/plan-week";
import { normalizeRevisionPlanDraft } from "@/lib/planning/normalize-plan";
import { getStudyDayKey, shiftStudyDayKey } from "@/lib/study/day";
import type { Deck } from "@/lib/study/decks";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { getDecks } from "@/services/study/decks";
import { getActiveStudyFolders } from "@/services/study/folders";
import {
  archiveRevisionPlan,
  loadRevisionPlanEntries,
  loadRevisionPlans,
  saveRevisionPlan,
  saveRevisionPlanEntry,
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

function planId() {
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function describeWeekly(plan: RevisionPlan) {
  const perWeek = plan.sessions.reduce((total, session) => total + session.minutes, 0);
  const studyDays = new Set(plan.sessions.map((session) => session.weekday)).size;
  const time =
    perWeek >= 60 ? `about ${Math.round(perWeek / 60)}h a week` : `${perWeek} min a week`;
  return `${studyDays} day${studyDays === 1 ? "" : "s"} a week · ${time}`;
}

function PlanHeader({
  plan,
  scopeNames,
  onEdit,
  onArchive,
}: {
  plan: RevisionPlan;
  scopeNames: Map<string, string>;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const daysLeft = Math.max(0, planDaysBetween(getStudyDayKey(), plan.endDayKey));

  return (
    <div className="app-panel relative overflow-hidden px-5 py-5 sm:px-7 sm:py-6">
      <div aria-hidden="true" className="plan-aurora" />
      <div className="relative flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-muted">
            Your plan
          </p>
          <h2 className="mt-1.5 text-2xl font-semibold tracking-tight text-text-primary">
            {plan.title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            {daysLeft > 0 ? `${daysLeft} days left` : "Finishing today"} · {describeWeekly(plan)}
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {plan.scopes.map((scope) => (
              <span
                key={planScopeKey(scope)}
                className="app-chip rounded-full px-3 py-1 text-xs font-medium"
              >
                {scopeNames.get(planScopeKey(scope)) ?? "A subject you removed"}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="secondary" onClick={onArchive}>
            Finish this plan
          </Button>
          <Button type="button" onClick={onEdit}>
            Edit plan
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function RevisionPlanPage() {
  const { user } = useUser();
  const router = useRouter();
  const { feedback, showError, clear } = useFeedback();
  const [plans, setPlans] = useState<RevisionPlan[]>([]);
  const [entries, setEntries] = useState<RevisionPlanEntry[]>([]);
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pinningDayKey, setPinningDayKey] = useState<string | null>(null);
  const [notices, setNotices] = useState<PlanNotice[]>([]);
  /** Set when saved plans could not be read, which is not the same as having none. */
  const [plansUnavailable, setPlansUnavailable] = useState<"denied" | "error" | null>(null);
  /**
   * Which way in the student chose, or null while they are being offered both.
   *
   * Null is the important state: with no plan yet, neither path is taken for
   * them. Jami offers, and building it yourself is one press away on the same
   * screen rather than hidden behind a refusal.
   */
  const [route, setRoute] = useState<"jami" | "manual" | null>(null);
  /** The plan being built: Jami's suggestions and the student's edits, unsaved. */
  const [proposed, setProposed] = useState<RevisionPlanDraft | null>(null);
  /**
   * How many times Jami has changed the draft.
   *
   * Only used to tell the preview that something moved. Comparing drafts to
   * work that out would be more code and less honest -- a proposal that happens
   * to match what was already there is still Jami having answered.
   */
  const [proposalCount, setProposalCount] = useState(0);

  const uid = user?.uid;
  const todayDayKey = getStudyDayKey();
  const weekStartDayKey = planWeekStartDayKey(todayDayKey);
  // What the engine suggests, so a pin can be chosen rather than typed out.
  const studyActions = useStudyActions(uid ?? "", Boolean(uid) && featureFlags.enableStudyActions);

  const load = useCallback(async () => {
    if (!uid) {
      return {
        plans: [],
        entries: [] as RevisionPlanEntry[],
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

    // The week's exceptions, and only for the plan actually being shown.
    const active = plansResult.plans.find((plan) => plan.status === "active") ?? null;
    const loadedEntries = active
      ? await loadRevisionPlanEntries(uid, active.id, {
          fromDayKey: weekStartDayKey,
          toDayKey: shiftStudyDayKey(weekStartDayKey, PLAN_WEEK_LENGTH - 1),
          max: PLAN_WEEK_LENGTH,
        }).catch(() => [] as RevisionPlanEntry[])
      : [];

    return {
      plans: plansResult.plans,
      entries: loadedEntries,
      plansProblem: plansResult.problem,
      folders: loadedFolders,
      decks: loadedDecks,
    };
  }, [uid, weekStartDayKey]);

  const { loading } = useDashboardData({
    requestKey: uid ?? "",
    load,
    apply: (value) => {
      setPlans(value.plans);
      setEntries(value.entries);
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

  const scopeNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const option of options) names.set(option.key, option.label);
    return names;
  }, [options]);

  const week = useMemo(
    () => (active ? buildPlanWeek({ plan: active, entries, todayDayKey, weekStartDayKey }) : null),
    [active, entries, todayDayKey, weekStartDayKey]
  );

  /**
   * The draft on screen, whether or not anything has been decided yet.
   *
   * An empty normalised draft rather than null, so the preview has a real plan
   * to render from the first frame and the student can see the shape of what
   * they are about to fill in.
   */
  const draftInProgress = useMemo(
    () => proposed ?? normalizeRevisionPlanDraft(null).draft,
    [proposed]
  );

  const pinningEntry = pinningDayKey
    ? entries.find((entry) => entry.dayKey === pinningDayKey)
    : undefined;

  const handleSave = useCallback(
    async (draft: RevisionPlanDraft) => {
      if (!uid) return;
      setSaving(true);
      clear();
      try {
        const saved = await saveRevisionPlan(uid, active?.id ?? planId(), draft);
        setPlans((current) => [saved, ...current.filter((plan) => plan.id !== saved.id)]);
        setEditing(false);
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
    [active?.id, clear, showError, uid]
  );

  /**
   * One day's pinned items, written whole.
   *
   * Optimistic, and put back on failure: a pin that silently did not save would
   * have the student planning around something the plan does not know about.
   */
  const writePinned = useCallback(
    async (dayKey: string, pinned: PinnedPlanItem[]) => {
      if (!uid || !active) return;
      const previous = entries;
      const existing = entries.find((entry) => entry.dayKey === dayKey);
      const updated: RevisionPlanEntry = { ...(existing ?? { dayKey }), dayKey, pinned };
      setEntries((current) => [
        ...current.filter((entry) => entry.dayKey !== dayKey),
        updated,
      ]);
      setSaving(true);
      try {
        await saveRevisionPlanEntry(uid, active.id, updated);
      } catch {
        setEntries(previous);
        showError("That could not be added to the day. Try again.");
      } finally {
        setSaving(false);
      }
    },
    [active, entries, showError, uid]
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
      ) : !active && route === null ? (
        /*
         * The conversation and the plan, together.
         *
         * A proposal used to replace this whole screen with the builder, so the
         * chat disappeared at the exact moment it became useful and the student
         * never watched anything being built. Both live here now: Jami fills the
         * panel in as they talk, and the two ways out -- edit it by hand, start
         * it -- sit on the panel rather than waiting for Jami to decide it is
         * finished. It is not Jami's to finish.
         */
        <div className="space-y-4 sm:space-y-6">
          <SectionHeader
            title="Plan your revision"
            description="Tell Jami what you're working towards and it will shape the plan beside you. Edit any part of it, or start it, whenever you like."
          />
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <section className="app-panel px-5 py-6 sm:px-7 sm:py-7">
              <PlanWithJami
                notices={notices}
                draft={draftInProgress}
                onProposal={(draft) => {
                  setProposed(draft);
                  // Counted rather than compared, so the panel can show it moved.
                  setProposalCount((count) => count + 1);
                }}
              />
            </section>
            {/* Sticky on a wide screen: the plan is what the conversation is
                about, so it should not scroll away from the composer. */}
            <div className="lg:sticky lg:top-4">
              <PlanDraftPreview
                draft={draftInProgress}
                options={options}
                changeKey={proposalCount}
                saving={saving}
                onEdit={() => setRoute("manual")}
                onStart={() => void handleSave(draftInProgress)}
              />
            </div>
          </div>
        </div>
      ) : editing || !active ? (
        <section className="app-panel px-5 py-6 sm:px-7 sm:py-7">
          <SectionHeader
            title={active || proposed ? "Edit your plan" : "Build your plan"}
            description={
              active
                ? "Changing the shape changes what tomorrow asks for. Nothing you have already done is lost."
                : proposed
                  ? "Nothing is saved yet. Change anything you like, then go back to Jami or start it."
                  : "What you're revising, when you'll sit down, and how long it runs."
            }
          />
          <div className="mt-6">
            <RevisionPlanBuilder
              // Keyed so a fresh suggestion replaces what is in the form rather
              // than leaving the first draft's state behind it.
              key={active ? `active:${active.id}` : `draft:${proposalCount}`}
              options={options}
              initial={active ?? proposed ?? undefined}
              saving={saving}
              onSave={handleSave}
              onCancel={active ? () => setEditing(false) : undefined}
              // Back to the conversation carrying the edits, so Jami's next
              // answer builds on them rather than talking past them.
              onBack={
                active
                  ? undefined
                  : (draft) => {
                      setProposed(draft);
                      setRoute(null);
                    }
              }
              backLabel="Back to Jami"
            />
          </div>
        </section>
      ) : (
        <div className="space-y-5">
          <PlanHeader
            plan={active}
            scopeNames={scopeNames}
            onEdit={() => setEditing(true)}
            onArchive={handleArchive}
          />

          {week ? (
            <section className="space-y-3">
              <SectionHeader
                title="This week"
                description="What each session holds is chosen from your recent work on the day. Anything you add yourself stays put."
              />
              <PlanWeekTimetable
                plan={active}
                week={week}
                entries={entries}
                scopeNames={scopeNames}
                onPin={setPinningDayKey}
              />
            </section>
          ) : null}

          <Button type="button" variant="secondary" onClick={() => router.push("/dashboard")}>
            See today
          </Button>
        </div>
      )}

      {pinningDayKey ? (
        <PinToDayDialog
          /*
           * Keyed on the day, so opening this on Thursday does not still hold
           * what was half-typed for Tuesday. A fresh day is a fresh dialog,
           * which is cheaper and more obviously correct than resetting its
           * fields from an effect.
           */
          key={pinningDayKey}
          open
          dayLabel={`${PLAN_WEEKDAY_FULL_LABELS[planWeekdayOf(pinningDayKey)]} ${pinningDayKey.slice(-2)}`}
          actions={studyActions.actions}
          existing={pinningEntry?.pinned ?? []}
          saving={saving}
          onPin={(item) =>
            void writePinned(pinningDayKey, [...(pinningEntry?.pinned ?? []), item])
          }
          onUnpin={(actionId) =>
            void writePinned(
              pinningDayKey,
              (pinningEntry?.pinned ?? []).filter((item) => item.actionId !== actionId)
            )
          }
          onClose={() => setPinningDayKey(null)}
        />
      ) : null}
    </AppPage>
  );
}
