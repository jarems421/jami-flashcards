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
import StarRewardOverlay, { type StarReward } from "@/components/constellation/StarRewardOverlay";
import FirstNightGuide from "@/components/onboarding/FirstNightGuide";
import { Sparkle } from "@/components/onboarding/FirstNightSky";
import FirstNightWelcome from "@/components/onboarding/FirstNightWelcome";
import {
  allFirstNightLit,
  createFirstNightState,
  FIRST_NIGHT_ACTIONS,
  FIRST_NIGHT_PAGE_TARGETS,
  FIRST_NIGHT_QUERY_PARAM,
  FIRST_NIGHT_TOUR_LENGTH,
  getFirstNightDiscovery,
  isOnDiscoveryRoute,
  loadLocalFirstNight,
  mergeFirstNight,
  pendingNavLabels,
  firstNightDiscoveries,
  nextFirstNightDiscovery,
  planFirstNightGuide,
  readFirstNightQuery,
  saveLocalFirstNight,
  SECOND_NIGHT_ACTIONS,
  SECOND_NIGHT_STARS,
  secondNightOpen,
  type FirstNightAnswers,
  type FirstNightDiscoveryId,
  type FirstNightGuidePlan,
  type FirstNightStage,
  type FirstNightState,
  type SecondNightStarId,
} from "@/lib/onboarding/first-night";
import FirstNightBloom, { type FirstNightBloomContent } from "@/components/onboarding/FirstNightBloom";
import { TUTORIAL_ACTION_EVENT, type OnboardingActionId } from "@/lib/onboarding/tutorial";
import { createOnboardingStarIfMissing } from "@/services/constellation/stars";
import { setUpFirstNightSubjects } from "@/services/onboarding/first-night-setup";
import { loadFirstNight, saveFirstNight } from "@/services/profile/first-night";

export type FirstNightFinale = "none" | "drawing" | "reward" | "leaving";

type FirstNightContextValue = {
  active: boolean;
  /** The account's copy has been read, so `state` being null means it has never run. */
  ready: boolean;
  state: FirstNightState | null;
  pendingNavLabels: readonly string[];
  justLit: FirstNightDiscoveryId | null;
  finale: FirstNightFinale;
  point: (id: FirstNightDiscoveryId) => void;
  /** Goes to where a star is lit, and lets that page's note take over. */
  goTo: (id: FirstNightDiscoveryId) => void;
  /** Whether Today should offer the second night. */
  secondNight: boolean;
  goToSecondNight: (id: SecondNightStarId) => void;
  hideSecondNight: () => void;
  /** Opens the welcome from the top, whatever ran before. */
  start: () => void;
  end: () => void;
};

const INACTIVE: FirstNightContextValue = {
  active: false,
  ready: false,
  state: null,
  pendingNavLabels: [],
  justLit: null,
  finale: "none",
  point: () => undefined,
  goTo: () => undefined,
  secondNight: false,
  goToSecondNight: () => undefined,
  hideSecondNight: () => undefined,
  start: () => undefined,
  end: () => undefined,
};

const FirstNightContext = createContext<FirstNightContextValue>(INACTIVE);

/** Safe anywhere: outside the provider it reads as not running. */
export function useFirstNight() {
  return useContext(FirstNightContext);
}

const WELCOME_DISSOLVE_MS = 1_700;
const LEAVE_MS = 1_000;
const PHONE_WIDTH = 768;

function initialState(userId: string): FirstNightState | null {
  if (typeof window === "undefined") return null;
  const query = readFirstNightQuery(window.location.search);
  const local = loadLocalFirstNight(userId);
  if (query === "preview") return createFirstNightState();
  if (query === "off") return { ...(local ?? createFirstNightState()), stage: "finished", updatedAt: Date.now() };
  return local;
}

/**
 * Runs First night over the real app.
 *
 * Mounted around the dashboard, so the notes, the Today panel and the sidebar
 * badges all read one state however the student moves around. That state is
 * saved to the account on every change and mirrored on the device, so closing
 * the tab or opening Jami somewhere else carries on from the same star.
 */
export default function FirstNightProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [state, setState] = useState<FirstNightState | null>(() => initialState(userId));
  const stateRef = useRef(state);
  // A link that starts or ends it has already decided; otherwise wait for the account.
  const [ready, setReady] = useState(() => typeof window !== "undefined" && readFirstNightQuery(window.location.search) !== null);
  const [leavingWelcome, setLeavingWelcome] = useState(false);
  const [pointing, setPointing] = useState<FirstNightDiscoveryId | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [justLit, setJustLit] = useState<FirstNightDiscoveryId | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [bloom, setBloom] = useState<FirstNightBloomContent | null>(null);
  const pathnameRef = useRef(pathname);
  const [finale, setFinale] = useState<FirstNightFinale>("none");
  const [reward, setReward] = useState<StarReward | null>(null);
  const [isPhone, setIsPhone] = useState(() => typeof window !== "undefined" && window.innerWidth < PHONE_WIDTH);
  const [present, setPresent] = useState("");
  const setUpStarted = useRef(false);
  const pendingRewardTried = useRef(false);

  const persist = useCallback(
    (next: FirstNightState) => {
      saveLocalFirstNight(userId, next);
      void saveFirstNight(userId, next).catch((error: unknown) => {
        console.warn("Could not save First night progress.", error);
      });
    },
    [userId]
  );

  const commit = useCallback(
    (next: FirstNightState) => {
      stateRef.current = next;
      setState(next);
      persist(next);
    },
    [persist]
  );

  /** A change to the running walkthrough, saved as it happens. */
  const change = useCallback(
    (make: (current: FirstNightState) => FirstNightState) => {
      const current = stateRef.current;
      if (!current) return;
      const next = make(current);
      if (next === current) return;
      commit({ ...next, updatedAt: Date.now() });
    },
    [commit]
  );

  // A link that started or ended it has done its job; otherwise the account's copy is read.
  useEffect(() => {
    let active = true;
    const url = new URL(window.location.href);
    if (url.searchParams.has(FIRST_NIGHT_QUERY_PARAM)) {
      url.searchParams.delete(FIRST_NIGHT_QUERY_PARAM);
      window.history.replaceState(window.history.state, "", url.toString());
      if (stateRef.current) persist(stateRef.current);
      return;
    }
    void loadFirstNight(userId)
      .then((remote) => {
        if (!active) return;
        const merged = mergeFirstNight(loadLocalFirstNight(userId), remote);
        if (!merged) return;
        stateRef.current = merged;
        setState(merged);
        saveLocalFirstNight(userId, merged);
        // Progress made while the account could not be reached catches up here.
        if (!remote || merged.updatedAt > remote.updatedAt) {
          void saveFirstNight(userId, merged).catch(() => undefined);
        }
      })
      .catch((error: unknown) => {
        console.warn("Could not load First night progress.", error);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [persist, userId]);

  useEffect(() => {
    const onResize = () => setIsPhone(window.innerWidth < PHONE_WIDTH);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const running = Boolean(state && state.stage !== "finished");

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  /*
   * Straight to where a star is lit. The sidebar entry still carries its small
   * star and the page still explains itself on arrival, so the way there is
   * learned without having to be hunted for first.
   */
  const goTo = useCallback(
    (id: FirstNightDiscoveryId) => {
      const discovery = getFirstNightDiscovery(id);
      setPointing(null);
      setBloom(null);
      change((current) => (current.intent === id ? current : { ...current, intent: id }));
      if (!isOnDiscoveryRoute(pathnameRef.current, discovery)) router.push(discovery.href);
    },
    [change, router]
  );

  const goToSecondNight = useCallback(
    (id: SecondNightStarId) => {
      const star = SECOND_NIGHT_STARS.find((entry) => entry.id === id);
      setBloom(null);
      if (star && !pathnameRef.current.startsWith(star.href)) router.push(star.href);
    },
    [router]
  );

  const hideSecondNight = useCallback(() => {
    change((current) => (current.bonusHidden ? current : { ...current, bonusHidden: true }));
  }, [change]);

  // Which page controls are on screen, since pages render theirs as data arrives.
  useEffect(() => {
    if (!running) return;
    const scan = () => {
      const found = FIRST_NIGHT_PAGE_TARGETS.filter((selector) => document.querySelector(selector)).join("\n");
      setPresent((current) => (current === found ? current : found));
    };
    scan();
    const interval = window.setInterval(scan, 500);
    return () => window.clearInterval(interval);
  }, [pathname, running]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4_200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  /*
   * A star lights when the app reports the thing itself: a page that saved,
   * a card that was added, a question that came back marked. Nothing a note
   * says can light one, so a star always stands for something done.
   */
  useEffect(() => {
    const onAction = (event: Event) => {
      const action = (event as CustomEvent<{ missionId?: OnboardingActionId }>).detail?.missionId;
      const current = stateRef.current;
      if (!action || !current) return;

      // The second night lights only once the first is over, and only its own stars.
      if (current.stage === "finished") {
        const bonusId = SECOND_NIGHT_ACTIONS[action];
        if (!bonusId || current.bonusHidden || current.bonus.includes(bonusId)) return;
        const bonus = [...current.bonus, bonusId];
        change((latest) => (latest.bonus.includes(bonusId) ? latest : { ...latest, bonus: [...latest.bonus, bonusId] }));
        const star = SECOND_NIGHT_STARS.find((entry) => entry.id === bonusId)!;
        const next = SECOND_NIGHT_STARS.find((entry) => !bonus.includes(entry.id));
        setBloom({
          key: `second-${bonusId}`,
          eyebrow: next ? `Second night · ${bonus.length} of ${SECOND_NIGHT_STARS.length}` : "Second night · complete",
          title: star.title,
          text: next ? star.unlocked : `${star.unlocked} That is all of Jami's night sky. The rest is yours.`,
          ...(next ? { next: { label: `Next: ${next.title}`, run: () => goToSecondNight(next.id) } } : {}),
        });
        return;
      }

      const id = FIRST_NIGHT_ACTIONS[action];
      if (!id || (current.stage !== "tour" && current.stage !== "exploring")) return;
      if (current.lit.includes(id)) return;
      const lit = [...current.lit, id];
      change((latest) => (latest.lit.includes(id) ? latest : { ...latest, lit: [...latest.lit, id], intent: null }));
      setPointing((pointed) => (pointed === id ? null : pointed));
      setJustLit(id);
      const discovery = getFirstNightDiscovery(id);
      const total = firstNightDiscoveries(current).length;
      const next = nextFirstNightDiscovery({ ...current, lit, intent: null });
      setBloom({
        key: `first-${id}`,
        eyebrow: next ? `Star ${lit.length} of ${total} lit` : `All ${total} stars lit`,
        title: discovery.title,
        text: next ? discovery.unlocked : `${discovery.unlocked} Your first constellation is complete.`,
        ...(next
          ? { next: { label: `Next: ${next.title}`, run: () => goTo(next.id) } }
          : pathnameRef.current !== "/dashboard"
            ? { next: { label: "See your constellation", run: () => router.push("/dashboard") } }
            : {}),
      });
    };
    window.addEventListener(TUTORIAL_ACTION_EVENT, onAction);
    return () => window.removeEventListener(TUTORIAL_ACTION_EVENT, onAction);
  }, [change, goTo, goToSecondNight, router]);

  // Heading for another page from a note: once there, the page's own note takes over.
  useEffect(() => {
    if (!running) return;
    const onClick = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest("[data-agent-nav]")) setPointing(null);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [running]);

  const end = useCallback(() => {
    change((current) => ({ ...current, stage: "finished", intent: null }));
    setPointing(null);
    setReward(null);
    setFinale("none");
    setLeavingWelcome(false);
  }, [change]);

  const start = useCallback(() => {
    setPointing(null);
    setReward(null);
    setFinale("none");
    setLeavingWelcome(false);
    setDismissed([]);
    setJustLit(null);
    setUpStarted.current = false;
    // A replay never earns the star a second time.
    commit({ ...createFirstNightState(), rewardState: stateRef.current?.rewardState ?? "not-earned" });
  }, [commit]);

  const point = useCallback(
    (id: FirstNightDiscoveryId) => {
      setPointing(id);
      change((current) => ({ ...current, intent: id }));
    },
    [change]
  );

  /** The welcome's answers become folders, once, while the "ready" screen plays. */
  const setUpSubjects = useCallback(
    (answers: FirstNightAnswers) => {
      if (setUpStarted.current || answers.subjects.length === 0) return;
      setUpStarted.current = true;
      void setUpFirstNightSubjects(userId, answers)
        .then((result) => {
          change((current) => (current.examReady === result.examReady ? current : { ...current, examReady: result.examReady }));
          if (result.failed > 0) {
            setToast("Some of your folders could not be made. You can add them in Practice.");
          }
        })
        .catch((error: unknown) => {
          console.warn("Could not set up First night folders.", error);
          setToast("Your folders could not be made just now. You can add them in Practice.");
        });
    },
    [change, userId]
  );

  const enterApp = useCallback(() => {
    if (!stateRef.current) return;
    setLeavingWelcome(true);
    change((current) => ({ ...current, stage: "tour", tourStep: 0 }));
    router.push("/dashboard");
    window.setTimeout(() => setLeavingWelcome(false), WELCOME_DISSOLVE_MS);
  }, [change, router]);

  /** The panel fades, then the walkthrough moves on to its next stage. */
  const leaveTo = useCallback(
    (stage: FirstNightStage) => {
      setFinale("leaving");
      window.setTimeout(() => {
        setFinale("none");
        change((current) => ({ ...current, stage, intent: null }));
      }, LEAVE_MS);
    },
    [change]
  );

  // Every star lit and back on Today: the figure completes, then the real star.
  const allLit = Boolean(state && state.stage === "exploring" && allFirstNightLit(state));
  useEffect(() => {
    if (!allLit || pathname !== "/dashboard" || finale !== "none") return;
    const timer = window.setTimeout(() => setFinale("drawing"), 1_200);
    return () => window.clearTimeout(timer);
  }, [allLit, finale, pathname]);

  /*
   * The finishing star is the account's real onboarding star, given once.
   *
   * A replay, where the star already exists, still ends by showing the sky it
   * is in. A sky with no room says the star is waiting, and it is tried again
   * on a later visit; there is nothing to show yet, so the walkthrough ends.
   */
  useEffect(() => {
    if (finale !== "drawing") return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void createOnboardingStarIfMissing(userId)
        .then((result) => {
          if (cancelled) return;
          if (result.status === "awarded") {
            change((current) => ({ ...current, rewardState: "awarded" }));
            setFinale("reward");
            setReward({ goalName: "First night", star: result.star });
            return;
          }
          if (result.status === "pending") {
            change((current) => ({ ...current, rewardState: "pending" }));
            setToast("Your first constellation is complete. Its star will appear once your sky has room.");
            leaveTo("finished");
            return;
          }
          change((current) => ({ ...current, rewardState: "awarded" }));
          setToast("Your first constellation is complete.");
          leaveTo("sky");
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          console.warn("Could not award the First night star.", error);
          change((current) => ({ ...current, rewardState: "pending" }));
          setToast("Your first constellation is complete. Its star will be added next time.");
          leaveTo("finished");
        });
    }, 2_600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [change, finale, leaveTo, userId]);

  // A star that was waiting for room is tried again once a visit.
  const rewardPending = state?.stage === "finished" && state.rewardState === "pending";
  useEffect(() => {
    if (!rewardPending || pendingRewardTried.current) return;
    pendingRewardTried.current = true;
    void createOnboardingStarIfMissing(userId)
      .then((result) => {
        if (result.status === "pending") return;
        change((current) => ({ ...current, rewardState: "awarded" }));
        if (result.status === "awarded") setReward({ goalName: "First night", star: result.star });
      })
      .catch(() => undefined);
  }, [change, rewardPending, userId]);

  const presentSet = useMemo(() => new Set(present.split("\n")), [present]);
  // One voice at a time: while a star's bloom is open the guide waits, rather
  // than gliding an empty note across the page to a target it has not found.
  const plan: FirstNightGuidePlan | null =
    state && !leavingWelcome && !reward && !bloom && finale === "none"
      ? planFirstNightGuide({ state, pathname, isPhone, pointing, present: (selector) => presentSet.has(selector) })
      : null;
  const guide = plan && !dismissed.includes(plan.key) ? plan : null;

  const finishGuide = () => {
    if (!guide) return;
    switch (guide.done) {
      case "next-tour":
        change((current) => ({ ...current, tourStep: Math.min(current.tourStep + 1, FIRST_NIGHT_TOUR_LENGTH - 1) }));
        break;
      case "finish-tour": {
        change((current) => ({ ...current, stage: "exploring" }));
        // Straight into the first star: the tour's last word is "let's go", so it goes.
        const first = state ? nextFirstNightDiscovery({ ...state, stage: "exploring" }) : null;
        if (first) goTo(first.id);
        break;
      }
      case "clear-point":
        setPointing(null);
        break;
      case "dismiss":
        setDismissed((current) => [...current, guide.key]);
        break;
      case "finish":
        change((current) => ({ ...current, stage: "finished", intent: null }));
        break;
    }
  };

  const value = useMemo<FirstNightContextValue>(
    () => ({
      active: running || finale !== "none",
      ready,
      state,
      pendingNavLabels: finale === "none" ? pendingNavLabels(state) : [],
      justLit,
      finale,
      point,
      goTo,
      secondNight: finale === "none" && secondNightOpen(state),
      goToSecondNight,
      hideSecondNight,
      start,
      end,
    }),
    [end, finale, goTo, goToSecondNight, hideSecondNight, justLit, point, ready, running, start, state]
  );

  const exploring = state?.stage === "tour" || state?.stage === "exploring";

  return (
    <FirstNightContext.Provider value={value}>
      {children}

      {state && (state.stage === "welcome" || leavingWelcome) ? (
        <FirstNightWelcome leaving={leavingWelcome} onConfirm={setUpSubjects} onEnter={enterApp} />
      ) : null}

      {guide ? (
        <FirstNightGuide
          target={guide.target}
          near={guide.near}
          {...(guide.eyebrow ? { eyebrow: guide.eyebrow } : {})}
          text={guide.text}
          doneLabel={guide.doneLabel}
          onDone={finishGuide}
          onSkip={guide.skippable ? () => change((current) => ({ ...current, stage: "exploring" })) : undefined}
        />
      ) : null}

      {toast ? (
        <div className="fn-toast" role="status">
          <Sparkle size={13} /> {toast}
          {pathname !== "/dashboard" && exploring ? <span className="fn-toast-hint">See it on Today</span> : null}
        </div>
      ) : null}

      <FirstNightBloom content={finale === "none" ? bloom : null} onClose={() => setBloom(null)} />

      <StarRewardOverlay
        reward={reward}
        onDone={() => {
          setReward(null);
          if (finale === "reward") leaveTo("sky");
        }}
      />
    </FirstNightContext.Provider>
  );
}
