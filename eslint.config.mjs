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
      ".next/**",
      ".next-mock/**",
      "out/**",
      "build/**",
      "data/**",
      "coverage/**",
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
];

export default config;
