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

function blob(type: string, content = "notebook-file") {
  return new Blob([content], { type });
}

describe("Storage security rules", () => {
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
    await assertSucceeds(deleteObject(fileRef));
  });

  it("blocks other users and demo sessions from deleting notebook files", async () => {
    const aliceStorage = testEnv.authenticatedContext("alice").storage();
    const bobStorage = testEnv.authenticatedContext("bob").storage();
    const demoStorage = testEnv
      .authenticatedContext("alice", { demo: true })
      .storage();
    const filePath =
      "users/alice/notebookFiles/notebook-1/file-1-biology-notes.pdf";

    await assertSucceeds(
      uploadBytes(ref(aliceStorage, filePath), blob("application/pdf"))
    );
    await assertFails(deleteObject(ref(bobStorage, filePath)));
    await assertFails(deleteObject(ref(demoStorage, filePath)));
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

  it("allows only the owner to manage supported video-card uploads", async () => {
    const aliceStorage = testEnv.authenticatedContext("alice").storage();
    const bobStorage = testEnv.authenticatedContext("bob").storage();
    const filePath = "users/alice/videoCardImports/job-123456789012/video.mp4";
    await assertSucceeds(uploadBytes(ref(aliceStorage, filePath), blob("video/mp4")));
    await assertSucceeds(getBytes(ref(aliceStorage, filePath)));
    await assertFails(getBytes(ref(bobStorage, filePath)));
    await assertFails(deleteObject(ref(bobStorage, filePath)));
    await assertSucceeds(deleteObject(ref(aliceStorage, filePath)));
  });

  it("rejects unsafe video-card uploads and demo writers", async () => {
    const aliceStorage = testEnv.authenticatedContext("alice").storage();
    const demoStorage = testEnv.authenticatedContext("alice", { demo: true }).storage();
    const root = "users/alice/videoCardImports/job-123456789012";
    await assertFails(uploadBytes(ref(aliceStorage, `${root}/script.js`), blob("application/javascript")));
    await assertFails(uploadBytes(ref(demoStorage, `${root}/video.webm`), blob("video/webm")));
  });

  it("lets only the owner read server-created assistant and paper images", async () => {
    const assistantPath =
      "users/alice/assistantImages/asset-1/illustration.webp";
    const paperPath =
      "users/alice/generatedPaperAssets/paper-1/asset-2";

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await uploadBytes(ref(context.storage(), assistantPath), blob("image/webp"));
      await uploadBytes(ref(context.storage(), paperPath), blob("image/png"));
    });

    const aliceStorage = testEnv.authenticatedContext("alice").storage();
    const bobStorage = testEnv.authenticatedContext("bob").storage();
    const guestStorage = testEnv.unauthenticatedContext().storage();

    await assertSucceeds(getBytes(ref(aliceStorage, assistantPath)));
    await assertSucceeds(getBytes(ref(aliceStorage, paperPath)));
    await assertFails(getBytes(ref(bobStorage, assistantPath)));
    await assertFails(getBytes(ref(guestStorage, paperPath)));
    await assertFails(
      uploadBytes(ref(aliceStorage, assistantPath), blob("image/webp"))
    );
    await assertFails(deleteObject(ref(aliceStorage, paperPath)));
  });

  it("keeps frozen marking evidence server-only, including from its owner", async () => {
    const evidencePath = "users/alice/practicePaperMarkingEvidence/attempt-1/answer-1.png";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await uploadBytes(ref(context.storage(), evidencePath), blob("image/png"));
    });
    const aliceStorage = testEnv.authenticatedContext("alice").storage();
    const bobStorage = testEnv.authenticatedContext("bob").storage();
    await assertFails(getBytes(ref(aliceStorage, evidencePath)));
    await assertFails(getBytes(ref(bobStorage, evidencePath)));
    await assertFails(deleteObject(ref(aliceStorage, evidencePath)));
  });

  it("keeps exam-format imports and benchmark artifacts server-only", async () => {
    const importPath = "internal/examFormatImports/import-1/specification.pdf";
    const benchmarkPath = "internal/paperGenerationBenchmarks/run-1/case-1.json";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await uploadBytes(ref(context.storage(), importPath), blob("application/pdf"));
      await uploadBytes(ref(context.storage(), benchmarkPath), blob("application/json"));
    });
    const aliceStorage = testEnv.authenticatedContext("alice").storage();
    const guestStorage = testEnv.unauthenticatedContext().storage();
    for (const path of [importPath, benchmarkPath]) {
      await assertFails(getBytes(ref(aliceStorage, path)));
      await assertFails(getBytes(ref(guestStorage, path)));
      await assertFails(uploadBytes(ref(aliceStorage, path), blob("application/json")));
      await assertFails(deleteObject(ref(aliceStorage, path)));
    }
  });
});
