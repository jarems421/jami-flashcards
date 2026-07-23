import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [
      "app/dashboard/page.tsx",
      "app/dashboard/library/**/*.tsx",
      "app/dashboard/notebooks/**/*.tsx",
      "app/dashboard/goals/**/*.tsx",
      "app/dashboard/progress/**/*.tsx",
      "app/dashboard/constellation/**/*.tsx",
      "components/constellation/**/*.tsx",
      "components/library/**/*.tsx",
      "components/sources/**/*.tsx",
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
        },
      ],
    },
  },
  {
    files: [
      "lib/app/**/*.{ts,tsx}",
      "lib/constellation/**/*.{ts,tsx}",
      "lib/workspace/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/components/**", "@/services/**"],
              message: "Keep this domain layer pure; pass external data in from a page or service.",
            },
          ],
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
  ]),
]);

export default eslintConfig;
