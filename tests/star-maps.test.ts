import { describe, expect, it } from "vitest";
import { findStarMap, STAR_MAPS, starMapPoints } from "@/lib/constellation/star-maps";

describe("real constellations", () => {
  it("fit on the canvas, with every line reaching a real star", () => {
    for (const map of STAR_MAPS) {
      expect(map.starCount, map.key).toBeGreaterThan(3);
      const ids = new Set(map.stars.map((star) => star.id));
      for (const star of map.stars) {
        expect(Number.isFinite(star.x) && Number.isFinite(star.y), map.key).toBe(true);
        expect(star.x >= 0 && star.x <= 100 && star.y >= 0 && star.y <= 100, map.key).toBe(true);
      }
      for (const [a, b] of map.lines) {
        expect(ids.has(a) && ids.has(b), `${map.key}: ${a}-${b}`).toBe(true);
      }
    }
  });

  /*
   * Orientation is the whole point of using a star map. As Orion stands in the
   * sky: Betelgeuse at the top left, Rigel at the bottom right, and the belt a
   * short, nearly straight line across the middle.
   */
  it("draw Orion the right way round", () => {
    const orion = starMapPoints("orion")!;
    expect(orion.betelgeuse[0]).toBeLessThan(orion.rigel[0]);
    expect(orion.betelgeuse[1]).toBeLessThan(orion.rigel[1]);
    expect(orion.meissa[1]).toBeLessThan(orion.betelgeuse[1]);

    const [alnitak, alnilam, mintaka] = [orion.alnitak, orion.alnilam, orion.mintaka];
    const expectedY = alnitak[1] + ((alnilam[0] - alnitak[0]) / (mintaka[0] - alnitak[0])) * (mintaka[1] - alnitak[1]);
    expect(Math.abs(alnilam[1] - expectedY)).toBeLessThan(3);
  });

  it("put the Plough's handle to the left of its bowl, as it hangs in spring", () => {
    const plough = starMapPoints("plough")!;
    expect(plough.alkaid[0]).toBeLessThan(plough.megrez[0]);
    expect(plough.megrez[0]).toBeLessThan(plough.dubhe[0]);
  });

  it("keep the Little Dipper recognisable right beside the pole", () => {
    const dipper = starMapPoints("little-dipper")!;
    const xs = Object.values(dipper).map(([x]) => x);
    const ys = Object.values(dipper).map(([, y]) => y);
    // Plotted naively the stars spread fifteen hours wide; projected, the shape stays compact.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(20);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(20);
  });

  it("are found by the names people use for them", () => {
    expect(findStarMap("The Big Dipper")?.key).toBe("plough");
    expect(findStarMap("scorpio")?.key).toBe("scorpius");
    expect(findStarMap("Southern Cross")?.key).toBe("crux");
    expect(findStarMap("little-dipper")?.key).toBe("little-dipper");
    expect(findStarMap("a teapot")).toBeNull();
  });
});
