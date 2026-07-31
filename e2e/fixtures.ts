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
