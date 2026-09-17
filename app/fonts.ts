/*
 * Every face a student can set Jami in.
 *
 * All of them are declared here so `next/font` self-hosts them -- no request
 * ever leaves for a font host, and the catalogue cannot drift from what the
 * chooser offers. Only Urbanist is preloaded: it is what a new account opens
 * in, and preloading twenty-five families would fetch every one of them on
 * every page for the sake of the one in use. The rest carry `display: swap`
 * and are fetched by the browser the moment a chosen face is actually painted.
 *
 * Each exposes a CSS variable; `app/globals.css` points `--app-font` at the
 * one whose `app-font-<id>` class is stamped on the document.
 */
import {
  Bodoni_Moda,
  Cinzel,
  Comfortaa,
  Cormorant_Garamond,
  Crimson_Pro,
  EB_Garamond,
  Forum,
  Fraunces,
  Gilda_Display,
  Italiana,
  Josefin_Sans,
  Jost,
  Literata,
  Lora,
  Manrope,
  Marcellus,
  Newsreader,
  Outfit,
  Playfair_Display,
  Questrial,
  Raleway,
  Spectral,
  Syne,
  Tenor_Sans,
  Urbanist,
} from "next/font/google";

const urbanist = Urbanist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-urbanist",
});

const jost = Jost({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-jost",
});

const outfit = Outfit({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-outfit",
});

const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-manrope",
});

const raleway = Raleway({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-raleway",
});

const josefinSans = Josefin_Sans({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-josefin-sans",
});

const questrial = Questrial({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  preload: false,
  variable: "--font-questrial",
});

const comfortaa = Comfortaa({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-comfortaa",
});

const syne = Syne({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-syne",
});

const cormorantGaramond = Cormorant_Garamond({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-cormorant-garamond",
});

const ebGaramond = EB_Garamond({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-eb-garamond",
});

const spectral = Spectral({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
  preload: false,
  variable: "--font-spectral",
});

const literata = Literata({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-literata",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-newsreader",
});

const lora = Lora({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-lora",
});

const crimsonPro = Crimson_Pro({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-crimson-pro",
});

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-playfair-display",
});

const bodoniModa = Bodoni_Moda({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-bodoni-moda",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-fraunces",
});

const cinzel = Cinzel({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-cinzel",
});

const marcellus = Marcellus({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  preload: false,
  variable: "--font-marcellus",
});

const tenorSans = Tenor_Sans({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  preload: false,
  variable: "--font-tenor-sans",
});

const forum = Forum({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  preload: false,
  variable: "--font-forum",
});

const italiana = Italiana({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  preload: false,
  variable: "--font-italiana",
});

const gildaDisplay = Gilda_Display({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  preload: false,
  variable: "--font-gilda-display",
});

/** Every face's variable, for the `<html>` element. */
export const APP_FONT_VARIABLE_CLASS_NAMES = [
  urbanist,
  jost,
  outfit,
  manrope,
  raleway,
  josefinSans,
  questrial,
  comfortaa,
  syne,
  cormorantGaramond,
  ebGaramond,
  spectral,
  literata,
  newsreader,
  lora,
  crimsonPro,
  playfairDisplay,
  bodoniModa,
  fraunces,
  cinzel,
  marcellus,
  tenorSans,
  forum,
  italiana,
  gildaDisplay,
]
  .map((font) => font.variable)
  .join(" ");
