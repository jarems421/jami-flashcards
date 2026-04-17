/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-nunito-sans)", "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Arial", "sans-serif"],
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
      boxShadow: {
        glass: "var(--shadow-glass)",
        card: "var(--shadow-card)",
        shell: "var(--shadow-shell)",
        bubble: "var(--shadow-bubble)",
        "button-3d": "var(--shadow-button-3d)",
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
