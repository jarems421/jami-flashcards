import { featureFlags } from "@/lib/app/feature-flags";

type NotebookPromptAction = { label: string; prompt: string };
type NotebookQuickAction = NotebookPromptAction | { label: string; run: () => void };

const MARK_MY_WORK_ACTION = {
  label: "Mark my work",
  prompt:
    "Mark the work on this page. Give clear indicative feedback on what is correct, what needs fixing, and the most useful next step. Only give a formal mark when this page includes a defensible mark allocation or mark scheme; otherwise label it as feedback, not an official grade.",
} as const;

const NOTEBOOK_LEARNING_ACTIONS = [
  {
    label: "Give me a hint",
    prompt:
      "Give me one useful hint for the work on this page without revealing the full answer.",
  },
  {
    label: "Explain this page",
    prompt:
      "Explain the ideas and working on this page clearly, including anything important I may have missed.",
  },
  {
    label: "Quiz me",
    prompt:
      "Quiz me on the main idea from this page. Ask one question at a time and do not reveal the answer yet.",
  },
] as const;

export function getNotebookAssistantQuickActions(input: { hasWork: boolean }): NotebookPromptAction[];
export function getNotebookAssistantQuickActions(input: { hasWork: boolean; onPastPaperPractice: (() => void) | undefined }): NotebookQuickAction[];
export function getNotebookAssistantQuickActions(input: { hasWork: boolean; onPastPaperPractice?: () => void }): NotebookQuickAction[] {
  const actions: NotebookQuickAction[] = input.hasWork
    ? [MARK_MY_WORK_ACTION, ...NOTEBOOK_LEARNING_ACTIONS]
    : [...NOTEBOOK_LEARNING_ACTIONS];
  if (featureFlags.enablePastPaperPractice && input.onPastPaperPractice) actions.push({ label: "Past Paper Practice", run: input.onPastPaperPractice });
  return actions;
}
