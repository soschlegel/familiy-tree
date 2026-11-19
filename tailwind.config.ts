import type { Config } from "tailwindcss";

/**
 * Farbwelt „Familienarchiv": warmes Papier, dunkle Tinte, als Akzent ein
 * gedecktes Patina-Grün und für Hervorhebungen Messing. Die Werte stehen als
 * CSS-Variablen in app/globals.css (je für hell und dunkel); hier werden sie
 * nur als Tailwind-Farben benannt, damit `bg-accent-600` & Co. in beiden
 * Farbschemata richtig aussehen.
 */
const scale = (name: string, steps: number[]) =>
  Object.fromEntries(
    steps.map((s) => [s, `rgb(var(--${name}-${s}) / <alpha-value>)`]),
  );

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "rgb(var(--paper) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        accent: scale("accent", [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        brass: scale("brass", [100, 300, 400, 500, 600, 700]),
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "ui-serif", "Georgia", "serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgb(41 37 36 / 0.06), 0 4px 12px -4px rgb(41 37 36 / 0.10)",
        lift: "0 2px 4px rgb(41 37 36 / 0.08), 0 12px 28px -8px rgb(41 37 36 / 0.22)",
      },
    },
  },
  plugins: [],
} satisfies Config;
