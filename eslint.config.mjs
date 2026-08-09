import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/** The AI provider SDK belongs to its client module. Domain logic and
 * services describe model input with `@/lib/ai/content-parts` instead, so
 * adding or changing a provider stays inside `lib/ai/gemini.ts`. */
const AI_SDK_RESTRICTION = {
  name: "@google/generative-ai",
  message:
    "Import the provider SDK only from lib/ai/gemini.ts; use @/lib/ai/content-parts for model input shapes.",
};
import jsxA11y from "eslint-plugin-jsx-a11y";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [
      "app/dashboard/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
      "hooks/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "firebase/firestore",
              message: "Keep Firestore access in a service module and expose a domain operation instead.",
            },
            {
              name: "firebase/storage",
              message: "Keep Storage access in a service module and expose a domain operation instead.",
            },
            {
              name: "@/services/firebase/client-db",
              message: "Pages and components should depend on domain services, not the Firestore client.",
            },
            {
              name: "@/services/firebase/client-storage",
              message: "Pages and components should depend on domain services, not the Storage client.",
            },
          ],
          patterns: [
            {
              group: [
                "**/services/firebase/client-db",
                "**/services/firebase/client-storage",
              ],
              message: "UI code should depend on domain services, not Firebase client adapters.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/components/**",
                "@/services/**",
                "**/components/**",
                "**/services/**",
              ],
              message: "Keep this domain layer pure; pass external data in from a page or service.",
            },
          ],
          // Flat config replaces a rule rather than merging it, so the SDK ban
          // has to live in the same declaration as the purity patterns above.
          // Splitting them into a second `lib/**` block silently switches this
          // one off.
          paths: [AI_SDK_RESTRICTION],
        },
      ],
    },
  },
  {
    // The provider client is the one module allowed to know the vendor. It
    // still may not reach into components or services.
    files: ["lib/ai/gemini.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/components/**",
                "@/services/**",
                "**/components/**",
                "**/services/**",
              ],
              message: "Keep this domain layer pure; pass external data in from a page or service.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["services/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: [AI_SDK_RESTRICTION] }],
    },
  },
  {
    // Server code emits structured records through
    // `@/lib/observability/logger`. A stray `console.*` is not just untidy: it
    // is a line the log search cannot correlate to the request that produced
    // it, which is the whole point of the logger.
    //
    // Only server code is listed. `services/**` runs in the browser, where a
    // JSON line goes to the student's own console and is strictly worse than
    // the prose it replaced; sending those anywhere useful is a separate
    // decision, not a lint rule.
    files: [
      "app/api/**/*.ts",
      "app/health/**/*.ts",
      "services/notifications/**/*.ts",
    ],
    rules: {
      "no-console": "error",
    },
  },
  {
    /*
     * The radius and type scales are the scales. Nothing may invent a value.
     *
     * They already existed and were almost entirely ignored: the interface had
     * settled on 31 different corner radii between 0.45rem and 2rem across 225
     * places, and six different sizes for small text spanning a pixel and a
     * half. Nothing looked wrong on any one screen, which is exactly why it
     * spread -- the difference between 1.15rem and 1.2rem is invisible, and the
     * fact that it varies is not.
     *
     * A one-off tidy would be undone within a month, one reasonable-looking
     * `rounded-[1.3rem]` at a time, so the rule is what makes the scale hold.
     * Both forms are checked: a plain string className, and the template
     * literals that conditional class lists are built from.
     *
     * Shadows are held to the same line, with elevation numbered because it is
     * ordinal: e0 sits barely proud of what is under it, e3 is over the page.
     * There were 26 shadow properties defined and 36 more written straight into
     * components, which is not a way of describing depth so much as 62 guesses
     * at it -- and depth only reads as hierarchy while it is scarce. A glow and
     * a selection ring are exempt by being their own tokens rather than by
     * being unchecked, because neither is a height.
     *
     * `em` is deliberately not covered: it is relative to whatever it sits
     * inside, which is exactly right for a superscript or the halves of a
     * fraction, and is not something an absolute scale can express.
     *
     * If a value is genuinely needed that the scale cannot express, add a step
     * to the scale, or disable this rule on the line with a comment saying why
     * -- there is one, on a page thumbnail that draws text at miniature size to
     * stand in for a page rather than to be read.
     */
    files: ["app/**/*.{jsx,tsx}", "components/**/*.{jsx,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: String.raw`Literal[value=/rounded(-[a-z]{1,2})?-\[[0-9.]+(rem|px)\]/]`,
          message:
            "Use the radius scale: rounded-sm|md|lg|xl|2xl, or rounded-full for a pill.",
        },
        {
          selector: String.raw`TemplateElement[value.raw=/rounded(-[a-z]{1,2})?-\[[0-9.]+(rem|px)\]/]`,
          message:
            "Use the radius scale: rounded-sm|md|lg|xl|2xl, or rounded-full for a pill.",
        },
        {
          selector: String.raw`Literal[value=/text-\[[0-9.]+(rem|px)\]/]`,
          message:
            "Use the type scale: text-2xs is the floor, then text-xs, text-sm, text-base upwards.",
        },
        {
          selector: String.raw`TemplateElement[value.raw=/text-\[[0-9.]+(rem|px)\]/]`,
          message:
            "Use the type scale: text-2xs is the floor, then text-xs, text-sm, text-base upwards.",
        },
        {
          selector: String.raw`Literal[value=/shadow-\[(?!var\()/]`,
          message:
            "Use the elevation scale: shadow-e0|e1|e2|e3, or shadow-accent|warm|ring.",
        },
        {
          selector: String.raw`TemplateElement[value.raw=/shadow-\[(?!var\()/]`,
          message:
            "Use the elevation scale: shadow-e0|e1|e2|e3, or shadow-accent|warm|ring.",
        },
      ],
      ...jsxA11y.flatConfigs.recommended.rules,
      "jsx-a11y/alt-text": [
        "error",
        {
          elements: ["img"],
          img: ["Image"],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright writes bundled reporter assets and trace payloads here. They
    // are gitignored, but without this `npm run lint` fails on generated code
    // after any browser run.
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
