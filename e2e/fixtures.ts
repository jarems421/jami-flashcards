export const E2E_PROJECT_ID = "demo-jami-browser";
export const E2E_USER_EMAIL = "notebook-smoke@jami.test";
export const E2E_USER_PASSWORD = "notebook-smoke-password";
export const E2E_FOLDER_ID = "e2e-folder";
export const E2E_NOTEBOOK_ID = "e2e-notebook";
export const E2E_PAGE_IDS = ["e2e-page-1", "e2e-page-2"] as const;
export const E2E_TEXT_MARKER = "Playwright notebook text survives reload.";

export const E2E_DECK_ID = "e2e-deck";
export const E2E_DECK_NAME = "Browser smoke deck";
/** Due cards the desktop review flow grades to completion. */
export const E2E_CARDS = [
  { id: "e2e-card-1", front: "Smoke card one front", back: "Smoke card one back" },
  { id: "e2e-card-2", front: "Smoke card two front", back: "Smoke card two back" },
] as const;

/**
 * The phone layout check needs its own deck. The desktop flow grades its deck
 * to empty, so sharing one would make the suite order-dependent.
 */
export const E2E_PHONE_DECK_ID = "e2e-deck-phone";
export const E2E_PHONE_DECK_NAME = "Browser smoke phone deck";
export const E2E_PHONE_CARDS = [
  {
    id: "e2e-phone-card-1",
    front: "Phone card one front",
    back: "Phone card one back",
  },
] as const;

/**
 * The offline replay check grades a card with the browser offline, so it needs
 * a deck the other flows never touch: a shared deck would make the suite
 * order-dependent, and a queued review that never drains would leak into them.
 */
export const E2E_OFFLINE_DECK_ID = "e2e-deck-offline";
export const E2E_OFFLINE_DECK_NAME = "Browser smoke offline deck";
export const E2E_OFFLINE_CARDS = [
  {
    id: "e2e-offline-card-1",
    front: "Offline card one front",
    back: "Offline card one back",
  },
] as const;

/**
 * A deck for the study modes, kept separate so the mode checks can grade cards
 * without making the other flows order-dependent.
 *
 * The answers are chosen to exercise each mode honestly: one long enough to
 * carry a blank, one short factual answer, one number with a unit.
 */
export const E2E_MODES_DECK_ID = "e2e-deck-modes";
export const E2E_MODES_DECK_NAME = "Browser smoke modes deck";
/*
 * `mcqDistractors` stands in for what Jami writes during preparation, which the
 * browser suite has no provider to produce. Multiple choice refuses to build a
 * question without them -- that is the point of the mode now -- so a fixture
 * deck with none would exercise the refusal and nothing else. Card three has
 * none on purpose: a numeric answer makes its own wrong options.
 */
export const E2E_MODES_CARDS = [
  {
    id: "e2e-modes-card-1",
    front: "Which organelle releases energy in a cell?",
    back: "The mitochondrion releases usable energy inside every cell",
    studySettings: {
      mcqDistractors: [
        "The nucleus stores the cell's genetic instructions",
        "The ribosome assembles proteins from amino acids",
        "The chloroplast captures light for photosynthesis",
      ],
    },
  },
  {
    id: "e2e-modes-card-2",
    front: "What is the powerhouse molecule of the cell?",
    back: "Adenosine triphosphate",
    studySettings: {
      mcqDistractors: [
        "Adenosine diphosphate",
        "Deoxyribonucleic acid",
        "Pyruvic acid",
      ],
    },
  },
  {
    id: "e2e-modes-card-3",
    front: "What is the acceleration due to gravity on Earth?",
    back: "9.8 m/s",
  },
  {
    id: "e2e-modes-card-4",
    front: "Which structure builds proteins?",
    back: "The ribosome assembles amino acids into proteins",
    studySettings: {
      mcqDistractors: [
        "The mitochondrion releases energy from glucose",
        "The lysosome breaks down worn-out cell parts",
        "The vacuole stores water and keeps the cell firm",
      ],
    },
  },
] as const;

/**
 * Material the browse screens list. These smokes read and filter rather than
 * mutate, so the data can be shared without making the suite order-dependent.
 */
export const E2E_TOPIC = {
  id: "e2e-topic",
  name: "Browser smoke topic",
};
export const E2E_SOURCE = {
  id: "e2e-source",
  title: "Browser smoke source",
};
export const E2E_GOAL = {
  id: "e2e-goal",
  name: "Browser smoke goal",
};
