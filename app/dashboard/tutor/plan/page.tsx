"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AppPage from "@/components/layout/AppPage";
import { Button, EmptyState, FeedbackBanner, SectionHeader, Skeleton } from "@/components/ui";
import RevisionPlanBuilder, {
  type PlanScopeOption,
} from "@/components/planning/RevisionPlanBuilder";
import PlanWithJami from "@/components/planning/PlanWithJami";
import type { PlanNotice } from "@/lib/ai/assistant-plan";
import { loadPlanNotices } from "@/services/planning/plan-draft";
import { useUser } from "@/components/providers/UserProvider";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useFeedback } from "@/hooks/useFeedback";
import { featureFlags } from "@/lib/app/feature-flags";
import {
  PLAN_WEEKDAY_LABELS,
  planScopeKey,
  type RevisionPlan,
  type RevisionPlanDraft,
} from "@/lib/planning/types";
import { planDaysBetween } from "@/lib/planning/plan-schedule";
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
 * strip on the home page can stay quiet -- it is read every morning and most
 * mornings has nothing new to say -- while the decisions behind it have room.
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

function PlanSummary({
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
  const daysLeft = Math.max(0, planDaysBetween(new Date().toISOString().slice(0, 10), plan.endDayKey));
  const perWeek = plan.cadence.reduce((total, entry) => total + entry.minutes, 0);

  return (
    <div className="app-panel relative px-5 py-5 sm:px-7 sm:py-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-70"
        style={{
          background:
            "radial-gradient(70% 100% at 50% 0%, var(--color-accent-muted) 0%, transparent 70%)",
        }}
      />
      <div className="relative">
        <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-muted">
          Your plan
        </p>
        <h2 className="mt-1.5 text-2xl font-semibold tracking-tight text-text-primary">
          {plan.title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-text-secondary">
          {daysLeft > 0 ? `${daysLeft} days left` : "Finishing today"} ·{" "}
          {Math.round(perWeek / 60) > 0
            ? `about ${Math.round(perWeek / 60)}h a week`
            : `${perWeek} min a week`}
        </p>

        <div className="mt-5 flex flex-wrap gap-1.5">
          {plan.cadence.map((entry) => (
            <span
              key={entry.weekday}
              className="rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3 py-1.5 text-xs font-semibold text-text-primary"
            >
              {PLAN_WEEKDAY_LABELS[entry.weekday]} · {entry.minutes}m
            </span>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {plan.scopes.map((scope) => (
            <span
              key={planScopeKey(scope)}
              className="rounded-full border border-[var(--color-accent-muted)] px-3 py-1.5 text-xs font-medium text-text-secondary"
            >
              {scopeNames.get(planScopeKey(scope)) ?? "A subject you removed"}
            </span>
          ))}
        </div>

        <p className="mt-5 text-xs leading-5 text-text-muted">
          What goes in each session is chosen from your recent work, so the plan
          keeps up as you go.
        </p>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
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
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
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
  /** A plan Jami proposed, not yet saved and fully editable. */
  const [proposed, setProposed] = useState<RevisionPlanDraft | null>(null);

  const uid = user?.uid;

  const load = useCallback(async () => {
    if (!uid) {
      return { plans: [], folders: [], decks: [], plansProblem: null as "denied" | "error" | null };
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

  const scopeNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const option of options) names.set(option.key, option.label);
    return names;
  }, [options]);

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
    <AppPage
      title="Revision plan"
    >
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
        <p className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-3 text-sm leading-6 text-text-secondary">
          {plansUnavailable === "denied"
            ? "Saved plans can't be read on this project yet — the Firestore rules for them still need deploying. You can build a plan here, but it won't save until then."
            : "Jami couldn't read your saved plans just now. You can still build one, and anything already saved will reappear once the connection settles."}
        </p>
      ) : null}

      {loading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : !active && route === null ? (
        <section className="app-panel px-5 py-6 sm:px-7 sm:py-7">
          <div>
            <SectionHeader
              title="Plan your revision"
              description="Tell Jami what you're working towards and it will suggest a shape, or set it out yourself. You can change everything either way."
            />
            <div className="mt-6">
              <PlanWithJami
                notices={notices}
                onProposal={(draft) => {
                  setProposed(draft);
                  setRoute("manual");
                }}
                onBuildMyOwn={() => setRoute("manual")}
              />
            </div>
          </div>
        </section>
      ) : editing || !active ? (
        <section className="app-panel px-5 py-6 sm:px-7 sm:py-7">
          <SectionHeader
            title={active ? "Edit your plan" : proposed ? "Jami's suggestion" : "Build your plan"}
            description={
              active
                ? "Changing the shape changes what tomorrow asks for. Nothing you have already done is lost."
                : proposed
                  ? "Nothing is saved yet. Change anything that doesn't fit before you start it."
                  : "Three things: what you're revising, when you'll sit down, and how long it runs."
            }
          />
          <div className="mt-6">
            <RevisionPlanBuilder
              // Keyed so a fresh suggestion replaces what is in the form rather
              // than leaving the first draft's state behind it.
              key={proposed ? `proposed:${proposed.startDayKey}:${proposed.scopes.length}` : "own"}
              options={options}
              initial={active ?? proposed ?? undefined}
              saving={saving}
              onSave={handleSave}
              onCancel={
                active
                  ? () => setEditing(false)
                  : () => {
                      setProposed(null);
                      setRoute(null);
                    }
              }
            />
          </div>
        </section>
      ) : (
        <div className="space-y-5">
          <PlanSummary
            plan={active}
            scopeNames={scopeNames}
            onEdit={() => setEditing(true)}
            onArchive={handleArchive}
          />
          <Button type="button" variant="secondary" onClick={() => router.push("/dashboard")}>
            See today
          </Button>
        </div>
      )}
    </AppPage>
  );
}
