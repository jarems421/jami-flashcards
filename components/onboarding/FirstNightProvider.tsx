"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  loadStoredFirstNight,
  pendingNavLabels,
  planFirstNightGuide,
  readFirstNightQuery,
  storeFirstNight,
  type FirstNightDiscoveryId,
  type FirstNightGuidePlan,
  type FirstNightState,
} from "@/lib/onboarding/first-night";

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

function initialState(): FirstNightState | null {
  if (typeof window === "undefined") return null;
  const query = readFirstNightQuery(window.location.search);
  if (query === "preview") {
    const fresh = createFirstNightState();
    storeFirstNight(fresh);
    return fresh;
  }
  if (query === "off") {
    storeFirstNight(null);
    return null;
  }
  return loadStoredFirstNight();
}

/**
 * Runs the First night preview over the real app.
 *
 * Mounted around the dashboard, so the notes, the Today panel and the sidebar
 * badges all read one state however the student moves around.
 */
export default function FirstNightProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [state, setState] = useState<FirstNightState | null>(initialState);
  const [leavingWelcome, setLeavingWelcome] = useState(false);
  const [pointing, setPointing] = useState<FirstNightDiscoveryId | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [justLit, setJustLit] = useState<FirstNightDiscoveryId | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [finale, setFinale] = useState<FirstNightFinale>("none");
  const [reward, setReward] = useState<StarReward | null>(null);
  const [isPhone, setIsPhone] = useState(() => typeof window !== "undefined" && window.innerWidth < PHONE_WIDTH);
  const [present, setPresent] = useState("");

  const update = useCallback((next: FirstNightState | null) => {
    setState(next);
    storeFirstNight(next);
  }, []);

  // The link that started or ended the preview has done its job.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(FIRST_NIGHT_QUERY_PARAM)) return;
    url.searchParams.delete(FIRST_NIGHT_QUERY_PARAM);
    window.history.replaceState(window.history.state, "", url.toString());
  }, []);

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
    const timer = window.setTimeout(() => setToast(null), 3_400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const light = useCallback(
    (id: FirstNightDiscoveryId) => {
      setState((current) => {
        if (!current || current.lit.includes(id)) return current;
        const next = { ...current, lit: [...current.lit, id] };
        storeFirstNight(next);
        return next;
      });
      setJustLit(id);
      setToast("A star lit in your first constellation");
    },
    []
  );

  const end = useCallback(() => {
    update(null);
    setPointing(null);
    setReward(null);
    setFinale("none");
    setLeavingWelcome(false);
  }, [update]);

  const start = useCallback(() => {
    end();
    setDismissed([]);
    setJustLit(null);
    update(createFirstNightState());
  }, [end, update]);

  const point = useCallback(
    (id: FirstNightDiscoveryId) => {
      setPointing(id);
      setState((current) => {
        if (!current) return current;
        const next = { ...current, intent: id };
        storeFirstNight(next);
        return next;
      });
    },
    []
  );

  const enterApp = useCallback(() => {
    if (!state) return;
    setLeavingWelcome(true);
    update({ ...state, stage: "tour", tourStep: 0 });
    router.push("/dashboard");
    window.setTimeout(() => setLeavingWelcome(false), WELCOME_DISSOLVE_MS);
  }, [router, state, update]);

  // All five lit and back on Today: the figure completes, then the reward.
  const allLit = Boolean(state && state.stage === "exploring" && state.lit.length === FIRST_NIGHT_DISCOVERIES.length);
  useEffect(() => {
    if (!allLit || pathname !== "/dashboard" || finale !== "none") return;
    const timer = window.setTimeout(() => setFinale("drawing"), 1_200);
    return () => window.clearTimeout(timer);
  }, [allLit, finale, pathname]);

  useEffect(() => {
    if (finale !== "drawing") return;
    const timer = window.setTimeout(() => {
      setFinale("reward");
      setReward({
        goalName: "First night",
        star: {
          id: `first-night-preview-${Date.now()}`,
          goalId: "",
          constellationId: "first-night",
          size: 3,
          glow: 1,
          position: { x: 50, y: 50 },
          createdAt: 1,
          rewardKind: "onboarding",
          rewardLabel: "First night",
        },
      });
    }, 2_600);
    return () => window.clearTimeout(timer);
  }, [finale]);

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
    if (!guide || !state) return;
    switch (guide.done) {
      case "next-tour":
        update({ ...state, tourStep: Math.min(state.tourStep + 1, FIRST_NIGHT_TOUR_LENGTH - 1) });
        break;
      case "finish-tour":
        update({ ...state, stage: "exploring" });
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
        <FirstNightWelcome leaving={leavingWelcome} onEnter={enterApp} onEnd={end} />
      ) : null}

      {guide ? (
        <FirstNightGuide
          target={guide.target}
          near={guide.near}
          text={guide.text}
          doneLabel={guide.doneLabel}
          onDone={finishGuide}
          onSkip={guide.skippable && state ? () => update({ ...state, stage: "exploring" }) : undefined}
        />
      ) : null}

      {toast ? (
        <div className="fn-toast" role="status">
          <Sparkle size={13} /> {toast}
          {pathname !== "/dashboard" ? <span className="fn-toast-hint">See it on Today</span> : null}
        </div>
      ) : null}

      <StarRewardOverlay
        reward={reward}
        onDone={() => {
          setReward(null);
          setFinale("leaving");
          window.setTimeout(() => {
            setFinale("none");
            setState((current) => {
              if (!current) return current;
              const next = { ...current, stage: "finished" as const };
              storeFirstNight(next);
              return next;
            });
          }, 1_000);
        }}
      />
    </FirstNightContext.Provider>
  );
}
