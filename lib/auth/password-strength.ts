/**
 * What Jami will accept as a password.
 *
 * Firebase's own floor is six characters and nothing else, which means
 * `123456` is a valid password for an account holding somebody's entire study
 * history. Accounts are created by Jami's server now, which checks this before
 * it creates anything; the form checks it first so the answer is instant.
 *
 * The rules here are the ones that actually stop the passwords that get broken,
 * rather than the ones that look strict. Length does most of the work: a long
 * passphrase beats a short password with a symbol bolted on, and demanding
 * symbols mostly produces `Password1!`, which is on every list there is. So
 * length is the requirement, and the rest are refusals of the specific things
 * that make a password worthless whatever its length -- being a known
 * password, being a straight run of keys, being one character repeated, or
 * being the email address it protects.
 */

/**
 * Eight, not six and not ten.
 *
 * It was ten, which is defensible in isolation and turned students away at the
 * first screen on a phone. Eight is the common floor, and what made ten feel
 * necessary -- the short, obvious passwords -- is refused directly instead, by
 * the list and the straight-run check below. Six lets through `abc123`-grade
 * passwords faster than any list can keep up with.
 */
export const PASSWORD_MINIMUM_LENGTH = 8;

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
  "passw0rd",
  "passw0rd1",
  "passw0rd123",
  "p@ssw0rd",
  "p@ssword",
  "12345678",
  "123456789",
  "1234567890",
  "12345678910",
  "11223344",
  "12341234",
  "123123123",
  "qwertyui",
  "qwertyuiop",
  "qwerty12",
  "qwerty123",
  "qwerty1234",
  "qwerty12345",
  "1q2w3e4r",
  "1q2w3e4r5t",
  "zaq12wsx",
  "asdfghjk",
  "asdfghjkl",
  "iloveyou",
  "iloveyou1",
  "iloveyou123",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "superman",
  "starwars",
  "trustno1",
  "whatever",
  "computer",
  "letmein1",
  "letmein123",
  "welcome1",
  "welcome123",
  "admin123",
  "admin12345",
  "abcd1234",
  "abc12345",
  "abc123456",
  "abc123456789",
  "a1b2c3d4",
  "monkey123",
  "dragon123",
  "jamiflashcards",
  "jami1234",
  "flashcards",
  "flashcards123",
  "revision",
  "revision1",
  "homework",
  "student1",
  "student123",
]);

/**
 * Whether the whole password is a straight run up or down the alphabet or the
 * digits: `abcdefgh`, `23456789`, `87654321`.
 *
 * These are what a list can never hold every one of, and at an eight-character
 * floor they matter: each is the first thing tried at its length.
 */
function isStraightRun(password: string) {
  const lower = password.toLowerCase();
  if (lower.length < 4 || !/^([a-z]+|[0-9]+)$/.test(lower)) return false;
  const step = lower.charCodeAt(1) - lower.charCodeAt(0);
  if (step !== 1 && step !== -1) return false;
  for (let index = 2; index < lower.length; index += 1) {
    if (lower.charCodeAt(index) - lower.charCodeAt(index - 1) !== step) {
      return false;
    }
  }
  return true;
}

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
  if (
    WELL_KNOWN_PASSWORDS.has(password.toLowerCase()) ||
    isStraightRun(password)
  ) {
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
    password.length >= 20
      ? 4
      : password.length >= 16
        ? 3
        : password.length >= 12
          ? 2
          : password.length >= 10
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
