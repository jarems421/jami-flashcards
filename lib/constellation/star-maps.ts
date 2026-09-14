/**
 * Real constellations, from where their stars actually are.
 *
 * Asked for Orion, every model tried drew something Orion-shaped only in its
 * own imagination: an X, a stick figure, a staple. A real constellation is a
 * fact rather than a design, so these are worked out from each star's right
 * ascension and declination instead of being drawn -- projected onto a flat
 * plane centred on the constellation, the way it looks overhead, east on the
 * left and north up.
 *
 * Each star keeps its apparent magnitude too. A sky with fewer stars than the
 * constellation loses the faintest first, which is how the pattern actually
 * fades on a hazy night, and the brightest stars a student has earned take the
 * brightest places.
 */

type StarMapSource = {
  key: string;
  name: string;
  aliases: string[];
  /** Right ascension in hours, declination in degrees (J2000), apparent magnitude. */
  stars: Record<string, [number, number, number]>;
  lines: [string, string][];
};

export type StarMapStar = { id: string; x: number; y: number; magnitude: number };

export type StarMap = {
  key: string;
  name: string;
  starCount: number;
  /** Each star's place on the square drawing canvas, 0 to 100. */
  stars: StarMapStar[];
  lines: [string, string][];
};

const SOURCES: StarMapSource[] = [
  {
    key: "orion",
    name: "Orion",
    aliases: ["orion the hunter", "the hunter", "hunter"],
    stars: {
      meissa: [5.585, 9.934, 3.39],
      betelgeuse: [5.919, 7.407, 0.5],
      bellatrix: [5.419, 6.35, 1.64],
      alnitak: [5.679, -1.943, 1.77],
      alnilam: [5.604, -1.202, 1.69],
      mintaka: [5.533, -0.299, 2.23],
      saiph: [5.796, -9.67, 2.09],
      rigel: [5.242, -8.202, 0.13],
    },
    lines: [
      ["meissa", "betelgeuse"],
      ["meissa", "bellatrix"],
      ["betelgeuse", "alnitak"],
      ["bellatrix", "mintaka"],
      ["alnitak", "alnilam"],
      ["alnilam", "mintaka"],
      ["alnitak", "saiph"],
      ["mintaka", "rigel"],
    ],
  },
  {
    key: "plough",
    name: "the Plough",
    aliases: ["plow", "big dipper", "ursa major", "great bear", "saucepan"],
    stars: {
      dubhe: [11.062, 61.751, 1.79],
      merak: [11.031, 56.382, 2.37],
      phecda: [11.897, 53.695, 2.44],
      megrez: [12.257, 57.033, 3.31],
      alioth: [12.9, 55.96, 1.77],
      mizar: [13.399, 54.925, 2.23],
      alkaid: [13.792, 49.313, 1.86],
    },
    lines: [
      ["dubhe", "merak"],
      ["merak", "phecda"],
      ["phecda", "megrez"],
      ["megrez", "dubhe"],
      ["megrez", "alioth"],
      ["alioth", "mizar"],
      ["mizar", "alkaid"],
    ],
  },
  {
    key: "little-dipper",
    name: "the Little Dipper",
    aliases: ["ursa minor", "little bear", "polaris", "north star"],
    stars: {
      polaris: [2.53, 89.264, 1.98],
      yildun: [17.537, 86.586, 4.36],
      epsilon: [16.766, 82.037, 4.21],
      zeta: [15.734, 77.795, 4.29],
      kochab: [14.845, 74.155, 2.08],
      pherkad: [15.345, 71.834, 3.0],
      eta: [16.292, 75.755, 4.95],
    },
    lines: [
      ["polaris", "yildun"],
      ["yildun", "epsilon"],
      ["epsilon", "zeta"],
      ["zeta", "kochab"],
      ["kochab", "pherkad"],
      ["pherkad", "eta"],
      ["eta", "zeta"],
    ],
  },
  {
    key: "cassiopeia",
    name: "Cassiopeia",
    aliases: ["the w", "w constellation", "queen"],
    stars: {
      caph: [0.153, 59.15, 2.28],
      schedar: [0.675, 56.537, 2.24],
      navi: [0.945, 60.717, 2.15],
      ruchbah: [1.43, 60.235, 2.66],
      segin: [1.907, 63.67, 3.37],
    },
    lines: [
      ["caph", "schedar"],
      ["schedar", "navi"],
      ["navi", "ruchbah"],
      ["ruchbah", "segin"],
    ],
  },
  {
    key: "cygnus",
    name: "Cygnus",
    aliases: ["the swan", "swan", "northern cross"],
    stars: {
      deneb: [20.69, 45.28, 1.25],
      sadr: [20.37, 40.257, 2.23],
      albireo: [19.512, 27.96, 3.05],
      fawaris: [19.75, 45.131, 2.87],
      gienah: [20.77, 33.97, 2.48],
    },
    lines: [
      ["deneb", "sadr"],
      ["sadr", "albireo"],
      ["fawaris", "sadr"],
      ["sadr", "gienah"],
    ],
  },
  {
    key: "crux",
    name: "the Southern Cross",
    aliases: ["southern cross", "cross"],
    stars: {
      gacrux: [12.52, -57.113, 1.63],
      acrux: [12.443, -63.099, 0.77],
      imai: [12.252, -58.749, 2.79],
      mimosa: [12.795, -59.689, 1.25],
      ginan: [12.356, -60.401, 3.59],
    },
    lines: [
      ["gacrux", "acrux"],
      ["imai", "mimosa"],
    ],
  },
  {
    key: "leo",
    name: "Leo",
    aliases: ["the lion", "lion"],
    stars: {
      regulus: [10.139, 11.967, 1.35],
      eta: [10.122, 16.763, 3.49],
      algieba: [10.333, 19.842, 2.08],
      adhafera: [10.278, 23.417, 3.44],
      rasalas: [9.879, 26.007, 3.88],
      epsilon: [9.764, 23.774, 2.98],
      zosma: [11.235, 20.524, 2.56],
      chertan: [11.237, 15.43, 3.33],
      denebola: [11.818, 14.572, 2.14],
    },
    lines: [
      ["regulus", "eta"],
      ["eta", "algieba"],
      ["algieba", "adhafera"],
      ["adhafera", "rasalas"],
      ["rasalas", "epsilon"],
      ["algieba", "zosma"],
      ["zosma", "denebola"],
      ["denebola", "chertan"],
      ["chertan", "regulus"],
    ],
  },
  {
    key: "scorpius",
    name: "Scorpius",
    aliases: ["scorpio", "the scorpion", "scorpion"],
    stars: {
      acrab: [16.091, -19.806, 2.62],
      dschubba: [16.006, -22.622, 2.29],
      fang: [15.981, -26.114, 2.89],
      sigma: [16.353, -25.593, 2.88],
      antares: [16.49, -26.432, 0.96],
      tau: [16.598, -28.216, 2.82],
      epsilon: [16.836, -34.293, 2.29],
      mu: [16.865, -38.047, 3.08],
      zeta: [16.91, -42.362, 3.62],
      eta: [17.203, -43.239, 3.33],
      sargas: [17.622, -42.998, 1.86],
      iota: [17.793, -40.127, 3.03],
      kappa: [17.708, -39.03, 2.39],
      shaula: [17.56, -37.104, 1.62],
    },
    lines: [
      ["acrab", "dschubba"],
      ["fang", "dschubba"],
      ["dschubba", "sigma"],
      ["sigma", "antares"],
      ["antares", "tau"],
      ["tau", "epsilon"],
      ["epsilon", "mu"],
      ["mu", "zeta"],
      ["zeta", "eta"],
      ["eta", "sargas"],
      ["sargas", "iota"],
      ["iota", "kappa"],
      ["kappa", "shaula"],
    ],
  },
  {
    key: "lyra",
    name: "Lyra",
    aliases: ["the lyre", "lyre", "vega"],
    stars: {
      vega: [18.616, 38.784, 0.03],
      epsilon: [18.739, 39.67, 4.67],
      zeta: [18.746, 37.605, 4.34],
      delta: [18.908, 36.899, 4.22],
      sulafat: [18.982, 32.69, 3.24],
      sheliak: [18.835, 33.363, 3.52],
    },
    lines: [
      ["vega", "epsilon"],
      ["vega", "zeta"],
      ["epsilon", "zeta"],
      ["zeta", "delta"],
      ["delta", "sulafat"],
      ["sulafat", "sheliak"],
      ["sheliak", "zeta"],
    ],
  },
];

type Vector = [number, number, number];

function toVector(raHours: number, decDegrees: number): Vector {
  const ra = (raHours * Math.PI) / 12;
  const dec = (decDegrees * Math.PI) / 180;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
}

function dot(a: Vector, b: Vector) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vector, b: Vector): Vector {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(vector: Vector): Vector {
  const length = Math.hypot(...vector);
  return length > 0 ? [vector[0] / length, vector[1] / length, vector[2] / length] : vector;
}

/**
 * A gnomonic projection onto the plane touching the sky at the middle of the
 * constellation, scaled onto the drawing canvas.
 *
 * A projection rather than plotting right ascension against declination
 * directly, because that stretches anything near a pole beyond recognition --
 * the Little Dipper's stars span fifteen hours of right ascension.
 */
function project(source: StarMapSource): StarMapStar[] {
  const vectors = Object.entries(source.stars).map(([id, [ra, dec, magnitude]]) => ({
    id,
    magnitude,
    vector: toVector(ra, dec),
  }));
  const centre = normalize(
    vectors.reduce<Vector>(
      (sum, { vector }) => [sum[0] + vector[0], sum[1] + vector[1], sum[2] + vector[2]],
      [0, 0, 0]
    )
  );
  const rawEast = cross([0, 0, 1], centre);
  const east = Math.hypot(...rawEast) < 1e-6 ? ([0, 1, 0] as Vector) : normalize(rawEast);
  const north = cross(centre, east);

  // East is on the left and north is up, as the sky looks from below.
  const flat = vectors.map(({ id, magnitude, vector }) => {
    const depth = dot(vector, centre);
    return { id, magnitude, x: -dot(vector, east) / depth, y: -dot(vector, north) / depth };
  });

  const xs = flat.map((point) => point.x);
  const ys = flat.map((point) => point.y);
  const middleX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const middleY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const scale = span > 0 ? 84 / span : 1;

  return flat.map((point) => ({
    id: point.id,
    magnitude: point.magnitude,
    x: Math.round((50 + (point.x - middleX) * scale) * 10) / 10,
    y: Math.round((50 + (point.y - middleY) * scale) * 10) / 10,
  }));
}

export const STAR_MAPS: StarMap[] = SOURCES.map((source) => ({
  key: source.key,
  name: source.name,
  starCount: Object.keys(source.stars).length,
  stars: project(source),
  lines: source.lines,
}));

function simplifyName(value: string) {
  return value.toLowerCase().replace(/^\s*the\s+/, "").replace(/[^a-z]/g, "");
}

export function findStarMap(value: string): StarMap | null {
  const wanted = simplifyName(value);
  if (!wanted) return null;
  const index = SOURCES.findIndex(
    (source) =>
      simplifyName(source.key) === wanted ||
      source.aliases.some((alias) => simplifyName(alias) === wanted)
  );
  return index >= 0 ? STAR_MAPS[index] : null;
}

/** Each named star's place on the canvas, for checking a map against the sky. */
export function starMapPoints(key: string) {
  const map = STAR_MAPS.find((entry) => entry.key === key);
  return map
    ? Object.fromEntries(map.stars.map((star) => [star.id, [star.x, star.y] as [number, number]]))
    : null;
}
