import type { LearningAction, LearningTopicState } from "@/lib/learning/types";

/**
 * The things Jami can actually do about a learning need.
 *
 * This is a layer *above* the Learning Engine, not inside it, and the division
 * is the point. The engine answers "what does this student need?" and its six
 * decisions -- diagnose, teach, practise, retrieve, reinforce, leave alone --
 * stay exactly as they are. This answers a different question: "given what
 * material actually exists, what can be done about that need right now?"
 *
 * Those are genuinely different questions. A concept that needs practice and a
 * concept that needs practice *and has no questions to practise with* call for
 * the same decision and different actions, and the engine has no business
 * knowing which questions exist.
 *
 * Nothing here estimates mastery, reads evidence, or overrides a decision. It
 * takes the decision as given and chooses how to carry it out.
 */

export type InterventionType =
  /** Write targeted cards, because there is little or nothing to retrieve from. */
  | "create_flashcards"
  /** Generate targeted questions, because there is too little application work. */
  | "create_practice"
  /** The specification asks for this and the student has almost no material on it. */
  | "fill_specification_gap"
  /** Real exam questions, where application is what needs testing. */
  | "past_paper"
  /** The scheduler's own queue: they know it, recall is slipping. */
  | "retrieve"
  /** Teach it, because there is good evidence of a real gap. */
  | "teach"
  /** Consolidate something recently gained. */
  | "reinforce"
  /** Material exists and has never been tested against. */
  | "review_material";

/**
 * What can be carried out for this concept at this moment.
 *
 * Supplied by the caller from the student's own material and the deployment's
 * capabilities, never inferred here. An intervention nobody can perform is
 * worse than no intervention: it is a promise the product cannot keep.
 */
export type InterventionAvailability = {
  /** Cards exist on this concept. */
  hasFlashcards: boolean;
  /**
   * How many, where the caller knows.
   *
   * The threshold matters: offering to write cards for a concept that has two
   * is useful, and offering for one that has thirty is noise. Absent means the
   * count is unknown, and the rule falls back to presence alone rather than
   * guessing.
   */
  flashcardCount?: number;
  /**
   * Generated practice questions exist for it, or undefined for not looked.
   *
   * The banks are expensive to ask -- the corpus scan costs more than a whole
   * profile build -- so most callers have not. Undefined therefore means
   * "unknown", and unknown is not the same as none: an action is still worth
   * offering when nobody has checked, because the surface it leads to will
   * say so if there is nothing there. What unknown may never do is justify
   * telling a student their specification is uncovered.
   */
  hasPractice?: boolean;
  /** The licensed corpus can serve real questions for it, or undefined for not looked. */
  hasPastPaper?: boolean;
  /** Notebooks or sources are linked to it. */
  hasMaterial: boolean;
  /** This deployment can generate cards for the student. */
  canCreateFlashcards: boolean;
  /** This deployment can generate practice questions. */
  canCreatePractice: boolean;
};

export type InterventionChoice = {
  type: InterventionType;
  /**
   * Why this action, in a form the UI turns into a sentence.
   *
   * A code rather than prose so the explanation is derived from the decision
   * rather than written next to it, and so a model is never asked to invent a
   * reason. See `describeIntervention` in the UI layer.
   */
  because: InterventionReason;
  /**
   * Actions that would also have served, best first.
   *
   * Kept because "practise this" and "make some cards first" are often both
   * reasonable, and a student who cannot face one may take the other.
   */
  alternatives: InterventionType[];
};

export type InterventionReason =
  /** The specification asks for it and there is almost nothing to work with. */
  | "no_material_for_specification_concept"
  /** Weak, and too little to retrieve from. */
  | "weak_without_flashcards"
  /** Weak, and cards exist to work through. */
  | "weak_with_flashcards"
  /** Weak, and what is missing is application work. */
  | "weak_without_application"
  /** Recall is holding up and application is not. */
  | "recall_strong_application_weak"
  /** Studied, never tested. */
  | "material_never_tested"
  /**
   * On the course, and nothing recorded against it either way.
   *
   * Distinct from both neighbours on purpose. It is not
   * `material_never_tested`, which describes material that exists and has not
   * been used -- here there may be none. And it is not
   * `no_material_for_specification_concept`, which is a claim that the banks
   * were asked and hold nothing; this is what is said when nobody asked.
   */
  | "declared_but_unevidenced"
  /** Due, and they know it. */
  | "due_for_retrieval"
  /** Recently gained, worth locking in. */
  | "recent_gain"
  /** Well-evidenced gap: teach it. */
  | "evidenced_knowledge_gap";

/**
 * How little material counts as none worth working from.
 *
 * Two cards is not a revision resource. Set low deliberately: the cost of
 * offering to make cards for a concept that has three is a student declining
 * once, and the cost of never offering is a gap that stays open.
 */
export const MIN_USEFUL_FLASHCARDS = 3;

/**
 * Whether making cards would actually add something.
 *
 * The product rule, and it is a rule about usefulness rather than weakness:
 * Jami offers to write cards when the student lacks them, never merely because
 * a concept is weak. A weak concept with thirty cards does not need more cards
 * -- it needs the student to work through the ones they have.
 */
export function needsMoreFlashcards(availability: InterventionAvailability) {
  if (!availability.canCreateFlashcards) return false;
  if (availability.flashcardCount !== undefined) {
    return availability.flashcardCount < MIN_USEFUL_FLASHCARDS;
  }
  return !availability.hasFlashcards;
}

/**
 * Whether a concept has enough of its own material to study from at all.
 *
 * Unknown counts as workable, deliberately. This gates the claim that a
 * specification concept has nothing behind it, and that claim needs every
 * bank to have actually answered: a corpus nobody asked about is not a corpus
 * that is empty, and an outage must not reach a student as a hole in their
 * syllabus.
 */
export function hasWorkableMaterial(availability: InterventionAvailability) {
  return (
    availability.hasFlashcards ||
    availability.hasMaterial ||
    availability.hasPractice !== false ||
    availability.hasPastPaper !== false
  );
}

/**
 * Whether application evidence is the thing that is missing.
 *
 * The distinction the concept hierarchy was built to preserve: a student can
 * recall a method reliably and still lose marks using it under exam
 * conditions, and those need different work. Read from the sources behind the
 * signal rather than from mastery, because it is about *what kind* of evidence
 * exists, not how good it is.
 */
export function lacksApplicationEvidence(state: LearningTopicState) {
  const sources = state.signal?.evidence ?? [];
  if (sources.length === 0) return false;
  return !sources.includes("past-paper") && !sources.includes("practice");
}

function firstAvailable(
  candidates: readonly InterventionType[],
  availability: InterventionAvailability
): InterventionType[] {
  return candidates.filter((type) => {
    switch (type) {
      case "create_flashcards":
        return availability.canCreateFlashcards;
      case "create_practice":
      case "fill_specification_gap":
        return availability.canCreatePractice || availability.canCreateFlashcards;
      case "past_paper":
        // Unknown is offerable; only a bank known to be empty rules it out.
        return availability.hasPastPaper !== false;
      case "retrieve":
        return availability.hasFlashcards;
      case "review_material":
        return availability.hasMaterial || availability.hasFlashcards;
      case "teach":
      case "reinforce":
        return true;
    }
  });
}

/**
 * The action to offer for one concept, or nothing.
 *
 * Deterministic and explainable by construction: every branch is a rule about
 * the decision and the material, in a fixed order, and the reason travels with
 * the choice. No adaptive policy, no ranking learned from outcomes -- those
 * need data that does not exist yet, and guessing at them now would make the
 * first real intervention data impossible to interpret.
 *
 * Returns nothing when the engine says leave it alone, and nothing when no
 * available action fits: an offer the product cannot honour is worse than
 * silence.
 */
export function selectIntervention(
  state: LearningTopicState,
  availability: InterventionAvailability
): InterventionChoice | undefined {
  const decision = state.decision;
  if (!decision || decision.action === "leave_alone") return undefined;

  const choose = (
    because: InterventionReason,
    candidates: readonly InterventionType[]
  ): InterventionChoice | undefined => {
    const usable = firstAvailable(candidates, availability);
    const [type, ...alternatives] = usable;
    return type ? { type, because, alternatives } : undefined;
  };

  /*
   * Coverage comes first, and it is not a claim about the student.
   *
   * A specification concept with no material is a gap in what Jami can teach
   * from, which is a different statement from "you are weak at this" -- and
   * the engine will have said `diagnose/not_yet_assessed` precisely because it
   * has no evidence either way. Offering to build the material is the honest
   * action; testing them on nothing is not.
   */
  if (
    state.source === "specification" &&
    state.declared &&
    !hasWorkableMaterial(availability)
  ) {
    return choose("no_material_for_specification_concept", [
      "fill_specification_gap",
      "create_flashcards",
      "create_practice",
    ]);
  }

  switch (decision.action) {
    case "diagnose": {
      // Seen but never tested is a different thing from never seen at all.
      if (decision.reason === "untested_exposure") {
        return choose("material_never_tested", [
          "review_material",
          "create_practice",
          "past_paper",
        ]);
      }
      /*
       * Declared on the course, nothing answered, and the banks unasked.
       *
       * Worth being careful about the words: this is not a weakness -- the
       * engine reached `diagnose` precisely because it has no evidence either
       * way -- and it is not a coverage gap, because establishing one needs
       * the banks to have answered. It is simply a part of the course with
       * nothing recorded against it.
       */
      return choose("declared_but_unevidenced", [
        "create_practice",
        "past_paper",
        "review_material",
        "create_flashcards",
      ]);
    }

    case "teach":
      return choose("evidenced_knowledge_gap", [
        "teach",
        "create_flashcards",
        "review_material",
      ]);

    case "practice": {
      if (lacksApplicationEvidence(state)) {
        // They can recall it. What is untested is using it.
        return choose("recall_strong_application_weak", [
          "past_paper",
          "create_practice",
        ]);
      }
      if (needsMoreFlashcards(availability)) {
        return choose("weak_without_flashcards", ["create_flashcards", "create_practice"]);
      }
      if (!availability.hasPractice && !availability.hasPastPaper) {
        return choose("weak_without_application", ["create_practice", "past_paper"]);
      }
      return choose("weak_with_flashcards", ["create_practice", "past_paper", "retrieve"]);
    }

    case "retrieve":
    case "review":
      return choose("due_for_retrieval", ["retrieve", "create_flashcards", "review_material"]);

    case "reinforce":
      return choose("recent_gain", ["retrieve", "create_practice", "past_paper"]);

    default:
      return undefined;
  }
}

/** Every decision the engine can reach, so a new one cannot be silently unhandled. */
export const INTERVENTION_DECISIONS: readonly LearningAction[] = [
  "diagnose",
  "teach",
  "practice",
  "retrieve",
  "review",
  "reinforce",
  "leave_alone",
];
