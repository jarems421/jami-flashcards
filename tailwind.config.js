/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          base: "var(--color-surface-base)",
          raised: "var(--color-surface-raised)",
          overlay: "var(--color-surface-overlay)",
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
        },
        border: {
          DEFAULT: "var(--color-border)",
        },
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      boxShadow: {
        glass: "var(--shadow-glass)",
        card: "var(--shadow-card)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        normal: "var(--duration-normal)",
        slow: "var(--duration-slow)",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
        spring: "var(--ease-spring)",
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
          "0%": { boxShadow: "0 0 0 0 rgba(99, 102, 241, 0.5)" },
          "70%": { boxShadow: "0 0 0 10px rgba(99, 102, 241, 0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(99, 102, 241, 0)" },
        },
        "warm-glow-pulse": {
          "0%": { boxShadow: "0 0 0 0 rgba(245, 158, 11, 0.4)" },
          "70%": { boxShadow: "0 0 20px 6px rgba(245, 158, 11, 0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(245, 158, 11, 0)" },
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
