// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  useFeedback,
  type FeedbackController,
} from "@/hooks/useFeedback";
import { getFeedbackErrorMessage } from "@/lib/app/feedback";

let container: HTMLDivElement;
let root: Root;
let controller: FeedbackController;

function Harness() {
  const value = useFeedback();
  useEffect(() => {
    controller = value;
  });
  return null;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(<Harness />);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("getFeedbackErrorMessage", () => {
  it("prefers the thrown message", () => {
    expect(getFeedbackErrorMessage(new Error("Deck is locked."), "Fallback")).toBe(
      "Deck is locked."
    );
  });

  it("falls back for a non-Error throw", () => {
    expect(getFeedbackErrorMessage("boom", "Fallback")).toBe("Fallback");
    expect(getFeedbackErrorMessage(undefined, "Fallback")).toBe("Fallback");
    expect(getFeedbackErrorMessage({ message: "nope" }, "Fallback")).toBe(
      "Fallback"
    );
  });

  it("falls back rather than showing an empty banner", () => {
    // The hand-written idiom this replaces rendered a blank notice here.
    expect(getFeedbackErrorMessage(new Error(""), "Fallback")).toBe("Fallback");
    expect(getFeedbackErrorMessage(new Error("   "), "Fallback")).toBe("Fallback");
  });
});

describe("useFeedback", () => {
  it("starts with nothing to show", () => {
    expect(controller.feedback).toBeNull();
  });

  it("shows a success and an error notice", () => {
    act(() => {
      controller.success("Topic renamed.");
    });
    expect(controller.feedback).toEqual({
      type: "success",
      message: "Topic renamed.",
    });

    act(() => {
      controller.showError("Could not rename Topic.");
    });
    expect(controller.feedback).toEqual({
      type: "error",
      message: "Could not rename Topic.",
    });
  });

  it("reports a thrown error, with a fallback", () => {
    act(() => {
      controller.showThrownError(new Error("Name already used."), "Could not save.");
    });
    expect(controller.feedback?.message).toBe("Name already used.");

    act(() => {
      controller.showThrownError("offline", "Could not save.");
    });
    expect(controller.feedback).toEqual({
      type: "error",
      message: "Could not save.",
    });
  });

  it("clears the banner", () => {
    act(() => {
      controller.showError("Could not save.");
      controller.clear();
    });
    expect(controller.feedback).toBeNull();
  });

  it("only clears the notice it was asked to clear", () => {
    act(() => {
      controller.showError("Could not autosave this page.");
    });
    act(() => {
      controller.clearIfShowing("Some other message");
    });
    expect(controller.feedback?.message).toBe("Could not autosave this page.");

    act(() => {
      controller.clearIfShowing("Could not autosave this page.");
    });
    expect(controller.feedback).toBeNull();
  });

  it("does not wipe a newer notice with a late clear", () => {
    act(() => {
      controller.showError("Could not save.");
    });
    act(() => {
      // A retry finishing behind a success must not blank the success.
      controller.success("Saved.");
      controller.clearIfShowing("Could not save.");
    });
    expect(controller.feedback).toEqual({ type: "success", message: "Saved." });
  });

  it("keeps a stable write surface across renders", () => {
    const first = controller;
    act(() => {
      controller.success("Anything");
    });
    expect(controller.success).toBe(first.success);
    expect(controller.showThrownError).toBe(first.showThrownError);
    expect(controller.clear).toBe(first.clear);
  });
});
