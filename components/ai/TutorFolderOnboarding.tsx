"use client";

import { useState, type ReactNode } from "react";
import { Button, Input, JamiTutorIcon, Textarea } from "@/components/ui";
import { buildFolderInstructionsDraft } from "@/lib/ai/tutor-personalisation";

type Step = "course" | "focus" | "avoid" | "review";

type TutorFolderOnboardingProps = {
  folderName: string;
  /** Prefilled from what is already known, and nothing else. */
  suggestedCourse: string;
  saving: boolean;
  onSave: (instructions: string) => Promise<boolean>;
  onSkip: () => void;
};

const QUESTIONS: {
  step: Step;
  label: string;
  question: string;
  helper: string;
  placeholder: string;
  multiline: boolean;
}[] = [
  {
    step: "course",
    label: "Course",
    question: "Which course is this for?",
    helper: "An exam board and level if you have one. It changes the wording and depth I use.",
    placeholder: "AQA A-level Biology",
    multiline: false,
  },
  {
    step: "focus",
    label: "Focus on",
    question: "What should I focus on?",
    helper: "How you want to be helped in this subject specifically.",
    placeholder: "Use specification wording, and show mark allocations when you check my work.",
    multiline: true,
  },
  {
    step: "avoid",
    label: "Avoid",
    question: "Anything I should avoid?",
    helper: "Leave it blank if nothing comes to mind.",
    placeholder: "Don't give me the full answer before I've had a go.",
    multiline: true,
  },
];

/** One thing Jami says, marked as Jami rather than as interface copy. */
function JamiSays({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-warm-border bg-warm-glow text-warm-accent">
        <JamiTutorIcon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-3 text-sm leading-6 text-text-primary">
        {children}
      </div>
    </div>
  );
}

/** What the student said back, so the exchange reads as one conversation. */
function YouSaid({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-tr-sm border border-accent/35 bg-accent/10 px-4 py-2.5 text-sm leading-6 text-text-primary">
        {children}
      </div>
    </div>
  );
}

/**
 * Setting up a subject, as a short conversation rather than a second form.
 *
 * The questions were already the content -- which course, what to focus on,
 * what to avoid -- but asking them in a three-field form and then handing over
 * a Markdown box made it a wizard nobody would ever miss. Asked one at a time,
 * with the answers read back in Jami's own voice, the same three answers teach
 * the student what a set of notes is for. Which is the point: after this they
 * write their own, and the last thing said to them is that they can.
 *
 * Still no model involved. The write-up is a template, so it costs nothing and
 * says the same thing every time.
 */
export default function TutorFolderOnboarding({
  folderName,
  suggestedCourse,
  saving,
  onSave,
  onSkip,
}: TutorFolderOnboardingProps) {
  const [step, setStep] = useState<Step>("course");
  const [answers, setAnswers] = useState<Record<Step, string>>({
    course: suggestedCourse,
    focus: "",
    avoid: "",
    review: "",
  });
  const [saved, setSaved] = useState(false);

  const answeredSteps = QUESTIONS.filter(
    (entry) => QUESTIONS.findIndex((q) => q.step === entry.step) <
      QUESTIONS.findIndex((q) => q.step === step) || step === "review"
  );
  const current = QUESTIONS.find((entry) => entry.step === step);

  const setAnswer = (value: string) =>
    setAnswers((previous) => ({ ...previous, [step]: value }));

  const advance = () => {
    const index = QUESTIONS.findIndex((entry) => entry.step === step);
    setStep(QUESTIONS[index + 1]?.step ?? "review");
  };

  const document = buildFolderInstructionsDraft({
    courseOrSubject: answers.course,
    focusOn: answers.focus,
    avoid: answers.avoid,
  });

  if (saved) {
    return (
      <div className="flex flex-col gap-4">
        <JamiSays>
          <p className="font-medium">Saved.</p>
          <p className="mt-1.5 text-text-secondary">
            I&rsquo;ll read these whenever we work in {folderName}. You can
            rewrite them whenever you like, and you are not stuck with those
            three headings — tell me anything that helps. Get creative.
          </p>
        </JamiSays>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <JamiSays>
        Let&rsquo;s set up <span className="font-medium">{folderName}</span>.
        Three quick questions and I&rsquo;ll write them up for you.
      </JamiSays>

      {answeredSteps.map((entry) =>
        answers[entry.step] ? (
          <YouSaid key={entry.step}>{answers[entry.step]}</YouSaid>
        ) : null
      )}

      {current ? (
        <>
          <JamiSays>
            <p className="font-medium">{current.question}</p>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              {current.helper}
            </p>
          </JamiSays>
          <div className="pl-11">
            {current.multiline ? (
              <Textarea
                aria-label={current.question}
                rows={3}
                value={answers[current.step]}
                disabled={saving}
                maxLength={800}
                placeholder={current.placeholder}
                onChange={(event) => setAnswer(event.target.value)}
              />
            ) : (
              <Input
                aria-label={current.question}
                value={answers[current.step]}
                disabled={saving}
                maxLength={200}
                placeholder={current.placeholder}
                onChange={(event) => setAnswer(event.target.value)}
              />
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button type="button" disabled={saving} onClick={advance}>
                {answers[current.step].trim() ? "Next" : "Skip this one"}
              </Button>
              <button
                type="button"
                disabled={saving}
                className="text-xs font-semibold text-text-muted underline-offset-4 hover:text-text-secondary hover:underline"
                onClick={onSkip}
              >
                I&rsquo;d rather write it myself
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <JamiSays>
            {document
              ? `Here's what I've got for ${folderName}.`
              : `You haven't given me anything yet — that's fine, you can write your own notes instead.`}
          </JamiSays>

          {document ? (
            <div className="ml-11 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-panel)] p-4 sm:p-5">
              <dl className="space-y-4">
                {QUESTIONS.map((entry) =>
                  answers[entry.step].trim() ? (
                    <div key={entry.step}>
                      <dt className="text-2xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
                        {entry.label}
                      </dt>
                      <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-text-primary">
                        {answers[entry.step].trim()}
                      </dd>
                    </div>
                  ) : null
                )}
              </dl>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 pl-11">
            <Button
              type="button"
              disabled={saving || !document}
              onClick={async () => {
                if (await onSave(document)) setSaved(true);
              }}
            >
              {saving ? "Saving…" : "Save these notes"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => setStep("course")}
            >
              Change something
            </Button>
            <button
              type="button"
              disabled={saving}
              className="text-xs font-semibold text-text-muted underline-offset-4 hover:text-text-secondary hover:underline"
              onClick={onSkip}
            >
              Write my own instead
            </button>
          </div>
        </>
      )}
    </div>
  );
}
