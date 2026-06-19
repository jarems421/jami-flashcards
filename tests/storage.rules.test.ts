import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";
import { deleteObject, getBytes, ref, uploadBytes } from "firebase/storage";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const storageRules = readFileSync(path.join(rootDir, "storage.rules"), "utf8");

let testEnv: RulesTestEnvironment;
const describeStorageRules = process.env.FIREBASE_STORAGE_EMULATOR_HOST ? describe : describe.skip;

function blob(type: string, content = "notebook-file") {
  return new Blob([content], { type });
}

describeStorageRules("Storage security rules", () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "demo-jami-flashcards-storage",
      storage: { rules: storageRules },
    });
  });

  afterEach(async () => {
    await testEnv.clearStorage();
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  it("allows users to upload and read their own notebook files", async () => {
    const aliceStorage = testEnv.authenticatedContext("alice").storage();
    const fileRef = ref(
      aliceStorage,
      "users/alice/notebookFiles/notebook-1/file-1-biology-notes.pdf"
    );

    await assertSucceeds(uploadBytes(fileRef, blob("application/pdf")));
    await assertSucceeds(getBytes(fileRef));
  });

  it("blocks other users and guests from notebook files", async () => {
    const aliceStorage = testEnv.authenticatedContext("alice").storage();
    const bobStorage = testEnv.authenticatedContext("bob").storage();
    const guestStorage = testEnv.unauthenticatedContext().storage();
    const filePath = "users/alice/notebookFiles/notebook-1/file-1-biology-notes.pdf";

    await assertSucceeds(uploadBytes(ref(aliceStorage, filePath), blob("application/pdf")));
    await assertFails(getBytes(ref(bobStorage, filePath)));
    await assertFails(getBytes(ref(guestStorage, filePath)));
    await assertFails(uploadBytes(ref(bobStorage, filePath), blob("application/pdf")));
  });

  it("blocks shared demo accounts from notebook uploads", async () => {
    const demoStorage = testEnv
      .authenticatedContext("alice", { demo: true })
      .storage();
    const fileRef = ref(
      demoStorage,
      "users/alice/notebookFiles/notebook-1/file-1-biology-notes.pdf"
    );

    await assertFails(uploadBytes(fileRef, blob("application/pdf")));
  });

  it("rejects unsupported notebook file types", async () => {
    const aliceStorage = testEnv.authenticatedContext("alice").storage();
    const fileRef = ref(aliceStorage, "users/alice/notebookFiles/notebook-1/file-1-script.js");

    await assertFails(uploadBytes(fileRef, blob("application/javascript")));
  });

  it("allows users to upload and read their own source files", async () => {
    const aliceStorage = testEnv.authenticatedContext("alice").storage();
    const fileRef = ref(
      aliceStorage,
      "users/alice/sourceFiles/source-1/file-1-reference-image.png"
    );

    await assertSucceeds(uploadBytes(fileRef, blob("image/png")));
    await assertSucceeds(getBytes(fileRef));
    await assertSucceeds(deleteObject(fileRef));
  });

  it("allows supported Word, PowerPoint, and text source files", async () => {
    const aliceStorage = testEnv.authenticatedContext("alice").storage();
    const sourceRoot = "users/alice/sourceFiles/source-documents";

    await assertSucceeds(
      uploadBytes(
        ref(aliceStorage, `${sourceRoot}/notes.docx`),
        blob(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
      )
    );
    await assertSucceeds(
      uploadBytes(
        ref(aliceStorage, `${sourceRoot}/slides.pptx`),
        blob(
          "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        )
      )
    );
    await assertSucceeds(
      uploadBytes(
        ref(aliceStorage, `${sourceRoot}/summary.txt`),
        blob("text/plain")
      )
    );
  });

  it("blocks other users and guests from source files", async () => {
    const aliceStorage = testEnv.authenticatedContext("alice").storage();
    const bobStorage = testEnv.authenticatedContext("bob").storage();
    const guestStorage = testEnv.unauthenticatedContext().storage();
    const filePath = "users/alice/sourceFiles/source-1/file-1-reference.pdf";

    await assertSucceeds(uploadBytes(ref(aliceStorage, filePath), blob("application/pdf")));
    await assertFails(getBytes(ref(bobStorage, filePath)));
    await assertFails(getBytes(ref(guestStorage, filePath)));
    await assertFails(uploadBytes(ref(bobStorage, filePath), blob("application/pdf")));
  });

  it("blocks shared demo accounts from source uploads", async () => {
    const demoStorage = testEnv
      .authenticatedContext("alice", { demo: true })
      .storage();
    const fileRef = ref(
      demoStorage,
      "users/alice/sourceFiles/source-1/reference.pdf"
    );

    await assertFails(uploadBytes(fileRef, blob("application/pdf")));
  });

  it("rejects unsupported source file types", async () => {
    const aliceStorage = testEnv.authenticatedContext("alice").storage();
    const fileRef = ref(aliceStorage, "users/alice/sourceFiles/source-1/file-1-script.js");

    await assertFails(uploadBytes(fileRef, blob("application/javascript")));
  });
});
