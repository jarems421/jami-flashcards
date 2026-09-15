/**
 * "First night": the sign-up walkthrough, previewed inside the real app.
 *
 * A short welcome on a night sky, then a tour of the real sidebar, then five
 * discoveries that each light a star on Today. Every discovery sends the
 * student to the place it lives through the navigation itself, so by the end
 * they have used each part of the app they will come back to.
 *
 * Preview only for now: it starts from `?first-night=preview`, keeps its
 * progress in this tab's session, and writes nothing to the account.
 */

export const FIRST_NIGHT_QUERY_PARAM = "first-night";
const STORAGE_KEY = "jami:first-night-preview";

export type FirstNightDiscoveryId = "notebook" | "exam" | "learn" | "tutor" | "stars";
export type FirstNightStage = "welcome" | "tour" | "exploring" | "finished";

export type FirstNightDiscovery = {
  id: FirstNightDiscoveryId;
  title: string;
  /** The sidebar entry it lives under, exactly as the sidebar labels it. */
  navLabel: string;
  href: string;
  /** Where its star sits in the Today panel's sky, in percentages. */
  x: number;
  y: number;
};

export const FIRST_NIGHT_DISCOVERIES: readonly FirstNightDiscovery[] = [
  { id: "notebook", title: "Write in a notebook", navLabel: "Practice", href: "/dashboard/practice", x: 16, y: 64 },
  { id: "exam", title: "Get an exam question marked", navLabel: "Practice", href: "/dashboard/practice", x: 34, y: 34 },
  { id: "learn", title: "Flip a flashcard", navLabel: "Learn", href: "/dashboard/study", x: 54, y: 54 },
  { id: "tutor", title: "Ask Tutor about your material", navLabel: "Tutor", href: "/dashboard/tutor", x: 71, y: 26 },
  { id: "stars", title: "Turn your stars into a picture", navLabel: "Stars", href: "/dashboard/constellation", x: 86, y: 60 },
];

export type FirstNightState = {
  version: 1;
  stage: FirstNightStage;
  tourStep: number;
  lit: FirstNightDiscoveryId[];
  /** The discovery last asked for from Today, when two share a page. */
  intent: FirstNightDiscoveryId | null;
};

/** The real controls the walkthrough points at, marked where they are rendered. */
export const FIRST_NIGHT_TARGETS = {
  navShell: '[data-nav="sidebar"], [data-nav="bar"]',
  loopGroup: '[data-first-night-group="loop"]',
  supportGroup: '[data-first-night-group="support"]',
  panel: '[data-tutorial-target="first-night"]',
  firstFolder: '[data-tutorial-target="first-folder"]',
  createFolder: '[data-tutorial-target="create-folder"]',
  firstNotebook: '[data-tutorial-target="first-notebook"]',
  createNotebook: '[data-tutorial-target="create-notebook"]',
  pen: '[data-tutorial-target="pen"]',
  examQuestions: '[data-tutorial-target="exam-questions"]',
  markAnswer: '[data-tutorial-target="mark-answer"]',
  flashcard: '[data-tutorial-target="flashcard"]',
  startReview: '[data-tutorial-target="start-review"]',
  tutorMaterial: '[data-tutorial-target="tutor-material"]',
  skyAsk: '[data-tutorial-target="sky-ask"]',
} as const;

/** The page controls whose presence decides which note applies. */
export const FIRST_NIGHT_PAGE_TARGETS: readonly string[] = [
  FIRST_NIGHT_TARGETS.firstFolder,
  FIRST_NIGHT_TARGETS.createFolder,
  FIRST_NIGHT_TARGETS.firstNotebook,
  FIRST_NIGHT_TARGETS.createNotebook,
  FIRST_NIGHT_TARGETS.pen,
  FIRST_NIGHT_TARGETS.examQuestions,
  FIRST_NIGHT_TARGETS.markAnswer,
  FIRST_NIGHT_TARGETS.flashcard,
  FIRST_NIGHT_TARGETS.startReview,
  FIRST_NIGHT_TARGETS.tutorMaterial,
  FIRST_NIGHT_TARGETS.skyAsk,
];

export function navTarget(label: string) {
  return `[data-agent-nav="${label}"]`;
}

const DISCOVERY_IDS = new Set<string>(FIRST_NIGHT_DISCOVERIES.map((discovery) => discovery.id));
const STAGES = new Set<string>(["welcome", "tour", "exploring", "finished"]);

export function getFirstNightDiscovery(id: FirstNightDiscoveryId) {
  return FIRST_NIGHT_DISCOVERIES.find((discovery) => discovery.id === id) ?? FIRST_NIGHT_DISCOVERIES[0];
}

export function createFirstNightState(): FirstNightState {
  return { version: 1, stage: "welcome", tourStep: 0, lit: [], intent: null };
}

export function readFirstNightState(value: unknown): FirstNightState | null {
  if (typeof value !== "object" || value === null) return null;
  const { version, stage, tourStep, lit, intent } = value as Record<string, unknown>;
  if (version !== 1 || typeof stage !== "string" || !STAGES.has(stage)) return null;
  const litIds = Array.isArray(lit)
    ? Array.from(new Set(lit.filter((id): id is FirstNightDiscoveryId => typeof id === "string" && DISCOVERY_IDS.has(id))))
    : [];
  return {
    version: 1,
    stage: stage as FirstNightStage,
    tourStep: typeof tourStep === "number" && Number.isInteger(tourStep) && tourStep >= 0 ? tourStep : 0,
    lit: litIds,
    intent: typeof intent === "string" && DISCOVERY_IDS.has(intent) ? (intent as FirstNightDiscoveryId) : null,
  };
}

export function readFirstNightQuery(search: string): "preview" | "off" | null {
  const value = new URLSearchParams(search).get(FIRST_NIGHT_QUERY_PARAM);
  return value === "preview" || value === "off" ? value : null;
}

export function loadStoredFirstNight(): FirstNightState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? readFirstNightState(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function storeFirstNight(state: FirstNightState | null) {
  if (typeof window === "undefined") return;
  try {
    if (state) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // A preview that cannot be remembered still runs for this page.
  }
}

export function isOnDiscoveryRoute(pathname: string, discovery: FirstNightDiscovery) {
  switch (discovery.id) {
    case "notebook":
      return (
        (pathname.startsWith("/dashboard/practice") && !pathname.startsWith("/dashboard/practice/questions")) ||
        pathname.startsWith("/dashboard/folders") ||
        pathname.startsWith("/dashboard/notebooks")
      );
    case "exam":
      return pathname.startsWith("/dashboard/practice");
    default:
      return pathname.startsWith(discovery.href);
  }
}

/** Sidebar entries that still hold an unlit star, so they can say so. */
export function pendingNavLabels(state: FirstNightState | null): string[] {
  if (!state || (state.stage !== "tour" && state.stage !== "exploring")) return [];
  return Array.from(
    new Set(FIRST_NIGHT_DISCOVERIES.filter((discovery) => !state.lit.includes(discovery.id)).map((discovery) => discovery.navLabel))
  );
}

export type FirstNightGuideDone = "next-tour" | "finish-tour" | "clear-point" | "light" | "dismiss";

export type FirstNightGuidePlan = {
  /** Stable per note, so a dismissed note stays dismissed. */
  key: string;
  /** The control to spotlight, or null for a note with nothing to point at. */
  target: string | null;
  /** Sit beside this rather than over the page, when there is room. */
  near?: string;
  text: string;
  doneLabel: string;
  done: FirstNightGuideDone;
  skippable?: boolean;
  /** Pressing the target itself lights this star. */
  lights?: FirstNightDiscoveryId;
};

type GuideInput = {
  state: FirstNightState;
  pathname: string;
  isPhone: boolean;
  pointing: FirstNightDiscoveryId | null;
  present: (selector: string) => boolean;
};

function tourSteps(isPhone: boolean): Omit<FirstNightGuidePlan, "key">[] {
  const T = FIRST_NIGHT_TARGETS;
  return [
    {
      target: T.navShell,
      near: isPhone ? undefined : T.navShell,
      text: isPhone
        ? "This bar is your map. Swipe it sideways to see everything in Jami."
        : "This is your map. Everything in Jami is one tap away from here.",
      doneLabel: "Next",
      done: "next-tour",
      skippable: true,
    },
    {
      target: isPhone ? navTarget("Practice") : T.loopGroup,
      near: isPhone ? undefined : T.loopGroup,
      text: isPhone
        ? "Practice holds your folders, notebooks and exam questions."
        : "Your study loop lives up here: Today, Learn, Practice and Tutor. You'll use these most.",
      doneLabel: "Next",
      done: "next-tour",
      skippable: true,
    },
    {
      target: isPhone ? navTarget("Stars") : T.supportGroup,
      near: isPhone ? undefined : T.supportGroup,
      text: isPhone
        ? "Keep swiping for Flashcards, Goals, your Stars and Progress."
        : "Your flashcards, topics, goals, stars and progress are down here.",
      doneLabel: "Next",
      done: "next-tour",
      skippable: true,
    },
    {
      target: T.panel,
      near: isPhone ? undefined : T.panel,
      text: "Now light your first constellation. Each star takes you somewhere new, so you'll know where everything lives.",
      doneLabel: "Let's go",
      done: "finish-tour",
    },
  ];
}

export const FIRST_NIGHT_TOUR_LENGTH = tourSteps(false).length;

/**
 * The one note that applies right now, if any.
 *
 * Decided from where the student is and what is actually on the page, so a
 * note only ever points at something they can see and press.
 */
export function planFirstNightGuide({ state, pathname, isPhone, pointing, present }: GuideInput): FirstNightGuidePlan | null {
  const T = FIRST_NIGHT_TARGETS;
  const lit = new Set(state.lit);

  if (state.stage === "tour") {
    const steps = tourSteps(isPhone);
    const index = Math.min(state.tourStep, steps.length - 1);
    return { ...steps[index], key: `tour-${index}` };
  }
  if (state.stage !== "exploring") return null;

  if (pointing) {
    const discovery = getFirstNightDiscovery(pointing);
    if (!isOnDiscoveryRoute(pathname, discovery)) {
      const nav = navTarget(discovery.navLabel);
      return {
        key: `point-${discovery.id}`,
        target: nav,
        near: isPhone ? undefined : nav,
        text: `That's in ${discovery.navLabel}. Tap ${discovery.navLabel} ${isPhone ? "in the bar at the bottom" : "in the sidebar"} to go there.`,
        doneLabel: "Maybe later",
        done: "clear-point",
      };
    }
  }

  if (pathname.startsWith("/dashboard/notebooks/") && !lit.has("notebook")) {
    return present(T.pen)
      ? { key: "notebook-pen", target: T.pen, text: "Pick the pen and write just like paper. Everything saves as you go.", doneLabel: "Got it", done: "light", lights: "notebook" }
      : null;
  }

  if (pathname.startsWith("/dashboard/folders/") && !lit.has("notebook")) {
    if (present(T.firstNotebook)) {
      return { key: "notebook-open", target: T.firstNotebook, text: "Open a notebook to start writing.", doneLabel: "Got it", done: "dismiss" };
    }
    if (present(T.createNotebook)) {
      return { key: "notebook-create", target: T.createNotebook, text: "Make a notebook for this folder, then open it to write.", doneLabel: "Got it", done: "dismiss" };
    }
    return null;
  }

  if (pathname.startsWith("/dashboard/practice/questions") && !lit.has("exam")) {
    return present(T.markAnswer)
      ? { key: "exam-mark", target: T.markAnswer, text: "Write your answer, then press Mark answer. Jami marks it like an examiner.", doneLabel: "Got it", done: "light", lights: "exam" }
      : { key: "exam-choose", target: null, text: "Choose a course and a question. Once you've answered, press Mark answer and Jami marks it like an examiner.", doneLabel: "Got it", done: "dismiss" };
  }

  if (pathname === "/dashboard/practice") {
    const examGuide: FirstNightGuidePlan | null =
      !lit.has("exam") && present(T.examQuestions)
        ? { key: "exam-open", target: T.examQuestions, text: "Real exam questions live here. Pick one and Jami marks it like an examiner.", doneLabel: "Got it", done: "dismiss" }
        : null;
    if (state.intent === "exam" && examGuide) return examGuide;
    if (!lit.has("notebook")) {
      if (present(T.firstFolder)) {
        return { key: "notebook-folder", target: T.firstFolder, text: "Each subject has its own folder. Open one to find its notebooks.", doneLabel: "Got it", done: "dismiss" };
      }
      if (present(T.createFolder)) {
        return { key: "notebook-new-folder", target: T.createFolder, text: "Make a folder for a subject. Its notebooks will live inside.", doneLabel: "Got it", done: "dismiss" };
      }
    }
    return examGuide;
  }

  if (pathname.startsWith("/dashboard/study") && !lit.has("learn")) {
    if (present(T.flashcard)) {
      return { key: "learn-flip", target: T.flashcard, text: "Tap the card to see the answer, then say how well you knew it.", doneLabel: "Got it", done: "light", lights: "learn" };
    }
    if (present(T.startReview)) {
      return { key: "learn-start", target: T.startReview, text: "Start a review and your first card appears.", doneLabel: "Got it", done: "dismiss" };
    }
    return { key: "learn-empty", target: null, text: "Cards you're due to review show up here. Make a deck in Flashcards to get started.", doneLabel: "Got it", done: "light", lights: "learn" };
  }

  if (pathname.startsWith("/dashboard/tutor") && !lit.has("tutor")) {
    return present(T.tutorMaterial)
      ? { key: "tutor-material", target: T.tutorMaterial, text: "Jami answers from your own material. Pick something to ask about.", doneLabel: "Got it", done: "light", lights: "tutor" }
      : null;
  }

  if (pathname.startsWith("/dashboard/constellation") && !lit.has("stars")) {
    return present(T.skyAsk)
      ? { key: "stars-ask", target: T.skyAsk, text: "Every goal you finish earns a star. Ask Jami to turn yours into a picture.", doneLabel: "Got it", done: "light", lights: "stars" }
      : null;
  }

  return null;
}
