/**
 * "Did you mean ...@gmail.com?" for the address somebody is signing up with.
 *
 * A mistyped domain is the one mistake that cannot be fixed later: the code
 * never arrives, and if it somehow did, a password reset never would. So the
 * form offers the likely correction before the code is sent. It is only ever a
 * suggestion -- plenty of real addresses sit one letter away from a big
 * provider, which is why every domain on this list is also accepted as itself.
 */

/**
 * The providers students actually use, and the ones their near-misses land
 * near. UK-first, since that is who Jami is for.
 */
const POPULAR_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "outlook.co.uk",
  "live.com",
  "live.co.uk",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "btinternet.com",
  "sky.com",
  "virginmedia.com",
  "talktalk.net",
  "protonmail.com",
  "proton.me",
  "mail.com",
  "gmx.com",
  "gmx.co.uk",
];

const KNOWN_DOMAINS = new Set(POPULAR_DOMAINS);

/**
 * Endings that are almost always a slip for `.com`: the letter next to `m`,
 * a dropped letter, or the `.co` of `.co.uk` with the rest never typed.
 */
const TLD_SLIPS: Record<string, string> = {
  ".con": ".com",
  ".cpm": ".com",
  ".vom": ".com",
  ".xom": ".com",
  ".comm": ".com",
  ".cm": ".com",
  ".om": ".com",
  ".co.ukk": ".co.uk",
  ".couk": ".co.uk",
};

/**
 * Edit distance counting a swap of two neighbouring letters as one edit, since
 * `gmial` is one slip of the fingers, not two.
 */
function editDistance(a: string, b: string) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table: number[][] = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => (row === 0 ? col : col === 0 ? row : 0))
  );

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      table[row][col] = Math.min(
        table[row - 1][col] + 1,
        table[row][col - 1] + 1,
        table[row - 1][col - 1] + cost
      );
      if (
        row > 1 &&
        col > 1 &&
        a[row - 1] === b[col - 2] &&
        a[row - 2] === b[col - 1]
      ) {
        table[row][col] = Math.min(table[row][col], table[row - 2][col - 2] + 1);
      }
    }
  }

  return table[a.length][b.length];
}

/** The corrected address, or null when there is nothing worth suggesting. */
export function suggestEmailCorrection(email: string): string | null {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();
  if (KNOWN_DOMAINS.has(domain)) return null;

  for (const [slip, fix] of Object.entries(TLD_SLIPS)) {
    if (domain.endsWith(slip)) {
      const fixed = domain.slice(0, -slip.length) + fix;
      if (KNOWN_DOMAINS.has(fixed)) return `${local}@${fixed}`;
    }
  }

  /*
   * One edit for short domains, two for longer ones: `gmal.com` is plainly a
   * slip, but two edits from a seven-letter domain reaches real, unrelated
   * ones. Ties go to the earlier, more popular domain.
   */
  let best: { domain: string; distance: number } | null = null;
  for (const candidate of POPULAR_DOMAINS) {
    const allowed = candidate.length >= 10 ? 2 : 1;
    const distance = editDistance(domain, candidate);
    if (distance > 0 && distance <= allowed && (!best || distance < best.distance)) {
      best = { domain: candidate, distance };
    }
  }

  return best ? `${local}@${best.domain}` : null;
}
