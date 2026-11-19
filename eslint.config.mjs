import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

/**
 * Flat-Config für ESLint 9. Die Next-Regeln (core-web-vitals + TypeScript)
 * kommen über FlatCompat, weil eslint-config-next 15 noch im alten Format
 * ausgeliefert wird.
 */
const config = [
  {
    ignores: [
      "node_modules/**",
      // Alle Build-Ordner (.next, .next-mock, .next-buildcheck, …): ein
      // NEXT_DIST_DIR-Testbau soll den Lint-Lauf nicht rot machen.
      ".next/**",
      ".next-*/**",
      "tests/.scratch/**",
      "out/**",
      "build/**",
      "data/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "blob-report/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Bewusst ungenutzte Variablen mit _ kennzeichnen dürfen
      // (z.B. beim Weglassen eines Feldes per Destructuring).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  {
    // Playwright-Tests sind kein React-Code: Fixtures heißen `use(...)` und
    // träfen sonst fälschlich die Hook-Regeln. Nur hier, nicht für die App.
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
];

export default config;
