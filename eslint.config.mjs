import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
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
        },
      ],
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
