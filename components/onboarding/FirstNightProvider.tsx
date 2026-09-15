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
  createFirstNightState,
  FIRST_NIGHT_DISCOVERIES,
  FIRST_NIGHT_PAGE_TARGETS,
  FIRST_NIGHT_QUERY_PARAM,
  FIRST_NIGHT_TOUR_LENGTH,
  loadLocalFirstNight,
  mergeFirstNight,
  pendingNavLabels,
  planFirstNightGuide,
  readFirstNightQuery,
  saveLocalFirstNight,
  type FirstNightAnswers,
  type FirstNightDiscoveryId,
  type FirstNightGuidePlan,
  type FirstNightState,
} from "@/lib/onboarding/first-night";
import { createOnboardingStarIfMissing } from "@/services/constellation/stars";
import { setUpFirstNightSubjects } from "@/services/onboarding/first-night-setup";
import { loadFirstNight, saveFirstNight } from "@/services/profile/first-night";

export type FirstNightFinale = "none" | "drawing" | "reward" | "leaving";

type FirstNightContextValue = {
  active: boolean;
  state: FirstNightState | null;
  pendingNavLabels: readonly string[];
  justLit: FirstNightDiscoveryId | null;
  finale: FirstNightFinale;
  point: (id: FirstNightDiscoveryId) => void;
  /** Opens the welcome from the top, whatever ran before. */
  start: () => void;
  end: () => void;
};

const INACTIVE: FirstNightContextValue = {
  active: false,
  state: null,
  pendingNavLabels: [],
  justLit: null,
  finale: "none",
  point: () => undefined,
  start: () => undefined,
  end: () => undefined,
};

const FirstNightContext = createContext<FirstNightContextValue>(INACTIVE);

/** Safe anywhere: outside the provider it reads as not running. */
export function useFirstNight() {
  return useContext(FirstNightContext);
}

const WELCOME_DISSOLVE_MS = 1_700;
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
  const [leavingWelcome, setLeavingWelcome] = useState(false);
  const [pointing, setPointing] = useState<FirstNightDiscoveryId | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [justLit, setJustLit] = useState<FirstNightDiscoveryId | null>(null);
  const [toast, setToast] = useState<string | null>(null);
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

  const light = useCallback(
    (id: FirstNightDiscoveryId) => {
      change((current) => (current.lit.includes(id) ? current : { ...current, lit: [...current.lit, id] }));
      setJustLit(id);
      setToast("A star lit in your first constellation");
    },
    [change]
  );

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

  /** The welcome's answers become folders, each with a first notebook, once. */
  const setUpSubjects = useCallback(
    (answers: FirstNightAnswers) => {
      if (setUpStarted.current || answers.subjects.length === 0) return;
      setUpStarted.current = true;
      void setUpFirstNightSubjects(userId, answers)
        .then((result) => {
          if (result.failed > 0) {
            setToast("Some of your folders could not be made. You can add them in Practice.");
          }
        })
        .catch((error: unknown) => {
          console.warn("Could not set up First night folders.", error);
          setToast("Your folders could not be made just now. You can add them in Practice.");
        });
    },
    [userId]
  );

  const enterApp = useCallback(() => {
    if (!stateRef.current) return;
    setLeavingWelcome(true);
    change((current) => ({ ...current, stage: "tour", tourStep: 0 }));
    router.push("/dashboard");
    window.setTimeout(() => setLeavingWelcome(false), WELCOME_DISSOLVE_MS);
  }, [change, router]);

  const finish = useCallback(() => {
    setFinale("leaving");
    window.setTimeout(() => {
      setFinale("none");
      change((current) => ({ ...current, stage: "finished", intent: null }));
    }, 1_000);
  }, [change]);

  // All five lit and back on Today: the figure completes, then the star.
  const allLit = Boolean(state && state.stage === "exploring" && state.lit.length === FIRST_NIGHT_DISCOVERIES.length);
  useEffect(() => {
    if (!allLit || pathname !== "/dashboard" || finale !== "none") return;
    const timer = window.setTimeout(() => setFinale("drawing"), 1_200);
    return () => window.clearTimeout(timer);
  }, [allLit, finale, pathname]);

  /*
   * The finishing star is the account's real onboarding star, given once.
   *
   * It used to be a star made up on the spot for the reward screen and saved
   * nowhere, so a student was told they had earned a star their sky never
   * showed. A replay, where the star already exists, finishes without claiming
   * a new one; a sky with no room says the star is waiting, and it is tried
   * again on a later visit.
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
          change((current) => ({ ...current, rewardState: result.status === "pending" ? "pending" : "awarded" }));
          setToast(
            result.status === "pending"
              ? "Your first constellation is complete. Its star will appear once your sky has room."
              : "Your first constellation is complete."
          );
          finish();
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          console.warn("Could not award the First night star.", error);
          change((current) => ({ ...current, rewardState: "pending" }));
          setToast("Your first constellation is complete. Its star will be added next time.");
          finish();
        });
    }, 2_600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [change, finale, finish, userId]);

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
  const plan: FirstNightGuidePlan | null =
    state && !leavingWelcome && !reward && finale === "none"
      ? planFirstNightGuide({ state, pathname, isPhone, pointing, present: (selector) => presentSet.has(selector) })
      : null;
  const guide = plan && !dismissed.includes(plan.key) ? plan : null;
  const guideTarget = guide?.target ?? null;
  const guideLights = guide?.lights ?? null;

  // Pressing the control a note points at is the discovery itself.
  useEffect(() => {
    if (!running) return;
    const onClick = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (!element) return;
      if (element.closest("[data-agent-nav]")) setPointing(null);
      if (guideLights && guideTarget && element.closest(guideTarget)) {
        window.setTimeout(() => light(guideLights), 350);
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [guideLights, guideTarget, light, running]);

  const finishGuide = () => {
    if (!guide) return;
    switch (guide.done) {
      case "next-tour":
        change((current) => ({ ...current, tourStep: Math.min(current.tourStep + 1, FIRST_NIGHT_TOUR_LENGTH - 1) }));
        break;
      case "finish-tour":
        change((current) => ({ ...current, stage: "exploring" }));
        break;
      case "clear-point":
        setPointing(null);
        break;
      case "light":
        if (guide.lights) light(guide.lights);
        break;
      case "dismiss":
        setDismissed((current) => [...current, guide.key]);
        break;
    }
  };

  const value = useMemo<FirstNightContextValue>(
    () => ({
      active: running || finale !== "none",
      state,
      pendingNavLabels: finale === "none" ? pendingNavLabels(state) : [],
      justLit,
      finale,
      point,
      start,
      end,
    }),
    [end, finale, justLit, point, running, start, state]
  );

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
          text={guide.text}
          doneLabel={guide.doneLabel}
          onDone={finishGuide}
          onSkip={guide.skippable ? () => change((current) => ({ ...current, stage: "exploring" })) : undefined}
        />
      ) : null}

      {toast ? (
        <div className="fn-toast" role="status">
          <Sparkle size={13} /> {toast}
          {pathname !== "/dashboard" && running ? <span className="fn-toast-hint">See it on Today</span> : null}
        </div>
      ) : null}

      <StarRewardOverlay
        reward={reward}
        onDone={() => {
          setReward(null);
          if (finale === "reward") finish();
        }}
      />
    </FirstNightContext.Provider>
  );
}
