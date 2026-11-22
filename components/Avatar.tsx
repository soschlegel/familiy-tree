type Gender = "MALE" | "FEMALE" | "OTHER" | "UNKNOWN";

const RING: Record<Gender, string> = {
  MALE: "ring-sky-300 dark:ring-sky-700",
  FEMALE: "ring-rose-300 dark:ring-rose-700",
  OTHER: "ring-violet-300 dark:ring-violet-700",
  UNKNOWN: "ring-stone-200 dark:ring-stone-700",
};

const INITIALS_BG: Record<Gender, string> = {
  MALE: "bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  FEMALE: "bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  OTHER: "bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  UNKNOWN: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
};

const SIZE = {
  md: "h-12 w-12 text-sm",
  lg: "h-28 w-28 text-3xl sm:h-36 sm:w-36 sm:text-4xl",
} as const;

/**
 * Rundes Porträt mit dezentem Geschlechtsring; ohne Bild die Initialen.
 * Verstorbene erscheinen leicht entsättigt — ein stiller Hinweis, kein
 * Trauerflor.
 */
export function Avatar({
  person,
  size = "md",
}: {
  person: {
    givenName: string;
    familyName: string | null;
    gender: Gender;
    primaryMediaId: string | null;
    deathDate?: string | null;
  };
  size?: keyof typeof SIZE;
}) {
  const base = `${SIZE[size]} shrink-0 rounded-full ring-2 ring-offset-2 ring-offset-surface ${RING[person.gender]}`;
  if (person.primaryMediaId) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/media/${person.primaryMediaId}?variant=thumb`}
        alt=""
        loading="lazy"
        decoding="async"
        className={`${base} object-cover ${person.deathDate ? "grayscale-[40%] sepia-[15%]" : ""}`}
      />
    );
  }
  const initials = (
    person.givenName.slice(0, 1) + (person.familyName?.slice(0, 1) ?? "")
  ).toUpperCase();
  return (
    <span
      aria-hidden
      className={`${base} ${INITIALS_BG[person.gender]} inline-flex items-center justify-center font-serif font-semibold`}
    >
      {initials}
    </span>
  );
}
