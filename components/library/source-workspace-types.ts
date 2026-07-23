import type {
  SourceTutorOutcome,
  SourceTutorSourceReference,
} from "@/lib/ai/source-tutor";

export type SourceWorkspaceFeedback = {
  type: "success" | "error";
  message: string;
};

export type SourceTutorMessage = {
  role: "user" | "model";
  text: string;
  outcome?: SourceTutorOutcome;
  sourcesUsed?: SourceTutorSourceReference[];
};
