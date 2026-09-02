/**
 * Theme classes are stamped on <html> and <body> at runtime from
 * `APP_THEME_OPTIONS`, built as `app-theme-${value}`. A template literal is
 * invisible to the content scanner, so Tailwind dropped the matching rules
 * from `globals.css` and four of the six themes shipped with no CSS at all —
 * they stamped their class and inherited the `:root` default.
 *
 * Only `purple` and `light` survived, and only because unrelated literal
 * strings for the legacy `app-theme-purple-pink` and `app-theme-light` classes
 * happened to appear in the source.
 *
 * `tests/app-theme.test.ts` fails if a theme is added to APP_THEME_OPTIONS
 * without being listed here, because the failure is silent otherwise: the app
 * builds, the class applies, and the colours are simply wrong.
 */
const APP_THEME_SAFELIST = [
  "app-theme-normal",
  "app-theme-purple",
  "app-theme-pink",
  "app-theme-paper-white",
  "app-theme-soft-grey",
  "app-theme-black",
  // Retained so a document restored from an older session still resolves.
  "app-theme-purple-pink",
  // Shared overrides the two light themes both depend on.
  "app-theme-light",
];

/** @type {import('tailwindcss').Config} */
module.exports = {
  /*
   * Compile every `hover:` utility inside `@media (hover: hover)`.
   *
   * Without it, a touch device applies the hover state on first contact and
   * leaves it stuck there, so a tap can land as "now hovered" rather than as
   * a press. The device has no pointer to move away afterwards, so the state
   * only clears when something else is touched.
   */
  future: {
    hoverOnlyWhenSupported: true,
  },
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  safelist: APP_THEME_SAFELIST,
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-urbanist)", "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Arial", "sans-serif"],
      },
      colors: {
        surface: {
          base: "var(--color-surface-base)",
          raised: "var(--color-surface-raised)",
          overlay: "var(--color-surface-overlay)",
          panel: "var(--color-surface-panel)",
          "panel-strong": "var(--color-surface-panel-strong)",
        },
        glass: {
          subtle: "var(--color-glass-subtle)",
          medium: "var(--color-glass-medium)",
          strong: "var(--color-glass-strong)",
        },
        accent: {
          DEFAULT: "var(--color-accent)",
          hover: "var(--color-accent-hover)",
          muted: "var(--color-accent-muted)",
        },
        success: {
          DEFAULT: "var(--color-success)",
          muted: "var(--color-success-muted)",
        },
        error: {
          DEFAULT: "var(--color-error)",
          muted: "var(--color-error-muted)",
        },
        warm: {
          glow: "var(--color-warm-glow)",
          border: "var(--color-warm-border)",
          accent: "var(--color-warm-accent)",
        },
        text: {
          primary: "var(--color-text-primary)",
          secondary: "var(--color-text-secondary)",
          muted: "var(--color-text-muted)",
          inverse: "var(--color-text-inverse)",
        },
        field: {
          bg: "var(--color-field-bg)",
          text: "var(--color-field-text)",
          placeholder: "var(--color-field-placeholder)",
          border: "var(--color-field-border)",
        },
        chip: {
          bg: "var(--color-chip-bg)",
          text: "var(--color-chip-text)",
          border: "var(--color-chip-border)",
        },
        selected: {
          bg: "var(--color-selected-bg)",
          text: "var(--color-selected-text)",
          border: "var(--color-selected-border)",
        },
        warning: {
          DEFAULT: "var(--color-warning)",
          muted: "var(--color-warning-muted)",
          text: "var(--color-warning-text)",
        },
        border: {
          DEFAULT: "var(--color-border)",
          strong: "var(--color-border-strong)",
        },
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
      },
      /*
       * One step below `xs`, for the uppercase eyebrows and metadata lines that
       * had been hand-set at 0.62, 0.65, 0.66, 0.68, 0.7 and 0.72rem in 62
       * places -- six sizes spanning a pixel and a half, which is a difference
       * nobody can see and a decision made six ways.
       *
       * This is the floor. Anything smaller is unreadable on a phone, and the
       * lint rule below refuses new arbitrary sizes so it stays the floor.
       */
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      boxShadow: {
        /*
         * Elevation, numbered because it is ordinal: e0 sits barely proud of
         * what is under it, e3 is over the page entirely. Reach for the lowest
         * one that reads -- depth only signals hierarchy while it is scarce.
         */
        e0: "var(--elevation-0)",
        e1: "var(--elevation-1)",
        e2: "var(--elevation-2)",
        e3: "var(--elevation-3)",
        /* Not heights: a glow says what something is, a ring says it is chosen. */
        accent: "var(--shadow-accent)",
        warm: "var(--shadow-warm)",
        ring: "var(--ring-selected)",
        /* Names kept for what they describe; each resolves to a level above. */
        glass: "var(--shadow-glass)",
        card: "var(--shadow-card)",
        shell: "var(--shadow-shell)",
        bubble: "var(--shadow-bubble)",
        "button-3d": "var(--shadow-button-3d)",
        /* Surfaces that carry their own colour per theme. */
        "nav-shell": "var(--nav-shell-shadow)",
        "nav-active": "var(--nav-active-shadow)",
        topbar: "var(--topbar-shadow)",
        "button-primary": "var(--button-primary-shadow)",
        "button-secondary": "var(--button-secondary-shadow)",
        "button-surface-hover": "var(--button-surface-shadow-hover)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        normal: "var(--duration-normal)",
        slow: "var(--duration-slow)",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
        spring: "var(--ease-spring)",
        bounce: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "reward-pulse": {
          "0%": { boxShadow: "0 0 0 0 rgba(183, 124, 255, 0.52)" },
          "70%": { boxShadow: "0 0 0 12px rgba(183, 124, 255, 0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(183, 124, 255, 0)" },
        },
        "warm-glow-pulse": {
          "0%": { boxShadow: "0 0 0 0 rgba(255, 214, 246, 0.38)" },
          "70%": { boxShadow: "0 0 22px 8px rgba(255, 214, 246, 0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(255, 214, 246, 0)" },
        },
      },
      animation: {
        "fade-in": "fade-in var(--duration-normal) var(--ease-standard) both",
        "slide-up": "slide-up var(--duration-slow) var(--ease-standard) both",
        "reward-pulse": "reward-pulse 1.5s ease infinite",
        "warm-glow-pulse": "warm-glow-pulse 2s ease infinite",
      },

    },
  },
  plugins: [],
};

// Exported so a test can hold it against APP_THEME_OPTIONS.
module.exports.APP_THEME_SAFELIST = APP_THEME_SAFELIST;
