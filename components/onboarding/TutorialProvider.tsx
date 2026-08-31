"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/Dialog";
import {
  BrandMark,
  Button,
  ButtonLink,
  Card,
  ConstellationTrail,
} from "@/components/ui";
import {
  NORTHERN_STAR_FACET_PATH,
  NORTHERN_STAR_PATH,
} from "@/components/ui/NorthernStar";
import StarRewardOverlay, {
  type StarReward,
} from "@/components/constellation/StarRewardOverlay";
import {
  advanceTutorialProgress,
  createInitialTutorialProgress,
  getTutorialMission,
  TUTORIAL_ACTION_EVENT,
  TUTORIAL_MISSIONS,
  type TutorialContext as TutorialRouteContext,
  type TutorialMissionId,
  type TutorialProgress,
} from "@/lib/onboarding/tutorial";
import {
  mergeTutorialProgress,
  readLocalTutorialProgress,
  saveLocalTutorialProgress,
} from "@/lib/onboarding/tutorial-storage";
import {
  loadTutorialProgress,
  saveTutorialProgress,
} from "@/services/profile/tutorial";
import { createOnboardingStarIfMissing } from "@/services/constellation/stars";

const MISSION_COUNT = TUTORIAL_MISSIONS.length;

/** How long to keep looking for a control that may still be rendering. */
const SPOTLIGHT_SEEK_MS = 4_000;
/** How long the ring stays once the control has been pointed at. */
const SPOTLIGHT_HOLD_MS = 2_400;
const SPOTLIGHT_FADE_MS = 220;

/**
 * How often a reward that could not be placed may try again.
 *
 * Only reached while a finished walkthrough is waiting for room in a full
 * constellation, which is rare; the throttle is what keeps that rare state
 * from costing a pair of reads on every navigation.
 */
const PENDING_RETRY_MS = 60_000;

type TutorialContextValue = {
  progress: TutorialProgress;
  ready: boolean;
  canInvite: boolean;
  invite: () => void;
  start: () => void;
  pause: () => void;
  resume: () => void;
};

const TutorialContext = createContext<TutorialContextValue | null>(null);

export function useTutorial() {
  const context = useContext(TutorialContext);
  if (!context) {
    throw new Error("useTutorial() must be used inside TutorialProvider.");
  }
  return context;
}

function NorthernStarBadge({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 160" className={className} aria-hidden="true">
      <path d={NORTHERN_STAR_PATH} fill="currentColor" />
      <path d={NORTHERN_STAR_FACET_PATH} fill="var(--color-surface-panel-strong)" />
    </svg>
  );
}

function WelcomeDialog({
  open,
  onStart,
  onExplore,
  onClose,
}: {
  open: boolean;
  onStart: () => void;
  onExplore: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      closeOnBackdrop={false}
      /*
       * Escape closes the invitation without answering it. Treating a stray
       * Escape as "explore on my own" would quietly retire the walkthrough on
       * a keypress that everywhere else in the app just means "not this".
       */
      onDismiss={onClose}
      className="fixed inset-0 flex items-center justify-center p-4"
    >
      <DialogBackdrop className="absolute inset-0 bg-[color-mix(in_srgb,var(--app-background)_78%,transparent)]" />
      <DialogPanel
        data-testid="tutorial-welcome"
        className="app-panel relative w-full max-w-lg overflow-hidden rounded-2xl border-[1.5px] border-[var(--color-border-strong)] p-6 shadow-shell sm:p-8"
      >
        <div className="flex items-center gap-3">
          <BrandMark size="lg" />
          <div>
            <div className="text-2xs font-semibold uppercase tracking-[0.2em] text-text-muted">
              Welcome to Jami
            </div>
            <DialogTitle className="mt-1 text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl">
              Find your first study rhythm.
            </DialogTitle>
          </div>
        </div>
        <div className="mt-6 flex justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-5 text-text-primary">
          <ConstellationTrail completed={MISSION_COUNT} size="lg" decorative />
        </div>
        <DialogDescription className="mt-6 text-sm leading-6 text-text-secondary">
          {MISSION_COUNT} small missions take you from your first folder to a
          real review and one useful question for Jami.
        </DialogDescription>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Button size="lg" onClick={onStart}>
            Start walkthrough
          </Button>
          <Button size="lg" variant="secondary" onClick={onExplore}>
            Explore on my own
          </Button>
        </div>
      </DialogPanel>
    </Dialog>
  );
}

function PauseDialog({
  open,
  onKeepGoing,
  onPause,
}: {
  open: boolean;
  onKeepGoing: () => void;
  onPause: () => void;
}) {
  return (
    <Dialog
      open={open}
      onDismiss={onKeepGoing}
      className="fixed inset-0 flex items-center justify-center p-4"
    >
      <DialogBackdrop className="absolute inset-0 bg-[color-mix(in_srgb,var(--app-background)_78%,transparent)]" />
      <DialogPanel
        role="alertdialog"
        data-testid="tutorial-pause"
        className="app-panel relative w-full max-w-md rounded-2xl p-6 shadow-shell"
      >
        <DialogTitle className="text-xl font-semibold text-text-primary">
          Pause walkthrough?
        </DialogTitle>
        <DialogDescription className="mt-3 text-sm leading-6 text-text-secondary">
          Your progress is saved. Resume from Today or Account whenever you want.
        </DialogDescription>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onPause}>
            Pause walkthrough
          </Button>
          <Button onClick={onKeepGoing}>Keep going</Button>
        </div>
      </DialogPanel>
    </Dialog>
  );
}

function CompletionDialog({
  open,
  rewardPending,
  onClose,
}: {
  open: boolean;
  rewardPending: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onDismiss={onClose}
      className="fixed inset-0 flex items-center justify-center p-4"
    >
      <DialogBackdrop className="absolute inset-0 bg-[color-mix(in_srgb,var(--app-background)_78%,transparent)]" />
      <DialogPanel
        data-testid="tutorial-completion"
        className="app-panel relative w-full max-w-lg rounded-2xl p-6 text-center shadow-shell sm:p-8"
      >
        <NorthernStarBadge className="mx-auto h-16 w-16 text-text-primary" />
        <DialogTitle className="mt-5 text-2xl font-semibold tracking-tight text-text-primary">
          Your first loop is complete.
        </DialogTitle>
        <DialogDescription className="mx-auto mt-3 max-w-sm text-sm leading-6 text-text-secondary">
          You now have a place to work, something worth remembering, and Jami
          beside the work when you need help.
        </DialogDescription>
        <div className="mt-6 flex justify-center text-text-primary">
          <ConstellationTrail completed={MISSION_COUNT} size="md" decorative />
        </div>
        {rewardPending ? (
          <p className="mt-4 text-xs leading-5 text-text-muted">
            Your white star is saved for the next open place in your
            constellation.
          </p>
        ) : null}
        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <ButtonLink href="/dashboard/progress">See Progress</ButtonLink>
          <ButtonLink href="/dashboard/constellation" variant="secondary">
            View Stars
          </ButtonLink>
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogPanel>
    </Dialog>
  );
}

function MissionCard({
  progress,
  onGo,
  onPause,
}: {
  progress: TutorialProgress;
  onGo: () => void;
  onPause: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const mission = getTutorialMission(progress.currentMissionId);
  const completed = progress.completedMissionIds.length;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        data-testid="tutorial-quest-collapsed"
        aria-label={`Show walkthrough, mission ${completed + 1} of ${MISSION_COUNT}`}
        className="app-nav fixed bottom-[calc(env(safe-area-inset-bottom,0px)+6.4rem)] right-3 z-[70] flex items-center gap-3 rounded-xl border border-[var(--nav-shell-border)] px-3 py-2 text-left shadow-nav-shell md:bottom-5 md:right-5"
      >
        <span className="text-text-primary">
          <ConstellationTrail completed={completed} size="sm" decorative />
        </span>
        <span className="text-xs font-semibold text-text-primary">
          Mission {completed + 1}
        </span>
      </button>
    );
  }

  return (
    <Card
      data-testid="tutorial-quest"
      className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+6.4rem)] left-3 right-3 z-[70] ml-auto max-w-sm p-4 shadow-nav-shell md:bottom-5 md:left-auto md:right-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-muted">
            Mission {completed + 1} of {MISSION_COUNT}
          </div>
          <h2 className="mt-1 text-base font-semibold text-text-primary">
            {mission.title}
          </h2>
        </div>
        <button
          type="button"
          aria-label="Collapse walkthrough mission"
          onClick={() => setCollapsed(true)}
          className="app-chip grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-muted"
        >
          <span aria-hidden="true">&minus;</span>
        </button>
      </div>
      <p className="mt-2 text-sm leading-5 text-text-secondary">{mission.detail}</p>
      <div className="mt-3 text-text-primary">
        <ConstellationTrail completed={completed} size="md" />
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <Button size="sm" onClick={onGo}>
          {mission.actionLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onPause}>
          Pause
        </Button>
      </div>
    </Card>
  );
}

type SpotlightRect = { top: number; left: number; width: number; height: number };

/**
 * A ring around the one control this mission is about.
 *
 * It points, then gets out of the way: the ring appears once the control can
 * be measured, holds for a couple of seconds, then fades for good. This used
 * to watch the whole document for changes and re-show itself on every one of
 * them, so the dim kept returning over a student who had already found the
 * button -- and inside a notebook it fired on every stroke they drew. Locating
 * the control is a bounded search, not a standing subscription.
 */
function MissionSpotlight({ missionId }: { missionId: TutorialMissionId }) {
  const [spotlight, setSpotlight] = useState<{
    rect: SpotlightRect;
    leaving: boolean;
  } | null>(null);

  useEffect(() => {
    let stopped = false;
    let frame = 0;
    let holdTimer = 0;
    let clearTimer = 0;

    const measure = (): SpotlightRect | null => {
      const target = document.querySelector<HTMLElement>(
        `[data-tutorial-target="${missionId}"]`
      );
      if (!target) return null;
      const bounds = target.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return null;
      return {
        top: bounds.top - 6,
        left: bounds.left - 6,
        width: bounds.width + 12,
        height: bounds.height + 12,
      };
    };

    const follow = () => {
      const next = measure();
      if (next) {
        setSpotlight((current) => (current ? { ...current, rect: next } : current));
      }
    };

    const release = () => {
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
      setSpotlight((current) => (current ? { ...current, leaving: true } : current));
      clearTimer = window.setTimeout(() => setSpotlight(null), SPOTLIGHT_FADE_MS);
    };

    const seek = (deadline: number) => {
      if (stopped) return;
      const found = measure();
      if (found) {
        setSpotlight({ rect: found, leaving: false });
        window.addEventListener("resize", follow);
        window.addEventListener("scroll", follow, true);
        holdTimer = window.setTimeout(release, SPOTLIGHT_HOLD_MS);
        return;
      }
      if (performance.now() >= deadline) return;
      frame = window.requestAnimationFrame(() => seek(deadline));
    };

    frame = window.requestAnimationFrame(() =>
      seek(performance.now() + SPOTLIGHT_SEEK_MS)
    );

    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(holdTimer);
      window.clearTimeout(clearTimer);
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
      setSpotlight(null);
    };
  }, [missionId]);

  if (!spotlight) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="tutorial-spotlight"
      className={`tutorial-spotlight pointer-events-none fixed z-[60] rounded-xl border-2 border-warm-accent ${
        spotlight.leaving ? "tutorial-spotlight-leaving" : ""
      }`}
      style={spotlight.rect}
    />
  );
}

export default function TutorialProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [progress, setProgress] = useState(() => createInitialTutorialProgress());
  const progressRef = useRef(progress);
  const [ready, setReady] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [starReward, setStarReward] = useState<StarReward | null>(null);
  const awardingRef = useRef(false);
  const pendingRetryAtRef = useRef(0);
  /*
   * The invitation is offered once a session. Without this the effect that
   * opens it would re-open it the moment it was closed, because closing it
   * without answering deliberately leaves the walkthrough eligible.
   */
  const invitedRef = useRef(false);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    let active = true;

    const local = readLocalTutorialProgress(userId);
    if (local) {
      setProgress(local);
      progressRef.current = local;
    }

    void loadTutorialProgress(userId)
      .then((remote) => {
        if (!active) return;
        const merged = mergeTutorialProgress(
          readLocalTutorialProgress(userId),
          remote
        );
        if (!merged) return;
        setProgress(merged);
        progressRef.current = merged;
        // Work done while the account copy was unreachable catches up here.
        if (!remote || merged.updatedAt > remote.updatedAt) {
          void saveTutorialProgress(userId, merged).catch(() => undefined);
        }
      })
      .catch((error) => {
        // The local copy loaded above is what the student keeps seeing.
        console.warn("Could not load walkthrough progress.", error);
      })
      .finally(() => {
        if (active) setReady(true);
      });

    return () => {
      active = false;
    };
  }, [userId]);

  const persist = useCallback(
    (next: TutorialProgress) => {
      setProgress(next);
      progressRef.current = next;
      saveLocalTutorialProgress(userId, next);
      void saveTutorialProgress(userId, next).catch((error) => {
        console.warn("Could not sync walkthrough progress.", error);
      });
    },
    [userId]
  );

  const awardCompletion = useCallback(async () => {
    if (awardingRef.current) return;
    awardingRef.current = true;
    try {
      const result = await createOnboardingStarIfMissing(userId);
      const next: TutorialProgress = {
        ...progressRef.current,
        rewardState: result.status === "pending" ? "pending" : "awarded",
        updatedAt: Date.now(),
      };
      persist(next);
      if (result.status === "awarded") {
        setStarReward({ star: result.star, goalName: "First study loop" });
      } else {
        setCompletionOpen(true);
      }
    } catch (error) {
      console.warn("Could not award the first-loop star.", error);
      const next = {
        ...progressRef.current,
        rewardState: "pending" as const,
        updatedAt: Date.now(),
      };
      persist(next);
      setCompletionOpen(true);
    } finally {
      awardingRef.current = false;
    }
  }, [persist, userId]);

  useEffect(() => {
    const handleAction = (event: Event) => {
      const detail = (event as CustomEvent<{
        missionId?: TutorialMissionId;
        context?: TutorialRouteContext;
      }>).detail;
      if (!detail?.missionId) return;
      const next = advanceTutorialProgress(
        progressRef.current,
        detail.missionId,
        detail.context
      );
      if (next === progressRef.current) return;
      persist(next);
      if (next.status === "completed") void awardCompletion();
    };
    window.addEventListener(TUTORIAL_ACTION_EVENT, handleAction);
    return () => window.removeEventListener(TUTORIAL_ACTION_EVENT, handleAction);
  }, [awardCompletion, persist]);

  /*
   * A reward with nowhere to go tries again as the student moves around the
   * app, so the star lands as soon as a new constellation has room rather than
   * waiting for the next cold start.
   */
  useEffect(() => {
    if (!ready) return;
    if (progress.rewardState !== "pending") {
      return;
    }
    const now = Date.now();
    if (now - pendingRetryAtRef.current < PENDING_RETRY_MS) return;
    pendingRetryAtRef.current = now;
    void awardCompletion();
  }, [awardCompletion, pathname, progress.rewardState, ready]);

  const invite = useCallback(() => {
    if (invitedRef.current) return;
    if (progressRef.current.status !== "idle") return;
    invitedRef.current = true;
    setWelcomeOpen(true);
  }, []);

  const start = useCallback(() => {
    const previous = progressRef.current;
    const next = {
      ...createInitialTutorialProgress("active"),
      // A replay teaches the loop again; it never mints a second star.
      rewardState: previous.rewardState,
    };
    invitedRef.current = true;
    setWelcomeOpen(false);
    persist(next);
    router.push("/dashboard/practice");
  }, [persist, router]);

  const pause = useCallback(() => {
    setPauseOpen(false);
    persist({
      ...progressRef.current,
      status: "paused",
      updatedAt: Date.now(),
    });
  }, [persist]);

  const resume = useCallback(() => {
    const next = {
      ...progressRef.current,
      status: "active" as const,
      updatedAt: Date.now(),
    };
    persist(next);
    const mission = getTutorialMission(next.currentMissionId);
    router.push(mission.href(next.context));
  }, [persist, router]);

  const value = useMemo<TutorialContextValue>(
    () => ({
      progress,
      ready,
      canInvite: ready && progress.status === "idle",
      invite,
      start,
      pause,
      resume,
    }),
    [invite, pause, progress, ready, resume, start]
  );

  const activeMission =
    progress.status === "active"
      ? getTutorialMission(progress.currentMissionId)
      : null;

  return (
    <TutorialContext.Provider value={value}>
      {children}
      <WelcomeDialog
        open={welcomeOpen}
        onStart={start}
        onClose={() => setWelcomeOpen(false)}
        onExplore={() => {
          setWelcomeOpen(false);
          persist({
            ...progressRef.current,
            status: "dismissed",
            updatedAt: Date.now(),
          });
        }}
      />
      <PauseDialog
        open={pauseOpen}
        onKeepGoing={() => setPauseOpen(false)}
        onPause={pause}
      />
      <CompletionDialog
        open={completionOpen}
        rewardPending={progress.rewardState === "pending"}
        onClose={() => setCompletionOpen(false)}
      />
      {activeMission ? (
        <>
          <MissionSpotlight
            key={`${pathname}:${activeMission.id}`}
            missionId={activeMission.id}
          />
          <MissionCard
            progress={progress}
            onGo={() => router.push(activeMission.href(progress.context))}
            onPause={() => setPauseOpen(true)}
          />
        </>
      ) : null}
      <StarRewardOverlay
        reward={starReward}
        onDone={() => {
          setStarReward(null);
          setCompletionOpen(true);
        }}
      />
    </TutorialContext.Provider>
  );
}

export function TutorialResumeCard() {
  const tutorial = useTutorial();
  if (!tutorial.ready || tutorial.progress.status !== "paused") return null;
  const mission = getTutorialMission(tutorial.progress.currentMissionId);
  return (
    <div className="app-chip flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="hidden text-text-primary sm:block">
          <ConstellationTrail
            completed={tutorial.progress.completedMissionIds.length}
            size="sm"
            decorative
          />
        </span>
        <div>
          <div className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-muted">
            Walkthrough paused
          </div>
          <div className="mt-1 text-sm font-semibold text-text-primary">
            {mission.title}
          </div>
        </div>
      </div>
      <Button size="sm" variant="secondary" onClick={tutorial.resume}>
        Resume
      </Button>
    </div>
  );
}

export function TutorialAccountCard() {
  const tutorial = useTutorial();
  if (!tutorial.ready) return null;
  const completed = tutorial.progress.completedMissionIds.length;
  const action =
    tutorial.progress.status === "paused"
      ? { label: "Resume walkthrough", run: tutorial.resume }
      : tutorial.progress.status === "active"
        ? { label: "Continue walkthrough", run: tutorial.resume }
        : {
            label:
              tutorial.progress.status === "completed"
                ? "Replay walkthrough"
                : "Start walkthrough",
            run: tutorial.start,
          };
  return (
    <Card padding="lg">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
            Jami walkthrough
          </div>
          <h2 className="mt-2 text-lg font-semibold text-text-primary">
            {completed === MISSION_COUNT
              ? "First loop complete"
              : `${completed} of ${MISSION_COUNT} missions complete`}
          </h2>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            Learn the notebook-first study loop with short, guided actions.
          </p>
          <div className="mt-4 text-text-primary">
            <ConstellationTrail completed={completed} size="md" decorative />
          </div>
        </div>
        <Button variant="secondary" onClick={action.run}>
          {action.label}
        </Button>
      </div>
    </Card>
  );
}
