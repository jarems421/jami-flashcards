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
    files: ["app/**/*.{jsx,tsx}", "components/**/*.{jsx,tsx}"],
    rules: {
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
