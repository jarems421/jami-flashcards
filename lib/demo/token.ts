export function hasDemoClaim(decodedToken: unknown): boolean {
  if (!decodedToken || typeof decodedToken !== "object") {
    return false;
  }

  const tokenWithClaims = decodedToken as { demo?: unknown };
  return tokenWithClaims.demo === true;
}
