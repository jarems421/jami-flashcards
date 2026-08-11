/**
 * What Jami will accept as a password.
 *
 * Firebase's own floor is six characters and nothing else, which means
 * `123456` is a valid password for an account holding somebody's entire study
 * history. Firebase enforces its floor server-side whatever the form says, so
 * this is the only place a real one exists -- and it has to be checked before
 * the account is created, because afterwards there is nothing to refuse.
 *
 * The rules here are the ones that actually stop the passwords that get broken,
 * rather than the ones that look strict. Length does most of the work: a long
 * passphrase beats a short password with a symbol bolted on, and demanding
 * symbols mostly produces `Password1!`, which is on every list there is. So
 * length is the requirement, and the rest are refusals of the specific things
 * that make a long password worthless -- being a known password, being one
 * character repeated, or being the email address it protects.
 */

/**
 * Ten, not eight.
 *
 * Eight is the number everyone uses and it is a generation out of date: eight
 * characters of anything is inside range for an offline attack on a leaked
 * hash. Ten with no other requirement rejects more real-world-bad passwords
 * than eight with a symbol rule, and is easier to type on an iPad.
 */
export const PASSWORD_MINIMUM_LENGTH = 10;

/**
 * A ceiling, because there has to be one and it should be generous.
 *
 * Long inputs are worth bounding on principle rather than because anything here
 * struggles with them. Well past any passphrase somebody would actually choose.
 */
export const PASSWORD_MAXIMUM_LENGTH = 256;

/**
 * The passwords that get tried first.
 *
 * Not a serious blocklist -- those run to millions of entries and belong behind
 * an API. This is the short head of the distribution: what someone picks when
 * they are not really choosing, and what a bot tries in its first hundred
 * guesses. Stored lowercased and compared that way, since capitalising the
 * first letter fools nobody.
 */
const WELL_KNOWN_PASSWORDS = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "password1234",
  "passw0rd123",
  "123456789",
  "1234567890",
  "12345678910",
  "qwertyuiop",
  "qwerty12345",
  "letmein123",
  "welcome123",
  "iloveyou123",
  "admin12345",
  "abc123456789",
  "jamiflashcards",
  "flashcards123",
]);

export type PasswordProblem =
  | "too-short"
  | "too-long"
  | "well-known"
  | "too-repetitive"
  | "contains-email";

export type PasswordAssessment = {
  /** Whether the password may be used at all. */
  acceptable: boolean;
  /** Every rule it currently fails, in the order worth showing them. */
  problems: PasswordProblem[];
  /** How far past the floor it is, 0 to 4. Only meaningful once acceptable. */
  strength: number;
  /** What that score is called. */
  label: "Too short" | "Weak" | "Fair" | "Good" | "Strong";
};

/** The part of an email before the @, which is what people reuse. */
function getEmailLocalPart(email: string) {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.indexOf("@");
  return at > 0 ? trimmed.slice(0, at) : trimmed;
}

/**
 * Whether the password is one character, or one short run, repeated.
 *
 * `aaaaaaaaaaaa` and `abababababab` both clear a length rule and neither is
 * worth anything. Checked up to a four-character unit, past which a repeating
 * pattern is long enough to be a real passphrase choice.
 */
function isRepetitive(password: string) {
  const lower = password.toLowerCase();
  for (let unit = 1; unit <= 4; unit += 1) {
    if (lower.length < unit * 3) continue;
    if (lower.length % unit !== 0) continue;
    const head = lower.slice(0, unit);
    if (lower === head.repeat(lower.length / unit)) return true;
  }
  return false;
}

/**
 * How much variety the password draws on, as a count of character classes.
 *
 * Used for the strength score shown to the reader, never as a requirement.
 * Requiring classes is what produces `Password1!`; showing them rewards a
 * password that has them without punishing a long passphrase that does not.
 */
function countCharacterClasses(password: string) {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/];
  return classes.filter((pattern) => pattern.test(password)).length;
}

const LABELS: PasswordAssessment["label"][] = [
  "Weak",
  "Weak",
  "Fair",
  "Good",
  "Strong",
];

export function assessPassword(
  password: string,
  email = ""
): PasswordAssessment {
  const problems: PasswordProblem[] = [];

  if (password.length < PASSWORD_MINIMUM_LENGTH) problems.push("too-short");
  if (password.length > PASSWORD_MAXIMUM_LENGTH) problems.push("too-long");
  if (WELL_KNOWN_PASSWORDS.has(password.toLowerCase())) {
    problems.push("well-known");
  }
  if (password.length > 0 && isRepetitive(password)) {
    problems.push("too-repetitive");
  }

  const localPart = getEmailLocalPart(email);
  if (
    localPart.length >= 3 &&
    password.toLowerCase().includes(localPart)
  ) {
    problems.push("contains-email");
  }

  if (problems.length > 0) {
    return {
      acceptable: false,
      problems,
      strength: 0,
      label: password.length < PASSWORD_MINIMUM_LENGTH ? "Too short" : "Weak",
    };
  }

  /*
   * Past the floor, length alone can reach the top of the scale.
   *
   * The variety credit deliberately cannot: if the only route to "Strong" runs
   * through three character classes, the scale is telling people to write
   * `Password1!` -- which is the advice this policy exists to avoid giving. A
   * long passphrase is a strong password and the meter has to say so.
   */
  const lengthCredit =
    password.length >= 24
      ? 4
      : password.length >= 20
        ? 3
        : password.length >= 16
          ? 2
          : password.length >= 13
            ? 1
            : 0;
  const varietyCredit = countCharacterClasses(password) >= 3 ? 1 : 0;
  const strength = Math.min(4, lengthCredit + varietyCredit);

  return { acceptable: true, problems: [], strength, label: LABELS[strength] };
}

/** What to tell someone about the first thing their password fails. */
export function describePasswordProblem(problem: PasswordProblem): string {
  switch (problem) {
    case "too-short":
      return `Use at least ${PASSWORD_MINIMUM_LENGTH} characters. A few ordinary words together works well.`;
    case "too-long":
      return `Keep it under ${PASSWORD_MAXIMUM_LENGTH} characters.`;
    case "well-known":
      return "That is one of the first passwords anyone would guess. Choose something else.";
    case "too-repetitive":
      return "That is one short pattern repeated, which is as easy to guess as it is to type.";
    case "contains-email":
      return "Leave your email address out of your password.";
  }
}

/** The single thing to say about a password, or null when it is fine. */
export function getPasswordRequirementMessage(
  password: string,
  email = ""
): string | null {
  const assessment = assessPassword(password, email);
  const [firstProblem] = assessment.problems;
  return firstProblem ? describePasswordProblem(firstProblem) : null;
}
