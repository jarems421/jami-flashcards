// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CardStudyOptions from "@/components/decks/CardStudyOptions";
import { EMPTY_STUDY_SETTINGS_DRAFT, type StudySettingsDraft } from "@/lib/study/card-study-settings";

/**
 * The card editor's study options: a student's own other answers, wrong
 * answers for multiple choice, words to blank and ways not to ask a card,
 * each saying what Learn will make of it.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let latest: StudySettingsDraft;

function Harness({ back, hasBackImage = false }: { back: string; hasBackImage?: boolean }) {
  const [value, setValue] = useState<StudySettingsDraft>(EMPTY_STUDY_SETTINGS_DRAFT);
  latest = value;
  return (
    <CardStudyOptions
      front="What carries oxygen in the blood?"
      back={back}
      hasBackImage={hasBackImage}
      value={value}
      onChange={setValue}
    />
  );
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const field = (label: string) => {
  const labelElement = Array.from(host.querySelectorAll("label")).find((element) => element.textContent === label);
  const input = labelElement ? document.getElementById(labelElement.htmlFor) : null;
  return input instanceof HTMLInputElement ? input : null;
};

function add(label: string, text: string) {
  const input = field(label);
  if (!input) throw new Error(`No field labelled ${label}`);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

const text = () => host.textContent ?? "";

describe("a card's study options", () => {
  it("is folded away and says so when nothing is set", () => {
    act(() => root.render(<Harness back="Haemoglobin" />));
    expect(host.querySelector("summary")?.textContent).toContain("Study options");
    expect(host.querySelector("summary")?.textContent).toContain("Optional");
  });

  it("takes other right answers one at a time, and never the same one twice", () => {
    act(() => root.render(<Harness back="Haemoglobin" />));
    add("Also mark these right", "Hemoglobin");
    add("Also mark these right", "hemoglobin");
    expect(latest.acceptedAnswers).toEqual(["Hemoglobin"]);
    expect(text()).toContain("Already in the list.");
    expect(host.querySelector("summary")?.textContent).toContain("1 other answer");

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Remove Hemoglobin"]')?.click());
    expect(latest.acceptedAnswers).toEqual([]);
  });

  it("says how many more wrong answers multiple choice needs, then that it is ready", () => {
    act(() => root.render(<Harness back="Haemoglobin" />));
    add("Your wrong answers for multiple choice", "Myoglobin");
    expect(text()).toContain("Add 2 more: Learn needs 3");
    add("Your wrong answers for multiple choice", "Albumin");
    add("Your wrong answers for multiple choice", "Fibrinogen");
    expect(latest.wrongAnswers).toEqual(["Myoglobin", "Albumin", "Fibrinogen"]);
    expect(text()).toContain("Learn can ask this as multiple choice with your wrong answers.");

    // Turned off, it says so instead.
    act(() => host.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Multiple Choice"]')?.click());
    expect(latest.disabledModes).toEqual(["multiple-choice"]);
    expect(text()).toContain("Multiple Choice is off for this card.");
  });

  it("shows the blank Gap Fill will ask, and the words it could not find", () => {
    act(() => root.render(<Harness back="Haemoglobin in red blood cells carries oxygen to every tissue" />));
    add("Words to blank in Gap Fill", "oxygen");
    expect(text()).toContain("Learn will ask:");
    expect(text()).toContain("carries _____ to every tissue");
    add("Words to blank in Gap Fill", "nitrogen");
    expect(text()).toContain("“nitrogen” is not in the answer exactly, so it is not blanked.");
  });

  it("offers nothing for a picture answer, which is only ever turned over", () => {
    act(() => root.render(<Harness back="" hasBackImage />));
    expect(field("Also mark these right")).toBeNull();
    expect(text()).toContain("always turned over in Learn");
  });
});
