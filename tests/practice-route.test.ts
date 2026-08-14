import { describe, expect, it } from "vitest";
import { nextConfig } from "@/next.config";

describe("Practice route compatibility", () => {
  it("keeps the legacy spelling as a permanent redirect", async () => {
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toEqual(
      expect.arrayContaining([
        {
          source: "/dashboard/practise",
          destination: "/dashboard/practice",
          permanent: true,
        },
      ])
    );
  });
});
