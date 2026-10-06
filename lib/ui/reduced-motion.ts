/** The reduced-motion media query, for a subscription or a one-off check. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Whether the person has asked for less motion, read at this moment.
 *
 * For a decision made as an animation starts. A component that renders
 * differently with reduced motion should subscribe with `useMediaQuery`
 * instead, so it follows a change made while it is open. False on the server.
 */
export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.(REDUCED_MOTION_QUERY).matches === true;
}
