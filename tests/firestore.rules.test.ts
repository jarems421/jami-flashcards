import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { beforeAll, afterAll, afterEach, describe, it } from "vitest";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const rules = readFileSync(path.join(rootDir, "firestore.rules"), "utf8");

const ALICE = "alice";
const BOB = "bob";
const ALICE_DECK_ID = "deck-alice";
const BOB_DECK_ID = "deck-bob";
const LEGACY_ALICE_DECK_ID = "deck-legacy-alice";

let testEnv: RulesTestEnvironment;

async function seedData() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();

    await Promise.all([
      setDoc(doc(adminDb, "users", ALICE), { createdAt: 1 }),
      setDoc(doc(adminDb, "users", BOB), { createdAt: 1 }),
      setDoc(doc(adminDb, "decks", ALICE_DECK_ID), {
        name: "Alice deck",
        userId: ALICE,
        createdAt: 1,
      }),
      setDoc(doc(adminDb, "decks", BOB_DECK_ID), {
        name: "Bob deck",
        uid: BOB,
        createdAt: 1,
      }),
      setDoc(doc(adminDb, "decks", LEGACY_ALICE_DECK_ID), {
        name: "Legacy Alice deck",
        uid: ALICE,
        createdAt: 1,
      }),
      setDoc(doc(adminDb, "cards", "alice-card"), {
        deckId: ALICE_DECK_ID,
        userId: ALICE,
        front: "Question",
        back: "Answer",
        tags: ["biology"],
        createdAt: 1,
        dueDate: 100,
        stability: 2,
        difficulty: 5,
        fsrsState: 2,
        lapses: 1,
        reps: 2,
      }),
    ]);
  });
}

describe("Firestore security rules", () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-jami-flashcards",
      firestore: { rules },
    });
  });

  afterEach(async () => {
    await testEnv.clearFirestore();
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  it("blocks unauthenticated reads to private data", async () => {
    await seedData();

    const guestDb = testEnv.unauthenticatedContext().firestore();

    await assertFails(getDoc(doc(guestDb, "decks", ALICE_DECK_ID)));
    await assertFails(getDoc(doc(guestDb, "users", ALICE)));
  });

  it("keeps onboarding progress private and blocks demo writes", async () => {
    const aliceDb = testEnv.authenticatedContext(ALICE).firestore();
    const bobDb = testEnv.authenticatedContext(BOB).firestore();
    const guestDb = testEnv.unauthenticatedContext().firestore();
    const demoDb = testEnv
      .authenticatedContext("demo-user", { demo: true })
      .firestore();

    const aliceProgress = doc(aliceDb, "users", ALICE, "onboarding", "release-1");
    const demoProgress = doc(
      demoDb,
      "users",
      "demo-user",
      "onboarding",
      "release-1"
    );

    await assertSucceeds(
      setDoc(aliceProgress, { status: "active", completedMissionIds: [] })
    );
    await assertSucceeds(getDoc(aliceProgress));
    await assertSucceeds(
      updateDoc(aliceProgress, { completedMissionIds: ["create-folder"] })
    );

    await assertFails(
      getDoc(doc(bobDb, "users", ALICE, "onboarding", "release-1"))
    );
    await assertFails(
      getDoc(doc(guestDb, "users", ALICE, "onboarding", "release-1"))
    );
    await assertFails(setDoc(demoProgress, { status: "active" }));
    await assertSucceeds(deleteDoc(aliceProgress));
  });

  it("allows owners to read decks stored with either userId or legacy uid", async () => {
    await seedData();

    const aliceDb = testEnv.authenticatedContext(ALICE).firestore();
    const bobDb = testEnv.authenticatedContext(BOB).firestore();

    await assertSucceeds(getDoc(doc(aliceDb, "decks", ALICE_DECK_ID)));
    await assertSucceeds(getDoc(doc(aliceDb, "decks", LEGACY_ALICE_DECK_ID)));
    await assertFails(getDoc(doc(bobDb, "decks", LEGACY_ALICE_DECK_ID)));
  });

  it("allows owner deck list queries by current userId and legacy uid", async () => {
    await seedData();

    const aliceDb = testEnv.authenticatedContext(ALICE).firestore();

    await assertSucceeds(
      getDocs(query(collection(aliceDb, "decks"), where("userId", "==", ALICE)))
    );
    await assertSucceeds(
      getDocs(query(collection(aliceDb, "decks"), where("uid", "==", ALICE)))
    );
  });

  it("allows creating only self-owned top-level decks", async () => {
    const aliceDb = testEnv.authenticatedContext(ALICE).firestore();

    await assertSucceeds(
      setDoc(doc(aliceDb, "decks", "deck-new"), {
        name: "New deck",
        userId: ALICE,
        createdAt: 1,
      })
    );

    await assertFails(
      setDoc(doc(aliceDb, "decks", "deck-for-bob"), {
        name: "Wrong owner",
        userId: BOB,
        createdAt: 1,
      })
    );
  });

  it("requires card creation to reference an owned deck", async () => {
    await seedData();

    const aliceDb = testEnv.authenticatedContext(ALICE).firestore();

    await assertSucceeds(
      setDoc(doc(aliceDb, "cards", "card-1"), {
        deckId: ALICE_DECK_ID,
        userId: ALICE,
        front: "Question",
        back: "Answer",
        createdAt: 1,
      })
    );

    await assertFails(
      setDoc(doc(aliceDb, "cards", "card-2"), {
        deckId: BOB_DECK_ID,
        userId: ALICE,
        front: "Wrong deck",
        back: "Answer",
        createdAt: 1,
      })
    );
  });

  it("restricts nested user deck metadata to the caller and matching owned deck", async () => {
    await seedData();

    const aliceDb = testEnv.authenticatedContext(ALICE).firestore();
    const bobDb = testEnv.authenticatedContext(BOB).firestore();

    await assertSucceeds(
      setDoc(doc(aliceDb, "users", ALICE, "decks", ALICE_DECK_ID), {
        deckId: ALICE_DECK_ID,
        updatedAt: 1,
      })
    );

    await assertFails(
      setDoc(doc(aliceDb, "users", ALICE, "decks", ALICE_DECK_ID), {
        deckId: BOB_DECK_ID,
        updatedAt: 1,
      })
    );

    await assertFails(
      setDoc(doc(bobDb, "users", ALICE, "decks", ALICE_DECK_ID), {
        deckId: ALICE_DECK_ID,
        updatedAt: 1,
      })
    );
  });

  it("restricts attempt writes to the caller and the matching owned deck", async () => {
    await seedData();

    const aliceDb = testEnv.authenticatedContext(ALICE).firestore();
    const bobDb = testEnv.authenticatedContext(BOB).firestore();

    await assertSucceeds(
      setDoc(doc(aliceDb, "users", ALICE, "decks", ALICE_DECK_ID, "attempts", "attempt-1"), {
        deckId: ALICE_DECK_ID,
        startedAt: 1,
      })
    );

    await assertFails(
      setDoc(doc(aliceDb, "users", ALICE, "decks", ALICE_DECK_ID, "attempts", "attempt-2"), {
        deckId: BOB_DECK_ID,
        startedAt: 1,
      })
    );

    await assertFails(
      setDoc(doc(bobDb, "users", ALICE, "decks", ALICE_DECK_ID, "attempts", "attempt-3"), {
        deckId: ALICE_DECK_ID,
        startedAt: 1,
      })
    );
  });

  it("restricts notification preference docs to the caller", async () => {
    await seedData();

    const aliceDb = testEnv.authenticatedContext(ALICE).firestore();
    const bobDb = testEnv.authenticatedContext(BOB).firestore();

    await assertSucceeds(
      setDoc(doc(aliceDb, "users", ALICE, "notificationPreferences", "config"), {
        enabled: true,
        mode: "smart",
        updatedAt: 1,
      })
    );

    await assertSucceeds(
      getDoc(doc(aliceDb, "users", ALICE, "notificationPreferences", "config"))
    );

    await assertFails(
      getDoc(doc(bobDb, "users", ALICE, "notificationPreferences", "config"))
    );

    await assertFails(
      setDoc(doc(bobDb, "users", ALICE, "notificationPreferences", "config"), {
        enabled: true,
        mode: "smart",
        updatedAt: 1,
      })
    );
  });

  it("restricts push subscriptions to the caller", async () => {
    await seedData();

    const aliceDb = testEnv.authenticatedContext(ALICE).firestore();
    const bobDb = testEnv.authenticatedContext(BOB).firestore();

    await assertSucceeds(
      setDoc(doc(aliceDb, "users", ALICE, "pushSubscriptions", "device-1"), {
        endpoint: "https://example.test/subscription",
        keys: {
          auth: "auth",
          p256dh: "p256dh",
        },
        updatedAt: 1,
      })
    );

    await assertSucceeds(
      getDoc(doc(aliceDb, "users", ALICE, "pushSubscriptions", "device-1"))
    );

    await assertFails(
      getDoc(doc(bobDb, "users", ALICE, "pushSubscriptions", "device-1"))
    );

    await assertFails(
      setDoc(doc(bobDb, "users", ALICE, "pushSubscriptions", "device-1"), {
        endpoint: "https://example.test/subscription",
        keys: {
          auth: "auth",
          p256dh: "p256dh",
        },
        updatedAt: 1,
      })
    );
  });

  it("restricts active study sessions to the caller", async () => {
    await seedData();

    const aliceDb = testEnv.authenticatedContext(ALICE).firestore();
    const bobDb = testEnv.authenticatedContext(BOB).firestore();
    const demoDb = testEnv.authenticatedContext(ALICE, { demo: true }).firestore();
    const activeSessionData = {
      version: 1,
      userId: ALICE,
      studyDayKey: "2026-05-02",
      kind: "daily-required",
      status: "active",
      cardIds: ["alice-card"],
      index: 0,
      stats: {
        reviewedCards: 0,
        correctAnswers: 0,
        completedGoals: 0,
        starsEarned: 0,
        ratings: { again: 0, hard: 0, good: 0, easy: 0 },
      },
      selectedDeckIds: [],
      selectedTags: [],
      startedAt: 1,
      savedAt: 1,
    };

    await assertSucceeds(
      setDoc(doc(aliceDb, "users", ALICE, "studyState", "activeSession"), activeSessionData)
    );

    await assertSucceeds(
      getDoc(doc(aliceDb, "users", ALICE, "studyState", "activeSession"))
    );

    await assertFails(
      getDoc(doc(bobDb, "users", ALICE, "studyState", "activeSession"))
    );

    await assertFails(
      setDoc(doc(bobDb, "users", ALICE, "studyState", "activeSession"), activeSessionData)
    );

    await assertSucceeds(
      setDoc(doc(demoDb, "users", ALICE, "studyState", "activeSession"), {
        ...activeSessionData,
        status: "ended",
        endReason: "user-ended",
        endedAt: 2,
        savedAt: 2,
      })
    );
  });

  it("restricts new learning-loop collections to the caller", async () => {
    await seedData();

    const aliceDb = testEnv.authenticatedContext(ALICE).firestore();
    const bobDb = testEnv.authenticatedContext(BOB).firestore();
    const demoDb = testEnv.authenticatedContext(ALICE, { demo: true }).firestore();

    const topicRef = doc(aliceDb, "users", ALICE, "topics", "topic-1");
    await assertSucceeds(
      setDoc(topicRef, {
        name: "Eigenvalues",
        slug: "eigenvalues",
        subject: "Linear Algebra",
        status: "active",
        createdBy: "user",
        createdAt: 1,
        updatedAt: 1,
      })
    );
    await assertSucceeds(getDoc(topicRef));
    await assertFails(getDoc(doc(bobDb, "users", ALICE, "topics", "topic-1")));

    await assertFails(
      setDoc(doc(aliceDb, "users", ALICE, "questions", "question-1"), {
        questionText: "Find the eigenvalues.",
        topicIds: ["topic-1"],
        sourceType: "manual",
        origin: "user-authored",
        contentStatus: "approved",
        createdAt: 1,
        updatedAt: 1,
      })
    );

    await assertFails(
      setDoc(doc(aliceDb, "users", ALICE, "attempts", "attempt-1"), {
        questionId: "question-1",
        userAnswer: "lambda = 2",
        isCorrect: true,
        confidence: 4,
        tutorUsed: false,
        mistakeLabels: [],
        createdAt: 1,
      })
    );

    await assertSucceeds(
      setDoc(doc(aliceDb, "users", ALICE, "masteryEvents", "event-1"), {
        topicId: "topic-1",
        sourceType: "manual",
        sourceId: "page-1",
        weight: "high",
        scoreDelta: 4,
        reason: "Notebook page reviewed",
        algorithmVersion: "mvp-test",
        createdAt: 1,
      })
    );

    await assertSucceeds(
      setDoc(doc(aliceDb, "users", ALICE, "generatedContentDrafts", "draft-1"), {
        kind: "flashcard",
        title: "Eigenvalue definition",
        front: "What is an eigenvalue?",
        back: "A scalar lambda where Av = lambda v.",
        topicIds: ["topic-1"],
        origin: "ai-assisted",
        contentStatus: "draft",
        createdAt: 1,
        updatedAt: 1,
      })
    );

    await assertSucceeds(
      setDoc(doc(aliceDb, "users", ALICE, "sources", "source-1"), {
        title: "Lecture 5 notes",
        type: "pasted_text",
        subject: "Linear Algebra",
        topicIds: ["topic-1"],
        contentText: "Eigenvalues are scalars where Av = lambda v.",
        status: "active",
        createdBy: ALICE,
        createdAt: 1,
        updatedAt: 1,
      })
    );

    await assertSucceeds(getDoc(doc(aliceDb, "users", ALICE, "sources", "source-1")));
    await assertFails(getDoc(doc(bobDb, "users", ALICE, "sources", "source-1")));

    await assertSucceeds(
      setDoc(doc(aliceDb, "users", ALICE, "studyFolders", "folder-linear-algebra"), {
        name: "Linear Algebra",
        description: "Decks, sources, and notebook work for eigenvalues.",
        subject: "Maths",
        topicIds: ["topic-1"],
        archived: false,
        createdAt: 1,
        updatedAt: 1,
      })
    );

    await assertSucceeds(
      getDoc(doc(aliceDb, "users", ALICE, "studyFolders", "folder-linear-algebra"))
    );
    await assertSucceeds(getDocs(collection(aliceDb, "users", ALICE, "studyFolders")));
    await assertFails(
      getDoc(doc(bobDb, "users", ALICE, "studyFolders", "folder-linear-algebra"))
    );

    await assertSucceeds(
      setDoc(doc(aliceDb, "users", ALICE, "notebooks", "notebook-1"), {
        folderId: "folder-linear-algebra",
        title: "Eigenvalues practice",
        type: "practice",
        topicIds: ["topic-1"],
        sourceIds: ["source-1"],
        archived: false,
        createdAt: 1,
        updatedAt: 1,
      })
    );
    await assertSucceeds(
      setDoc(doc(aliceDb, "users", ALICE, "notebookPages", "page-1"), {
        notebookId: "notebook-1",
        folderId: "folder-linear-algebra",
        pageNumber: 1,
        pageType: "question",
        typedContent: "I start by finding the characteristic polynomial.",
        createdAt: 1,
        updatedAt: 1,
      })
    );
    await assertSucceeds(getDoc(doc(aliceDb, "users", ALICE, "notebooks", "notebook-1")));
    await assertSucceeds(getDoc(doc(aliceDb, "users", ALICE, "notebookPages", "page-1")));
    await assertFails(getDoc(doc(bobDb, "users", ALICE, "notebooks", "notebook-1")));
    await assertFails(getDoc(doc(bobDb, "users", ALICE, "notebookPages", "page-1")));
    await assertSucceeds(
      setDoc(doc(aliceDb, "users", ALICE, "notebookPageInk", "page-1"), {
        notebookId: "notebook-1",
        inkData: { version: 2, format: "js-draw-svg", svg: "<svg></svg>" },
        contentRevision: 1,
        updatedAt: 1,
      })
    );
    await assertSucceeds(
      getDoc(doc(aliceDb, "users", ALICE, "notebookPageInk", "page-1"))
    );
    // Ink is a student's handwriting; it must be no more reachable than the
    // page it was split out of.
    await assertFails(
      getDoc(doc(bobDb, "users", ALICE, "notebookPageInk", "page-1"))
    );
    await assertFails(
      setDoc(doc(bobDb, "users", ALICE, "notebookPageInk", "page-1"), {
        notebookId: "notebook-1",
        contentRevision: 2,
        updatedAt: 2,
      })
    );
    await assertSucceeds(
      setDoc(doc(aliceDb, "users", ALICE, "notebookFiles", "file-1"), {
        notebookId: "notebook-1",
        folderId: "folder-linear-algebra",
        fileName: "biology-paper.pdf",
        fileType: "application/pdf",
        storagePath: "users/alice/notebookFiles/notebook-1/file-1-biology-paper.pdf",
        sizeBytes: 1024,
        uploadedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      })
    );
    await assertSucceeds(getDoc(doc(aliceDb, "users", ALICE, "notebookFiles", "file-1")));
    await assertFails(getDoc(doc(bobDb, "users", ALICE, "notebookFiles", "file-1")));

    await assertSucceeds(
      setDoc(doc(aliceDb, "users", ALICE, "practiceSets", "set-1"), {
        folderId: "folder-linear-algebra",
        title: "Eigenvalues drill",
        type: "manual",
        topicIds: ["topic-1"],
        questionIds: [],
        archived: false,
        createdAt: 1,
        updatedAt: 1,
      })
    );
    await assertSucceeds(
      setDoc(doc(aliceDb, "users", ALICE, "pastPapers", "paper-1"), {
        folderId: "folder-linear-algebra",
        title: "2024 Linear Algebra paper",
        origin: "uploaded",
        status: "ready",
        questions: [],
        totalMarks: 0,
        markScheme: { kind: "missing", label: "No guide", notice: "", items: [] },
        createdAt: 1,
        updatedAt: 1,
      })
    );
    await assertSucceeds(getDoc(doc(aliceDb, "users", ALICE, "practiceSets", "set-1")));
    await assertSucceeds(getDoc(doc(aliceDb, "users", ALICE, "pastPapers", "paper-1")));
    await assertFails(
      setDoc(doc(aliceDb, "users", ALICE, "practicePaperAttempts", "attempt-1"), {
        paperId: "paper-1",
        status: "in_progress",
        createdAt: 1,
        updatedAt: 1,
      })
    );
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users", ALICE, "practicePaperAttempts", "attempt-1"), {
        paperId: "paper-1",
        status: "in_progress",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await assertSucceeds(getDoc(doc(aliceDb, "users", ALICE, "practicePaperAttempts", "attempt-1")));
    await assertFails(getDoc(doc(bobDb, "users", ALICE, "practicePaperAttempts", "attempt-1")));
    await assertFails(getDoc(doc(bobDb, "users", ALICE, "practiceSets", "set-1")));
    await assertFails(getDoc(doc(bobDb, "users", ALICE, "pastPapers", "paper-1")));

    await assertSucceeds(
      setDoc(doc(aliceDb, "users", ALICE, "tutorThreads", "thread-1"), {
        contextType: "notebook",
        contextId: "notebook-1",
        title: "Notebook support",
        createdAt: 1,
        updatedAt: 1,
      })
    );

    await assertSucceeds(
      setDoc(doc(aliceDb, "users", ALICE, "tutorMessages", "message-1"), {
        threadId: "thread-1",
        role: "model",
        text: "Use this thread for source or future notebook Tutor context.",
        createdAt: 1,
      })
    );

    await assertFails(
      setDoc(doc(aliceDb, "users", ALICE, "assistantThreads", "assistant-thread-1"), {
        title: "Explain this page",
        surface: "notebook",
        contextKey: "notebook:notebook-1:page:page-1",
        contextLabel: "Eigenvalues practice · Page 1",
        context: {
          surface: "notebook",
          notebookId: "notebook-1",
          pageId: "page-1",
        },
        createdAt: 1,
        updatedAt: 1,
      })
    );
    await assertFails(
      setDoc(doc(aliceDb, "users", ALICE, "assistantMessages", "assistant-message-1"), {
        threadId: "assistant-thread-1",
        role: "assistant",
        text: "Start with the characteristic polynomial.",
        createdAt: 1,
      })
    );
    // Seed server-owned history so the owner can still read it.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, "users", ALICE, "assistantThreads", "assistant-thread-1"), {
        title: "Explain this page",
        surface: "notebook",
        contextKey: "notebook:notebook-1:page:page-1",
        contextLabel: "Eigenvalues practice - Page 1",
        context: { surface: "notebook", notebookId: "notebook-1", pageId: "page-1" },
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await assertSucceeds(
      getDoc(
        doc(aliceDb, "users", ALICE, "assistantThreads", "assistant-thread-1")
      )
    );
    await assertFails(
      getDoc(doc(bobDb, "users", ALICE, "assistantThreads", "assistant-thread-1"))
    );
    await assertFails(
      setDoc(doc(bobDb, "users", ALICE, "assistantMessages", "assistant-message-2"), {
        threadId: "assistant-thread-1",
        role: "user",
        text: "Wrong user",
        createdAt: 2,
      })
    );

    await assertFails(
      setDoc(doc(bobDb, "users", ALICE, "attempts", "attempt-2"), {
        questionId: "question-1",
        userAnswer: "wrong user",
        isCorrect: false,
        confidence: 1,
        tutorUsed: false,
        mistakeLabels: [],
        createdAt: 1,
      })
    );

    await assertFails(
      setDoc(doc(demoDb, "users", ALICE, "topics", "demo-topic"), {
        name: "Demo topic",
        slug: "demo-topic",
        subject: "Demo",
        status: "active",
        createdBy: "user",
        createdAt: 1,
        updatedAt: 1,
      })
    );

    await assertFails(
      setDoc(doc(demoDb, "users", ALICE, "sources", "demo-source"), {
        title: "Demo source",
        type: "manual_note",
        topicIds: [],
        contentText: "Demo should not write real Library data.",
        status: "active",
        createdBy: ALICE,
        createdAt: 1,
        updatedAt: 1,
      })
    );

    await assertFails(
      setDoc(
        doc(demoDb, "users", ALICE, "assistantThreads", "demo-assistant-thread"),
        {
          title: "Demo chat",
          surface: "learn",
          contextKey: "learn:card-1",
          contextLabel: "Flashcard",
          context: { surface: "learn", cardId: "card-1" },
          createdAt: 1,
          updatedAt: 1,
        }
      )
    );

    await assertFails(
      setDoc(doc(demoDb, "users", ALICE, "studyFolders", "demo-folder"), {
        name: "Demo folder",
        topicIds: [],
        archived: false,
        createdAt: 1,
        updatedAt: 1,
      })
    );

    await assertFails(
      setDoc(doc(demoDb, "users", ALICE, "notebooks", "demo-notebook"), {
        folderId: "folder-linear-algebra",
        title: "Demo notebook",
        type: "free_working",
        createdAt: 1,
        updatedAt: 1,
      })
    );

    await assertFails(
      setDoc(doc(demoDb, "users", ALICE, "notebookFiles", "demo-file"), {
        notebookId: "demo-notebook",
        folderId: "folder-linear-algebra",
        fileName: "demo.pdf",
        fileType: "application/pdf",
        storagePath: "users/alice/notebookFiles/demo-notebook/demo-file-demo.pdf",
        uploadedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      })
    );

    await assertFails(
      setDoc(doc(demoDb, "users", ALICE, "practiceSets", "demo-set"), {
        folderId: "folder-linear-algebra",
        title: "Demo practice set",
        type: "manual",
        createdAt: 1,
        updatedAt: 1,
      })
    );

    await assertFails(
      setDoc(doc(demoDb, "users", ALICE, "pastPapers", "demo-paper"), {
        folderId: "folder-linear-algebra",
        title: "Demo past paper",
        createdAt: 1,
        updatedAt: 1,
      })
    );
  });

  it("keeps deadline evidence immutable and source embeddings server-only", async () => {
    await seedData();

    const aliceDb = testEnv.authenticatedContext(ALICE).firestore();
    const bobDb = testEnv.authenticatedContext(BOB).firestore();
    const deadlineRef = doc(
      aliceDb,
      "users",
      ALICE,
      "practicePaperDeadlineSnapshots",
      "attempt-1_page-1"
    );
    await assertFails(setDoc(deadlineRef, {
      attemptId: "attempt-1",
      paperId: "paper-1",
      notebookId: "notebook-1",
      pageId: "page-1",
      capturedAt: 10,
      page: { typedContent: "Forged answer" },
    }));
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(
        context.firestore(),
        "users",
        ALICE,
        "practicePaperDeadlineSnapshots",
        "attempt-1_page-1"
      ), {
        attemptId: "attempt-1",
        paperId: "paper-1",
        notebookId: "notebook-1",
        pageId: "page-1",
        capturedAt: 10,
        page: { typedContent: "Within-time answer" },
      });
    });
    await assertSucceeds(getDoc(deadlineRef));
    await assertFails(updateDoc(deadlineRef, { capturedAt: 11 }));
    await assertFails(deleteDoc(deadlineRef));
    await assertFails(getDoc(doc(
      bobDb,
      "users",
      ALICE,
      "practicePaperDeadlineSnapshots",
      "attempt-1_page-1"
    )));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users", ALICE, "sourceChunks", "source-1-0000"), {
        sourceId: "source-1",
        text: "Private extracted source text",
        embedding: [0.1, 0.2],
      });
    });
    const chunkRef = doc(aliceDb, "users", ALICE, "sourceChunks", "source-1-0000");
    await assertFails(getDoc(chunkRef));
    await assertFails(setDoc(chunkRef, { sourceId: "source-1", text: "changed" }));
    await assertFails(getDocs(collection(aliceDb, "users", ALICE, "sourceChunks")));
  });

  it("blocks demo accounts from mutating decks and notification setup", async () => {
    await seedData();

    const demoDb = testEnv.authenticatedContext(ALICE, { demo: true }).firestore();

    await assertFails(
      setDoc(doc(demoDb, "decks", "demo-deck"), {
        name: "Demo deck",
        userId: ALICE,
        createdAt: 1,
      })
    );

    await assertFails(
      setDoc(doc(demoDb, "users", ALICE, "notificationPreferences", "config"), {
        enabled: true,
        mode: "smart",
        updatedAt: 1,
      })
    );
  });

  it("keeps durable practice-paper job internals server-only", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(
          context.firestore(),
          "users",
          ALICE,
          "practicePaperJobs",
          "job-1"
        ),
        {
          paperId: "paper-1",
          status: "queued",
          request: { instructions: "private workflow input" },
        }
      );
    });

    const aliceDb = testEnv.authenticatedContext(ALICE).firestore();
    const jobRef = doc(
      aliceDb,
      "users",
      ALICE,
      "practicePaperJobs",
      "job-1"
    );
    await assertFails(getDoc(jobRef));
    await assertFails(setDoc(jobRef, { status: "cancelled" }, { merge: true }));
    await assertFails(
      getDocs(collection(aliceDb, "users", ALICE, "practicePaperJobs"))
    );
  });

  it("keeps marking jobs, evidence manifests, and workflow artifacts server-only", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await Promise.all([
        setDoc(doc(adminDb, "users", ALICE, "practicePaperMarkingJobs", "mark-job-1"), { status: "running" }),
        setDoc(doc(adminDb, "users", ALICE, "practicePaperMarkingJobArtifacts", "mark-job-1"), { providerOutput: "private" }),
        setDoc(doc(adminDb, "users", ALICE, "practicePaperEvidence", "attempt-1"), { manifest: { private: true } }),
      ]);
    });
    const aliceDb = testEnv.authenticatedContext(ALICE).firestore();
    for (const [collectionName, id] of [
      ["practicePaperMarkingJobs", "mark-job-1"],
      ["practicePaperMarkingJobArtifacts", "mark-job-1"],
      ["practicePaperEvidence", "attempt-1"],
    ]) {
      const reference = doc(aliceDb, "users", ALICE, collectionName, id);
      await assertFails(getDoc(reference));
      await assertFails(setDoc(reference, { status: "cancelled" }, { merge: true }));
    }
  });

  it("keeps exam-format and paper-quality namespaces server-only", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await Promise.all([
        setDoc(doc(adminDb, "examFormatProfiles", "aqa-gcse-maths"), { activeVersion: "v1" }),
        setDoc(doc(adminDb, "examFormatImports", "import-1"), { status: "processed" }),
        setDoc(doc(adminDb, "examFormatReferenceFingerprints", "aqa-gcse-maths"), { windowHashes: ["deadbeef"] }),
        setDoc(doc(adminDb, "paperGenerationBenchmarkRuns", "run-1"), { status: "running" }),
        setDoc(doc(adminDb, "paperGenerationBenchmarkBaselines", "baseline-1"), { schemaVersion: 2 }),
      ]);
    });
    const aliceDb = testEnv.authenticatedContext(ALICE).firestore();
    for (const [collectionName, id] of [
      ["examFormatProfiles", "aqa-gcse-maths"],
      ["examFormatImports", "import-1"],
      ["examFormatReferenceFingerprints", "aqa-gcse-maths"],
      ["paperGenerationBenchmarkRuns", "run-1"],
      ["paperGenerationBenchmarkBaselines", "baseline-1"],
    ]) {
      const reference = doc(aliceDb, collectionName, id);
      await assertFails(getDoc(reference));
      await assertFails(setDoc(reference, { exposed: true }, { merge: true }));
    }
  });

  it("keeps answer-bearing practice-paper rubrics inaccessible before submission", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await Promise.all([
        setDoc(doc(adminDb, "users", ALICE, "pastPapers", "safe-paper"), {
          status: "ready",
          markScheme: {
            kind: "generated",
            label: "Jami-generated marking guide",
            notice: "Hidden until marking",
            items: [],
          },
        }),
        setDoc(doc(adminDb, "users", ALICE, "pastPapers", "legacy-leak"), {
          status: "ready",
          markScheme: {
            kind: "generated",
            label: "Jami-generated marking guide",
            notice: "Hidden until marking",
            items: [{ questionId: "q1", answer: "secret answer" }],
          },
        }),
        setDoc(doc(adminDb, "users", ALICE, "practicePaperSecrets", "safe-paper"), {
          markScheme: {
            items: [{ questionId: "q1", answer: "secret answer" }],
          },
        }),
        setDoc(doc(adminDb, "users", ALICE, "practicePaperJobArtifacts", "job-1"), {
          generated: { markScheme: { items: [{ answer: "secret answer" }] } },
        }),
      ]);
    });

    const aliceDb = testEnv.authenticatedContext(ALICE).firestore();
    await assertSucceeds(
      getDoc(doc(aliceDb, "users", ALICE, "pastPapers", "safe-paper"))
    );
    await assertFails(
      getDoc(doc(aliceDb, "users", ALICE, "pastPapers", "legacy-leak"))
    );
    await assertFails(
      getDoc(doc(aliceDb, "users", ALICE, "practicePaperSecrets", "safe-paper"))
    );
    await assertFails(
      getDoc(doc(aliceDb, "users", ALICE, "practicePaperJobArtifacts", "job-1"))
    );
    await assertFails(
      setDoc(doc(aliceDb, "users", ALICE, "pastPapers", "attempted-leak"), {
        status: "ready",
        markScheme: {
          kind: "generated",
          label: "Guide",
          notice: "",
          items: [{ questionId: "q1", answer: "secret answer" }],
        },
      })
    );
  });

  it("allows demo accounts to update study-safe card scheduling fields only", async () => {
    await seedData();

    const demoDb = testEnv.authenticatedContext(ALICE, { demo: true }).firestore();

    await assertSucceeds(
      setDoc(
        doc(demoDb, "cards", "alice-card"),
        {
          deckId: ALICE_DECK_ID,
          userId: ALICE,
          front: "Question",
          back: "Answer",
          tags: ["biology"],
          createdAt: 1,
          dueDate: 200,
          stability: 3,
          difficulty: 5,
          fsrsState: 2,
          lapses: 1,
          reps: 3,
        },
        { merge: false }
      )
    );

    await assertFails(
      setDoc(
        doc(demoDb, "cards", "alice-card"),
        {
          deckId: ALICE_DECK_ID,
          userId: ALICE,
          front: "Changed question",
          back: "Answer",
          tags: ["biology"],
          createdAt: 1,
          dueDate: 200,
          stability: 3,
          difficulty: 5,
          fsrsState: 2,
          lapses: 1,
          reps: 3,
        },
        { merge: false }
      )
    );
  });
});
