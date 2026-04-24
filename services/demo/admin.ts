import "server-only";

import type { UserRecord } from "firebase-admin/auth";
import type { Card } from "@/lib/study/cards";
import { mapCardData } from "@/lib/study/cards";
import { normalizeDailyStudyActivity, type DailyStudyActivity } from "@/lib/study/activity";
import { buildDailyReviewQueues, DAILY_REVIEW_STATE_DOC_ID, STUDY_ACTIVITY_SCHEMA_VERSION, STUDY_STATE_META_DOC_ID } from "@/lib/study/daily-review";
import { getStudyDayKey, shiftStudyDayKey } from "@/lib/study/day";
import { normalizeGoal, type Goal } from "@/lib/study/goals";
import { normalizeConstellation, type Constellation } from "@/lib/constellation/constellations";
import { buildPreviewStar, parseStarData, type NormalizedStar } from "@/lib/constellation/stars";
import { getDemoUserId, isDemoModeEnabledServer, requireDemoUserId } from "@/lib/demo/server";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";

type DemoDeck = {
  id: string;
  name: string;
  userId: string;
  createdAt: number;
  colorPreset: "aurora" | "lagoon" | "sunrise" | "mint" | "rose";
  iconPreset: "book" | "cap" | "flask" | "calculator" | "heart" | "star";
};

export type DemoSnapshot = {
  userId: string;
  username: string | null;
  decks: DemoDeck[];
  cards: Card[];
  activity: DailyStudyActivity[];
  goals: Goal[];
  stars: NormalizedStar[];
  activeConstellation: Constellation | null;
};

type DemoSeed = {
  userDoc: Record<string, unknown>;
  decks: DemoDeck[];
  cards: Card[];
  goals: Goal[];
  activity: DailyStudyActivity[];
  constellations: Array<{ id: string; data: Record<string, unknown> }>;
  constellationState: Record<string, unknown>;
  stars: NormalizedStar[];
  studyState: Record<string, Record<string, unknown>>;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DEMO_REFRESH_WINDOW_MS = 60 * 60 * 1000;
const BATCH_LIMIT = 400;
const ACTIVE_CONSTELLATION_ID = "initial";
const ACTIVE_CONSTELLATION_STATE_DOC_ID = "active";

function createDemoDeck(
  userId: string,
  id: string,
  name: string,
  createdAt: number,
  colorPreset: DemoDeck["colorPreset"],
  iconPreset: DemoDeck["iconPreset"]
): DemoDeck {
  return {
    id,
    name,
    userId,
    createdAt,
    colorPreset,
    iconPreset,
  };
}

function createDemoCard(base: Omit<Card, "userId">, userId: string): Card {
  return {
    ...base,
    userId,
  };
}

function createDemoActivity(id: string, data: Omit<DailyStudyActivity, "id">): DailyStudyActivity {
  return {
    id,
    ...data,
  };
}

function normalizeDeckSnapshot(
  id: string,
  data: Record<string, unknown>
): DemoDeck | null {
  const userId = typeof data.userId === "string" ? data.userId : "";
  const name = typeof data.name === "string" ? data.name : "";
  const colorPreset =
    data.colorPreset === "lagoon" ||
    data.colorPreset === "sunrise" ||
    data.colorPreset === "mint" ||
    data.colorPreset === "rose"
      ? data.colorPreset
      : "aurora";
  const iconPreset =
    data.iconPreset === "cap" ||
    data.iconPreset === "flask" ||
    data.iconPreset === "calculator" ||
    data.iconPreset === "heart" ||
    data.iconPreset === "star"
      ? data.iconPreset
      : "book";

  if (!userId || !name) {
    return null;
  }

  return {
    id,
    userId,
    name,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    colorPreset,
    iconPreset,
  };
}

function buildDemoSeed(userId: string, now = Date.now()): DemoSeed {
  const biologyDeck = createDemoDeck(
    userId,
    "demo-biology",
    "Biology",
    now - 22 * DAY_MS,
    "mint",
    "flask"
  );
  const frenchDeck = createDemoDeck(
    userId,
    "demo-french",
    "French",
    now - 18 * DAY_MS,
    "rose",
    "book"
  );
  const algebraDeck = createDemoDeck(
    userId,
    "demo-algebra",
    "Linear Algebra",
    now - 15 * DAY_MS,
    "lagoon",
    "calculator"
  );
  const decks = [biologyDeck, frenchDeck, algebraDeck];

  const cards: Card[] = [
    createDemoCard(
      {
        id: "card-mitochondria",
        deckId: biologyDeck.id,
        front: "What is the main role of the mitochondria?",
        back: "It produces ATP for the cell through aerobic respiration.",
        createdAt: now - 20 * DAY_MS,
        tags: ["cell biology", "energy"],
        dueDate: now - 2 * DAY_MS,
        stability: 2.4,
        difficulty: 8.1,
        fsrsState: 3,
        lapses: 3,
        reps: 8,
        lastReview: now - 4 * DAY_MS,
        scheduledDays: 1,
        elapsedDays: 4,
        interval: 1,
        repetitions: 8,
        easeFactor: 2.5,
        lastStruggleAt: now - DAY_MS,
        lastStruggleStudyDayKey: shiftStudyDayKey(getStudyDayKey(now), -1),
      },
      userId
    ),
    createDemoCard(
      {
        id: "card-osmosis",
        deckId: biologyDeck.id,
        front: "Define osmosis.",
        back: "The movement of water across a partially permeable membrane from a higher to a lower water potential.",
        createdAt: now - 17 * DAY_MS,
        tags: ["cell biology", "definitions"],
        dueDate: now + 2 * DAY_MS,
        stability: 7.5,
        difficulty: 4.6,
        fsrsState: 2,
        lapses: 1,
        reps: 6,
        lastReview: now - 5 * DAY_MS,
        scheduledDays: 5,
        elapsedDays: 5,
        interval: 5,
        repetitions: 6,
        easeFactor: 2.5,
      },
      userId
    ),
    createDemoCard(
      {
        id: "card-atp",
        deckId: biologyDeck.id,
        front: "What does ATP stand for?",
        back: "Adenosine triphosphate.",
        createdAt: now - 14 * DAY_MS,
        tags: ["energy", "definitions"],
        dueDate: now + 10 * DAY_MS,
        stability: 18.5,
        difficulty: 2.6,
        fsrsState: 2,
        lapses: 0,
        reps: 7,
        lastReview: now - 4 * DAY_MS,
        scheduledDays: 14,
        elapsedDays: 4,
        interval: 14,
        repetitions: 7,
        easeFactor: 2.5,
      },
      userId
    ),
    createDemoCard(
      {
        id: "card-bonjour",
        deckId: frenchDeck.id,
        front: "Translate: Bonjour",
        back: "Hello / Good morning",
        createdAt: now - 16 * DAY_MS,
        tags: ["vocabulary", "greetings"],
        dueDate: now + 6 * DAY_MS,
        stability: 12.4,
        difficulty: 2.2,
        fsrsState: 2,
        lapses: 0,
        reps: 9,
        lastReview: now - 3 * DAY_MS,
        scheduledDays: 9,
        elapsedDays: 3,
        interval: 9,
        repetitions: 9,
        easeFactor: 2.5,
      },
      userId
    ),
    createDemoCard(
      {
        id: "card-etre",
        deckId: frenchDeck.id,
        front: "Conjugate 'etre' in the present tense for 'nous'.",
        back: "Nous sommes.",
        createdAt: now - 13 * DAY_MS,
        tags: ["grammar", "verbs"],
        dueDate: now - DAY_MS,
        stability: 3.3,
        difficulty: 7.2,
        fsrsState: 1,
        lapses: 2,
        reps: 5,
        lastReview: now - 3 * DAY_MS,
        scheduledDays: 2,
        elapsedDays: 3,
        interval: 2,
        repetitions: 5,
        easeFactor: 2.5,
      },
      userId
    ),
    createDemoCard(
      {
        id: "card-subjunctive",
        deckId: frenchDeck.id,
        front: "When is the French subjunctive commonly triggered after 'il faut que'?",
        back: "When the clause expresses necessity or obligation.",
        createdAt: now - 8 * DAY_MS,
        tags: ["grammar", "subjunctive"],
        dueDate: now + DAY_MS,
        stability: 4.1,
        difficulty: 6.1,
        fsrsState: 2,
        lapses: 1,
        reps: 4,
        lastReview: now - 2 * DAY_MS,
        scheduledDays: 3,
        elapsedDays: 2,
        interval: 3,
        repetitions: 4,
        easeFactor: 2.5,
      },
      userId
    ),
    createDemoCard(
      {
        id: "card-eigenvector",
        deckId: algebraDeck.id,
        front: "What is an eigenvector?",
        back: "A non-zero vector whose direction is unchanged by a linear transformation, changing only by a scalar factor.",
        createdAt: now - 12 * DAY_MS,
        tags: ["definitions", "matrices"],
        dueDate: now + 3 * DAY_MS,
        stability: 8.4,
        difficulty: 4.2,
        fsrsState: 2,
        lapses: 0,
        reps: 5,
        lastReview: now - 2 * DAY_MS,
        scheduledDays: 5,
        elapsedDays: 2,
        interval: 5,
        repetitions: 5,
        easeFactor: 2.5,
      },
      userId
    ),
    createDemoCard(
      {
        id: "card-determinant",
        deckId: algebraDeck.id,
        front: "What does a determinant of zero tell you about a matrix?",
        back: "The matrix is singular, not invertible, and its columns are linearly dependent.",
        createdAt: now - 11 * DAY_MS,
        tags: ["matrices", "invertibility"],
        dueDate: now - 4 * DAY_MS,
        stability: 2.8,
        difficulty: 7.9,
        fsrsState: 3,
        lapses: 3,
        reps: 6,
        lastReview: now - 7 * DAY_MS,
        scheduledDays: 2,
        elapsedDays: 7,
        interval: 2,
        repetitions: 6,
        easeFactor: 2.5,
        memoryRiskOverrideDayKey: getStudyDayKey(now),
      },
      userId
    ),
    createDemoCard(
      {
        id: "card-rank",
        deckId: algebraDeck.id,
        front: "What is the rank of a matrix?",
        back: "The dimension of the column space, or equivalently the maximum number of linearly independent columns.",
        createdAt: now - 4 * DAY_MS,
        tags: ["matrices", "definitions"],
      },
      userId
    ),
    createDemoCard(
      {
        id: "card-row-echelon",
        deckId: algebraDeck.id,
        front: "Why do we reduce a matrix to row echelon form?",
        back: "To solve systems efficiently, identify pivots, and compute rank or inverse-related information.",
        createdAt: now - 6 * DAY_MS,
        tags: ["methods", "matrices"],
        dueDate: now + DAY_MS,
        stability: 5.2,
        difficulty: 5.8,
        fsrsState: 2,
        lapses: 1,
        reps: 4,
        lastReview: now - 3 * DAY_MS,
        scheduledDays: 4,
        elapsedDays: 3,
        interval: 4,
        repetitions: 4,
        easeFactor: 2.5,
      },
      userId
    ),
    createDemoCard(
      {
        id: "card-membrane",
        deckId: biologyDeck.id,
        front: "What is meant by a selectively permeable membrane?",
        back: "A membrane that allows some substances to pass through more easily than others.",
        createdAt: now - 5 * DAY_MS,
        tags: ["cell biology"],
        dueDate: now + 12 * DAY_MS,
        stability: 16.8,
        difficulty: 3.1,
        fsrsState: 2,
        lapses: 0,
        reps: 5,
        lastReview: now - DAY_MS,
        scheduledDays: 12,
        elapsedDays: 1,
        interval: 12,
        repetitions: 5,
        easeFactor: 2.5,
      },
      userId
    ),
    createDemoCard(
      {
        id: "card-merci",
        deckId: frenchDeck.id,
        front: "Translate: Merci beaucoup",
        back: "Thank you very much.",
        createdAt: now - 3 * DAY_MS,
        tags: ["vocabulary"],
      },
      userId
    ),
  ];

  const reviewCounts = [0, 22, 18, 28, 16, 24, 14, 0, 19, 21, 11, 0, 17, 13];
  const accuracyRatios = [0, 0.86, 0.83, 0.89, 0.81, 0.87, 0.79, 0, 0.82, 0.84, 0.78, 0, 0.8, 0.77];
  const durationMinutes = [0, 18, 14, 23, 12, 19, 11, 0, 16, 17, 10, 0, 13, 9];
  const currentDayKey = getStudyDayKey(now);
  const activity: DailyStudyActivity[] = reviewCounts
    .map((reviewCount, index) => {
      const dayKey = shiftStudyDayKey(currentDayKey, -index);
      const correctCount = Math.round(reviewCount * accuracyRatios[index]);
      const dailyReviewCount = Math.round(reviewCount * 0.7);
      const customReviewCount = reviewCount - dailyReviewCount;
      const dailyCorrectCount = Math.min(correctCount, dailyReviewCount);
      const customCorrectCount = Math.max(0, correctCount - dailyCorrectCount);

      return createDemoActivity(dayKey, {
        dayKey,
        reviewCount,
        correctCount,
        dailyReviewCount,
        dailyCorrectCount,
        customReviewCount,
        customCorrectCount,
        totalDurationMs: durationMinutes[index] * 60_000,
        updatedAt: now - index * DAY_MS,
      });
    })
    .filter((entry) => entry.reviewCount > 0);

  const completedGoal: Goal = normalizeGoal("goal-completed", {
    targetCards: 18,
    targetAccuracy: 0.84,
    deadline: now - 6 * DAY_MS,
    progress: {
      cardsCompleted: 18,
      correctAnswers: 16,
      totalAnswers: 18,
    },
    status: "completed",
    createdAt: now - 10 * DAY_MS,
  });
  const activeGoal: Goal = normalizeGoal("goal-active", {
    targetCards: 20,
    targetAccuracy: 0.85,
    deadline: now + DAY_MS,
    progress: {
      cardsCompleted: 14,
      correctAnswers: 12,
      totalAnswers: 14,
    },
    status: "active",
    createdAt: now - 2 * DAY_MS,
  });
  const stretchGoal: Goal = normalizeGoal("goal-stretch", {
    targetCards: 30,
    targetAccuracy: 0.9,
    deadline: now + 3 * DAY_MS,
    progress: {
      cardsCompleted: 11,
      correctAnswers: 10,
      totalAnswers: 12,
    },
    status: "active",
    createdAt: now - DAY_MS,
  });
  const goals = [activeGoal, stretchGoal, completedGoal];

  const completedStar = buildPreviewStar({
    id: completedGoal.id,
    goalId: completedGoal.id,
    targetCards: completedGoal.targetCards,
    targetAccuracy: completedGoal.targetAccuracy,
    completedGoalsCount: 1,
    constellationId: ACTIVE_CONSTELLATION_ID,
    createdAt: completedGoal.deadline,
    position: { x: 46, y: 44 },
  });
  const stars = [completedStar];

  const { requiredCards, optionalCards } = buildDailyReviewQueues(cards, now);
  const completedRequiredCardIds = requiredCards.length > 0 ? [requiredCards[0].id] : [];
  const studyState = {
    [STUDY_STATE_META_DOC_ID]: {
      activitySchemaVersion: STUDY_ACTIVITY_SCHEMA_VERSION,
      updatedAt: now,
    },
    [DAILY_REVIEW_STATE_DOC_ID]: {
      studyDayKey: currentDayKey,
      generatedAt: now,
      requiredCardIds: requiredCards.map((card) => card.id),
      optionalCardIds: optionalCards.map((card) => card.id),
      completedRequiredCardIds,
      completedOptionalCardIds: [],
      parkedRequiredCardIds: [],
      requiredRetryCounts: {},
      updatedAt: now,
    },
  };

  return {
    userDoc: {
      username: "Jami Demo",
      createdAt: now - 30 * DAY_MS,
      updatedAt: now,
      resetAt: now,
      demoMode: true,
    },
    decks,
    cards,
    goals,
    activity,
    constellations: [
      {
        id: ACTIVE_CONSTELLATION_ID,
        data: {
          name: "Demo Constellation",
          status: "active",
          maxStars: 40,
          starCount: stars.length,
          createdAt: now - 20 * DAY_MS,
        },
      },
    ],
    constellationState: {
      activeConstellationId: ACTIVE_CONSTELLATION_ID,
      updatedAt: now,
    },
    stars,
    studyState,
  };
}

async function deleteDocsByRefs(
  refs: Array<FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentReference>
) {
  for (let index = 0; index < refs.length; index += BATCH_LIMIT) {
    const batch = getAdminDb().batch();
    refs.slice(index, index + BATCH_LIMIT).forEach((ref) => batch.delete("ref" in ref ? ref.ref : ref));
    await batch.commit();
  }
}

async function ensureDemoAuthUser(userId: string) {
  const adminAuth = getAdminAuth();
  let userRecord: UserRecord;

  try {
    userRecord = await adminAuth.getUser(userId);
  } catch {
    userRecord = await adminAuth.createUser({
      uid: userId,
      displayName: "Jami Demo",
    });
  }

  await adminAuth.updateUser(userId, {
    displayName: "Jami Demo",
  });
  await adminAuth.setCustomUserClaims(userId, {
    demo: true,
  });

  return userRecord;
}

async function resetTopLevelDecks(userId: string) {
  const adminDb = getAdminDb();
  const [ownedByUserId, ownedByLegacyUid] = await Promise.all([
    adminDb.collection("decks").where("userId", "==", userId).get(),
    adminDb.collection("decks").where("uid", "==", userId).get(),
  ]);
  const refs = [...ownedByUserId.docs, ...ownedByLegacyUid.docs].map((docSnapshot) => docSnapshot.ref);
  await deleteDocsByRefs(refs);
}

async function resetTopLevelCards(userId: string) {
  const adminDb = getAdminDb();
  const ownedCards = await adminDb.collection("cards").where("userId", "==", userId).get();
  await deleteDocsByRefs(ownedCards.docs.map((docSnapshot) => docSnapshot.ref));
}

async function resetUserSubcollections(userId: string) {
  const adminDb = getAdminDb();
  const userRef = adminDb.collection("users").doc(userId);
  const collectionNames = [
    "goals",
    "stars",
    "studyActivity",
    "studyState",
    "constellations",
    "constellationState",
    "notificationPreferences",
    "pushSubscriptions",
  ];

  for (const collectionName of collectionNames) {
    const snapshot = await userRef.collection(collectionName).get();
    await deleteDocsByRefs(snapshot.docs.map((docSnapshot) => docSnapshot.ref));
  }

  const userDecksSnapshot = await userRef.collection("decks").get();
  for (const deckDoc of userDecksSnapshot.docs) {
    const attemptsSnapshot = await deckDoc.ref.collection("attempts").get();
    await deleteDocsByRefs(attemptsSnapshot.docs.map((attemptDoc) => attemptDoc.ref));
  }
  await deleteDocsByRefs(userDecksSnapshot.docs.map((docSnapshot) => docSnapshot.ref));
}

export async function issueDemoCustomToken() {
  if (!isDemoModeEnabledServer()) {
    throw new Error("Demo mode is disabled.");
  }

  const demoUserId = requireDemoUserId();
  await ensureFreshDemoWorkspace();
  return getAdminAuth().createCustomToken(demoUserId, { demo: true });
}

export async function resetDemoWorkspace(now = Date.now()) {
  if (!isDemoModeEnabledServer()) {
    throw new Error("Demo mode is disabled.");
  }

  const adminDb = getAdminDb();
  const demoUserId = requireDemoUserId();
  const seed = buildDemoSeed(demoUserId, now);

  await ensureDemoAuthUser(demoUserId);
  await Promise.all([
    resetTopLevelDecks(demoUserId),
    resetTopLevelCards(demoUserId),
    resetUserSubcollections(demoUserId),
  ]);

  await adminDb.collection("users").doc(demoUserId).set(seed.userDoc, { merge: false });

  for (const deck of seed.decks) {
    await adminDb.collection("decks").doc(deck.id).set(deck);
  }

  for (const card of seed.cards) {
    const { id, ...data } = card;
    await adminDb.collection("cards").doc(id).set(data);
  }

  for (const goal of seed.goals) {
    const { id, ...data } = goal;
    await adminDb.collection("users").doc(demoUserId).collection("goals").doc(id).set(data);
  }

  for (const activity of seed.activity) {
    const { id, ...data } = activity;
    await adminDb.collection("users").doc(demoUserId).collection("studyActivity").doc(id).set(data);
  }

  for (const [docId, data] of Object.entries(seed.studyState)) {
    await adminDb.collection("users").doc(demoUserId).collection("studyState").doc(docId).set(data);
  }

  for (const constellation of seed.constellations) {
    await adminDb
      .collection("users")
      .doc(demoUserId)
      .collection("constellations")
      .doc(constellation.id)
      .set(constellation.data);
  }

  await adminDb
    .collection("users")
    .doc(demoUserId)
    .collection("constellationState")
    .doc(ACTIVE_CONSTELLATION_STATE_DOC_ID)
    .set(seed.constellationState);

  for (const star of seed.stars) {
    const { id, needsBackfill, isLegacyStar, ...data } = star;
    void needsBackfill;
    void isLegacyStar;
    await adminDb.collection("users").doc(demoUserId).collection("stars").doc(id).set(data);
  }

  await adminDb
    .collection("users")
    .doc(demoUserId)
    .collection("notificationPreferences")
    .doc("config")
    .set({
      enabled: false,
      mode: "smart",
      updatedAt: now,
    });

  return {
    ok: true,
    resetAt: now,
    userId: demoUserId,
    counts: {
      decks: seed.decks.length,
      cards: seed.cards.length,
      goals: seed.goals.length,
      stars: seed.stars.length,
      activityDays: seed.activity.length,
    },
  };
}

export async function ensureFreshDemoWorkspace(now = Date.now()) {
  if (!isDemoModeEnabledServer()) {
    throw new Error("Demo mode is disabled.");
  }

  const adminDb = getAdminDb();
  const demoUserId = requireDemoUserId();

  await ensureDemoAuthUser(demoUserId);

  const userSnapshot = await adminDb.collection("users").doc(demoUserId).get();
  const userData = userSnapshot.data();
  const resetAt =
    typeof userData?.resetAt === "number" && Number.isFinite(userData.resetAt)
      ? userData.resetAt
      : null;

  if (resetAt === null || now - resetAt >= DEMO_REFRESH_WINDOW_MS) {
    await resetDemoWorkspace(now);
    return true;
  }

  return false;
}

export async function loadDemoSnapshot(): Promise<DemoSnapshot | null> {
  if (!isDemoModeEnabledServer()) {
    return null;
  }

  const demoUserId = getDemoUserId();
  if (!demoUserId) {
    return null;
  }

  const adminDb = getAdminDb();
  await ensureFreshDemoWorkspace();
  const [userSnapshot, deckSnapshot, cardSnapshot, activitySnapshot, goalsSnapshot, starsSnapshot, constellationsSnapshot, constellationStateSnapshot] =
    await Promise.all([
      adminDb.collection("users").doc(demoUserId).get(),
      adminDb.collection("decks").where("userId", "==", demoUserId).get(),
      adminDb.collection("cards").where("userId", "==", demoUserId).get(),
      adminDb.collection("users").doc(demoUserId).collection("studyActivity").get(),
      adminDb.collection("users").doc(demoUserId).collection("goals").get(),
      adminDb.collection("users").doc(demoUserId).collection("stars").get(),
      adminDb.collection("users").doc(demoUserId).collection("constellations").get(),
      adminDb.collection("users").doc(demoUserId).collection("constellationState").doc(ACTIVE_CONSTELLATION_STATE_DOC_ID).get(),
    ]);

  if (!userSnapshot.exists || deckSnapshot.empty || cardSnapshot.empty) {
    await resetDemoWorkspace();
    return loadDemoSnapshot();
  }

  const username = userSnapshot.exists
    ? typeof userSnapshot.data()?.username === "string"
      ? userSnapshot.data()!.username
      : null
    : null;
  const decks = deckSnapshot.docs
    .map((docSnapshot) => normalizeDeckSnapshot(docSnapshot.id, docSnapshot.data()))
    .filter((deck): deck is DemoDeck => deck !== null)
    .sort((left, right) => left.createdAt - right.createdAt);
  const cards = cardSnapshot.docs
    .map((docSnapshot) => mapCardData(docSnapshot.id, docSnapshot.data() as Record<string, unknown>))
    .sort((left, right) => left.createdAt - right.createdAt);
  const activity = activitySnapshot.docs
    .map((docSnapshot) =>
      normalizeDailyStudyActivity(
        docSnapshot.id,
        docSnapshot.data() as Record<string, unknown>
      )
    )
    .sort((left, right) => left.dayKey.localeCompare(right.dayKey));
  const goals = goalsSnapshot.docs
    .map((docSnapshot) => normalizeGoal(docSnapshot.id, docSnapshot.data() as Record<string, unknown>))
    .sort((left, right) => right.createdAt - left.createdAt);
  const stars = starsSnapshot.docs
    .map((docSnapshot) => parseStarData(docSnapshot.id, docSnapshot.data() as Record<string, unknown>))
    .sort((left, right) => left.createdAt - right.createdAt);
  const constellations = constellationsSnapshot.docs.map((docSnapshot) =>
    normalizeConstellation(docSnapshot.id, docSnapshot.data() as Record<string, unknown>)
  );
  const activeConstellationId =
    constellationStateSnapshot.exists &&
    typeof constellationStateSnapshot.data()?.activeConstellationId === "string"
      ? constellationStateSnapshot.data()!.activeConstellationId
      : ACTIVE_CONSTELLATION_ID;
  const activeConstellation =
    constellations.find((constellation) => constellation.id === activeConstellationId) ?? null;

  return {
    userId: demoUserId,
    username,
    decks,
    cards,
    activity,
    goals,
    stars,
    activeConstellation,
  };
}

export function isDemoUid(uid: string) {
  const demoUserId = getDemoUserId();
  return !!demoUserId && uid === demoUserId;
}
