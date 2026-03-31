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
import { doc, getDoc, setDoc } from "firebase/firestore";

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

  it("allows owners to read decks stored with either userId or legacy uid", async () => {
    await seedData();

    const aliceDb = testEnv.authenticatedContext(ALICE).firestore();
    const bobDb = testEnv.authenticatedContext(BOB).firestore();

    await assertSucceeds(getDoc(doc(aliceDb, "decks", ALICE_DECK_ID)));
    await assertSucceeds(getDoc(doc(aliceDb, "decks", LEGACY_ALICE_DECK_ID)));
    await assertFails(getDoc(doc(bobDb, "decks", LEGACY_ALICE_DECK_ID)));
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
});