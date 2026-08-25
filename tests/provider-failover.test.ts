import { describe, expect, it } from "vitest";
import { failoverProvidersFor } from "@/lib/ai/provider-policy";

/**
 * The failover exists for one measured failure: the supervisor's endpoint
 * answers `{}` in sticky bursts — eight of thirteen affected calls returned it
 * on every attempt — so retrying the same endpoint is close to worthless while
 * moving elsewhere is not.
 *
 * It is deliberately not load balancing. Normal traffic still goes to the
 * primary; a request has to ask for the failover.
 */
describe("deliberate provider failover", () => {
  it("offers the worker an independent full-context endpoint", () => {
    expect(failoverProvidersFor("worker", {} as unknown as NodeJS.ProcessEnv)).toEqual(["novita"]);
  });

  it("offers the supervisor a second endpoint for the same model", () => {
    expect(failoverProvidersFor("supervisor", {} as unknown as NodeJS.ProcessEnv)).toEqual(["deepinfra"]);
  });

  /**
   * Roles without a measured independent endpoint still fail closed.
   */
  it("offers none to the roles that have not needed one", () => {
    for (const role of ["juror", "research", "documentVision"] as const) {
      expect(failoverProvidersFor(role, {} as unknown as NodeJS.ProcessEnv)).toEqual([]);
    }
  });

  it("can be redirected by configuration without a code change", () => {
    expect(
      failoverProvidersFor("supervisor", {
        OPENROUTER_SUPERVISOR_FAILOVER_PROVIDERS: "gmicloud, streamlake",
      } as unknown as NodeJS.ProcessEnv)
    ).toEqual(["gmicloud", "streamlake"]);
  });

  it("falls back to the default when the setting is blank", () => {
    expect(
      failoverProvidersFor("supervisor", {
        OPENROUTER_SUPERVISOR_FAILOVER_PROVIDERS: "  ",
      } as unknown as NodeJS.ProcessEnv)
    ).toEqual(["deepinfra"]);
  });

  /**
   * The failover is a separate list from the primary allowlist on purpose. If
   * it were merged, OpenRouter would balance across both and the endpoint that
   * returns `{}` would keep serving a share of ordinary traffic.
   */
  it("is not the primary allowlist", () => {
    expect(failoverProvidersFor("supervisor", {} as unknown as NodeJS.ProcessEnv)).not.toContain("parasail");
  });
});
