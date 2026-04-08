/**
 * Extract a Bearer token from an Authorization header.
 * Returns null when the header is missing or malformed.
 */
export function getBearerToken(header: string | null): string | null {
  const match = header?.match(/^Bearer\s+(\S+)$/);
  return match ? match[1] : null;
}
