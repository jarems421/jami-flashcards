import type { LearningAction, LearningTopicSource, LearningTopicState } from "@/lib/learning/types";

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
  /**
   * This deployment can teach it directly, in a Revision Session.
   *
   * Absent means no. When it is on, `teach` can be carried out for any
   * concept -- a session needs no page and no material of its own -- and it is
   * the first answer to a decision to teach. See docs/revision-sessions.md.
   */
  canRunRevisionSession?: boolean;
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
  /**
   * For `recall_strong_application_weak`, the student's own Topic whose cards
   * the recall reading came from, when that is not the concept itself -- so
   * the sentence can name what they actually drilled.
   */
  recallFrom?: { topicKey: string; label: string };
};

/**
 * Why an action is offered, as something the student can be told.
 *
 * Each one is a claim about the student or their material, and each is only
 * chosen when the engine's decision and the evidence make that claim true.
 * `tests/learning-student-journeys.test.ts` holds every reachable decision to
 * it: a sentence that is true for most students who see it is still a lie to
 * the rest.
 */
export type InterventionReason =
  /** The specification asks for it and there is almost nothing to work with. */
  | "no_material_for_specification_concept"
  /** A well-evidenced weakness, and too little to revise from. */
  | "weak_without_flashcards"
  /** Recall is holding up and application is not. */
  | "recall_strong_application_weak"
  /** Some answers have gone wrong, too few to call it a weakness. */
  | "suspected_gap"
  /** Answers are getting worse than they were. */
  | "slipping"
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
  /** Cards on it are due. */
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
 * Where each action can actually be carried out, by what kind of concept it is.
 *
 * The surfaces are not interchangeable. A specification concept has no page
 * and no card queue of its own: it is worked on through Past Paper Practice,
 * narrowed to it, or through material Jami writes for it, and the writing
 * route only accepts specification concepts. A student's Topic or a deck is
 * the reverse: it has a page and a queue, and neither the corpus nor the
 * writer can be pointed at it. Offering an action on the wrong kind of
 * concept is a button that says one thing and opens another.
 */
function canCarryOut(
  type: InterventionType,
  source: LearningTopicSource,
  availability: InterventionAvailability
) {
  const specification = source === "specification";
  switch (type) {
    case "create_flashcards":
      // Writing cards is only offered where cards are what is missing.
      return specification && needsMoreFlashcards(availability);
    case "fill_specification_gap":
      // Resolves to cards: a concept with nothing behind it needs something to study from first.
      return specification && availability.canCreateFlashcards;
    case "create_practice":
      return specification && availability.canCreatePractice;
    case "past_paper":
      // Unknown is offerable; only a bank known to be empty rules it out.
      return specification && availability.hasPastPaper !== false;
    case "retrieve":
      return !specification && availability.hasFlashcards;
    case "review_material":
      return !specification && (availability.hasMaterial || availability.hasFlashcards);
    case "teach":
      // A Revision Session can teach any concept; without one, only a Topic
      // or deck has a page to open.
      return availability.canRunRevisionSession === true || !specification;
    case "reinforce":
      return !specification;
  }
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
    const usable = candidates.filter((type) => canCarryOut(type, state.source, availability));
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
   * action; testing them on nothing is not. Anything already answered on it
   * came from somewhere, so recorded work rules the claim out.
   */
  if (
    state.source === "specification" &&
    state.declared &&
    !state.signal &&
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
      /*
       * Seen but never tested is a different thing from never seen at all.
       *
       * Only actions that test. Reopening the notes is what the student has
       * already done; a check that cannot ask them anything is not offered at
       * all rather than offered as reading.
       */
      if (decision.reason === "untested_exposure") {
        return choose("material_never_tested", ["retrieve", "past_paper", "create_practice"]);
      }
      /*
       * Answered, but too little to call.
       *
       * Never worded as "nothing recorded": the engine reaches this with
       * answers in hand, and a student told their work does not exist has been
       * misled about the one thing they can check.
       */
      if (decision.reason === "low_confidence") {
        return choose("suspected_gap", ["past_paper", "create_practice", "retrieve"]);
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
        "create_flashcards",
      ]);
    }

    case "teach": {
      /*
       * Taught directly, when a Revision Session can do it. Cards first was
       * the answer while nothing could teach: a student with little to revise
       * from needed something to revise from. A session is the teaching, so
       * it comes first whatever material exists.
       */
      if (availability.canRunRevisionSession) {
        const session = choose("evidenced_knowledge_gap", [
          "teach",
          "review_material",
          "retrieve",
          "past_paper",
          "create_practice",
        ]);
        if (session) return session;
      }
      // Cards first when there are too few to revise from; otherwise work through it.
      return (
        (needsMoreFlashcards(availability)
          ? choose("weak_without_flashcards", ["create_flashcards", "create_practice"])
          : undefined) ??
        choose("evidenced_knowledge_gap", [
          "teach",
          "review_material",
          "retrieve",
          "past_paper",
          "create_practice",
        ])
      );
    }

    case "practice": {
      if (state.applicationGap) {
        // They can recall it. What is failing is using it.
        const choice = choose("recall_strong_application_weak", ["past_paper", "create_practice"]);
        if (!choice) return undefined;
        return state.applicationGap.recallFrom === state.topicKey
          ? choice
          : {
              ...choice,
              recallFrom: {
                topicKey: state.applicationGap.recallFrom,
                label: state.applicationGap.recallLabel,
              },
            };
      }
      // The only other route here: marked work that was strong and is slipping.
      return choose("slipping", ["past_paper", "create_practice", "review_material"]);
    }

    case "retrieve":
      return decision.reason === "knowledge_decay"
        ? choose("slipping", ["retrieve", "review_material", "create_practice"])
        : choose("due_for_retrieval", ["retrieve", "review_material"]);

    case "review":
      return choose("slipping", ["retrieve", "past_paper", "create_practice", "review_material"]);

    case "reinforce":
      return choose("recent_gain", ["retrieve", "past_paper", "create_practice"]);

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
