/**
 * Dezente Geschlechtsmarkierung an Porträts — gemeinsam für `Avatar`
 * (Personenliste, Personenseite) und `PersonNode` (Baumkarten), damit beide
 * gleich aussehen. Liegt unter components/, weil Tailwind nur app/ und
 * components/ nach Klassen durchsucht.
 */
export type Gender = "MALE" | "FEMALE" | "OTHER" | "UNKNOWN";

/** Ring um das Porträt. */
export const GENDER_RING: Record<Gender, string> = {
  MALE: "ring-sky-300 dark:ring-sky-700",
  FEMALE: "ring-rose-300 dark:ring-rose-700",
  OTHER: "ring-violet-300 dark:ring-violet-700",
  UNKNOWN: "ring-stone-200 dark:ring-stone-700",
};

/** Hintergrund und Schrift der Initialen, wenn kein Bild vorliegt. */
export const GENDER_INITIALS_BG: Record<Gender, string> = {
  MALE: "bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  FEMALE: "bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  OTHER: "bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  UNKNOWN: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
};
