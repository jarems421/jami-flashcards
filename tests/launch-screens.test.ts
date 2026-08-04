import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getLaunchScreenLinks } from "@/lib/app/launch-screens";
import launchScreens from "@/lib/app/launch-screens.json";

/**
 * iOS shows nothing at all while an installed app opens unless handed a launch
 * image matching the device exactly. A near miss is ignored, so these check the
 * two ways that silently produces a blank launch: a query iOS will not match,
 * and a link pointing at an image nobody generated.
 */

describe("getLaunchScreenLinks", () => {
  const links = getLaunchScreenLinks();

  it("covers both orientations of every device", () => {
    expect(links).toHaveLength(launchScreens.devices.length * 2);
  });

  it("names everything iOS matches on", () => {
    for (const link of links) {
      expect(link.media).toMatch(/\(device-width: \d+px\)/);
      expect(link.media).toMatch(/\(device-height: \d+px\)/);
      // Omitting the ratio makes the query match two different devices, and
      // the wrong one gets an image of the wrong size, which iOS discards.
      expect(link.media).toMatch(/\(-webkit-device-pixel-ratio: \d+\)/);
      expect(link.media).toMatch(/\(orientation: (portrait|landscape)\)/);
    }
  });

  it("describes each device's own screen rather than a shared one", () => {
    const queries = links.map((link) => link.media);

    expect(new Set(queries).size).toBe(queries.length);
  });

  /**
   * The failure this is really for: adding a device to the list without
   * regenerating the images, which costs that device its launch screen and
   * shows nothing at all instead.
   */
  it("points at images that have actually been generated", () => {
    const missing = links
      .map((link) => link.url)
      .filter((url) => !existsSync(join(process.cwd(), "public", url)));

    expect(missing).toEqual([]);
  });

  it("orients each image the way its query claims", () => {
    for (const link of links) {
      const wantsPortrait = link.media.includes("orientation: portrait");
      expect(link.url.endsWith("-portrait.png")).toBe(wantsPortrait);
    }
  });
});
