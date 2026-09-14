// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Card } from "@/lib/study/cards";
import type { ResolvedExercise } from "@/lib/study/study-modes";

vi.mock("@/services/firebase/storage-files", () => ({
  createStorageFileId: vi.fn(() => "file-1"),
  deleteStorageFile: vi.fn(async () => undefined),
  getStorageFileDownloadUrl: vi.fn(async (path: string) => `https://files.test/${path}`),
  getStorageUploadErrorMessage: vi.fn(() => "upload failed"),
  sanitizeStorageFileName: vi.fn((name: string) => name),
  uploadStorageFile: vi.fn(async () => undefined),
}));

const { default: StudyExerciseStage } = await import("@/components/study/StudyExerciseStage");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flag: Card = {
  id: "flag",
  userId: "u",
  deckId: "d",
  front: "",
  frontImage: { storagePath: "users/u/cardImages/file-1/flag.png", width: 900, height: 600 },
  back: "France",
  tags: [],
  createdAt: 1,
};

const exercise: ResolvedExercise = {
  cardId: "flag",
  presentationId: "session:0:flag",
  cardContentHash: "hash",
  mode: "type-answer",
  prompt: "",
  expectedAnswer: "France",
  source: "deterministic",
};

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("shows a picture question above the answer box, with no empty line for missing words", async () => {
  await act(async () =>
    root.render(
      <StudyExerciseStage
        card={flag}
        exercise={exercise}
        savingRating={null}
        onCommit={vi.fn()}
        onModeAnswered={vi.fn()}
      />
    )
  );
  // The download URL resolves after the first render.
  await act(async () => {});

  const image = host.querySelector<HTMLImageElement>("img");
  expect(image?.getAttribute("alt")).toBe("The question on this card");
  expect(image?.getAttribute("src")).toBe("https://files.test/users/u/cardImages/file-1/flag.png");
  expect(host.querySelector("#study-answer-entry")).not.toBeNull();
  const face = host.querySelector(".study-flashcard-face");
  expect(face?.querySelectorAll("p")).toHaveLength(0);
});
