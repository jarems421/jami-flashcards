import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import {
  buildNotebookPagePayload,
  buildNotebookPayload,
} from "@/lib/workspace/notebooks";
import { buildStudyFolderPayload } from "@/lib/workspace/study-folders";
import {
  E2E_CARDS,
  E2E_DECK_ID,
  E2E_DECK_NAME,
  E2E_OFFLINE_CARDS,
  E2E_OFFLINE_DECK_ID,
  E2E_OFFLINE_DECK_NAME,
  E2E_MODES_CARDS,
  E2E_MODES_DECK_ID,
  E2E_MODES_DECK_NAME,
  E2E_PHONE_CARDS,
  E2E_PHONE_DECK_ID,
  E2E_PHONE_DECK_NAME,
  E2E_FOLDER_ID,
  E2E_GOAL,
  E2E_SOURCE,
  E2E_TOPIC,
  E2E_NOTEBOOK_ID,
  E2E_PAGE_IDS,
  E2E_PROJECT_ID,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
} from "./fixtures";

function requireEmulatorHost(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is missing. Run the suite through npm run test:e2e.`);
  }
  return value;
}

export default async function globalSetup() {
  const authHost = requireEmulatorHost("FIREBASE_AUTH_EMULATOR_HOST");
  requireEmulatorHost("FIRESTORE_EMULATOR_HOST");
  requireEmulatorHost("FIREBASE_STORAGE_EMULATOR_HOST");

  const testEnvironment = await initializeTestEnvironment({
    projectId: E2E_PROJECT_ID,
  });

  try {
    await testEnvironment.clearFirestore();
    const clearAccountsResponse = await fetch(
      `http://${authHost}/emulator/v1/projects/${E2E_PROJECT_ID}/accounts`,
      { method: "DELETE" }
    );
    if (!clearAccountsResponse.ok) {
      throw new Error(
        `Could not clear the Auth emulator (${clearAccountsResponse.status}).`
      );
    }

    const signUpResponse = await fetch(
      `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-browser-api-key`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: E2E_USER_EMAIL,
          password: E2E_USER_PASSWORD,
          returnSecureToken: true,
        }),
      }
    );
    const signUpResult = (await signUpResponse.json()) as {
      error?: { message?: string };
      localId?: string;
    };
    if (!signUpResponse.ok || !signUpResult.localId) {
      throw new Error(
        `Could not seed the Auth emulator: ${
          signUpResult.error?.message ?? signUpResponse.status
        }`
      );
    }

    const now = 1_800_000_000_000;
    const notebookPayload = buildNotebookPayload({
      folderId: E2E_FOLDER_ID,
      title: "Notebook browser smoke",
      type: "free_working",
      pageColor: "white",
      pageStyle: "grid",
      now,
    });
    const pagePayloads = E2E_PAGE_IDS.map((pageId, index) => ({
      pageId,
      payload: buildNotebookPagePayload({
        notebookId: E2E_NOTEBOOK_ID,
        folderId: E2E_FOLDER_ID,
        pageNumber: index + 1,
        pageType: "blank",
        pageColor: "white",
        pageStyle: "grid",
        status: "blank",
        now: now + index,
      }),
    }));

    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const userId = signUpResult.localId!;

      await Promise.all([
        setDoc(doc(db, "users", userId), {
          topicsMigrationVersion: 1,
          createdAt: now,
          updatedAt: now,
        }),
        // Material for the browse screens: Topics, Sources, and Goals each
        // need one row to prove the list renders rather than the empty state.
        setDoc(doc(db, "users", userId, "topics", E2E_TOPIC.id), {
          name: E2E_TOPIC.name,
          normalizedName: E2E_TOPIC.name.toLowerCase(),
          slug: "browser-smoke-topic",
          subject: "Testing",
          status: "active",
          createdBy: "user",
          createdAt: now,
          updatedAt: now,
        }),
        setDoc(doc(db, "users", userId, "sources", E2E_SOURCE.id), {
          title: E2E_SOURCE.title,
          type: "manual_note",
          subject: "Testing",
          folderIds: [E2E_FOLDER_ID],
          topicIds: [E2E_TOPIC.id],
          contentText: "Notes captured for the browser smoke.",
          status: "active",
          createdBy: "user",
          createdAt: now,
          updatedAt: now,
        }),
        setDoc(doc(db, "users", userId, "goals", E2E_GOAL.id), {
          name: E2E_GOAL.name,
          scope: { type: "all" },
          targetCards: 20,
          targetAccuracy: 80,
          // Comfortably ahead, so the goal stays active however long the
          // suite runs.
          deadline: now + 30 * 24 * 60 * 60 * 1000,
          progress: { cardsCompleted: 0, correctAnswers: 0, totalAnswers: 0 },
          status: "active",
          createdAt: now,
        }),
        setDoc(
          doc(db, "users", userId, "studyFolders", E2E_FOLDER_ID),
          buildStudyFolderPayload({
            name: "Browser smoke folder",
            subject: "Testing",
            now,
          })
        ),
        setDoc(
          doc(db, "users", userId, "notebooks", E2E_NOTEBOOK_ID),
          notebookPayload
        ),
        ...pagePayloads.map(({ pageId, payload }) =>
          setDoc(
            doc(db, "users", userId, "notebookPages", pageId),
            payload
          )
        ),
        // Decks and cards are top-level collections scoped by userId, unlike
        // the notebook data above which lives under users/{uid}.
        ...[
          { deckId: E2E_DECK_ID, name: E2E_DECK_NAME, cards: E2E_CARDS },
          {
            deckId: E2E_PHONE_DECK_ID,
            name: E2E_PHONE_DECK_NAME,
            cards: E2E_PHONE_CARDS,
          },
          {
            deckId: E2E_OFFLINE_DECK_ID,
            name: E2E_OFFLINE_DECK_NAME,
            cards: E2E_OFFLINE_CARDS,
          },
          {
            deckId: E2E_MODES_DECK_ID,
            name: E2E_MODES_DECK_NAME,
            cards: E2E_MODES_CARDS,
          },
        ].flatMap(({ deckId, name, cards }) => [
          setDoc(doc(db, "decks", deckId), {
            name,
            userId,
            createdAt: now,
            colorPreset: "violet",
            iconPreset: "sparkles",
            folderIds: [E2E_FOLDER_ID],
          }),
          ...cards.map((card, index) =>
            setDoc(doc(db, "cards", card.id), {
              deckId,
              userId,
              front: card.front,
              back: card.back,
              createdAt: now + index,
              tags: [],
              topicIds: [],
              // Brand new cards: no FSRS history, so the scheduler treats
              // them as due and the session has something to hand out.
              fsrsState: 0,
              reps: 0,
              lapses: 0,
              dueDate: now,
              ...("studySettings" in card
                ? { studySettings: card.studySettings }
                : {}),
            })
          ),
        ]),
      ]);
    });
  } finally {
    await testEnvironment.cleanup();
  }

  for (const route of [
    "/dashboard",
    `/dashboard/folders/${E2E_FOLDER_ID}`,
    `/dashboard/notebooks/${E2E_NOTEBOOK_ID}?page=${E2E_PAGE_IDS[0]}`,
    `/dashboard/study?mode=custom&decks=${E2E_DECK_ID}`,
  ]) {
    const abortController = new AbortController();
    const abortTimer = setTimeout(() => abortController.abort(), 60_000);
    try {
      const response = await fetch(`http://127.0.0.1:3100${route}`, {
        signal: abortController.signal,
      });
      if (!response.ok) {
        throw new Error(`Could not warm ${route} (${response.status}).`);
      }
      await response.arrayBuffer();
    } finally {
      clearTimeout(abortTimer);
    }
  }
}
