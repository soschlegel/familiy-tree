import { GENDER_INITIALS_BG, GENDER_RING, type Gender } from "./gender-style";

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
  const base = `${SIZE[size]} shrink-0 rounded-full ring-2 ring-offset-2 ring-offset-surface ${GENDER_RING[person.gender]}`;
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
      className={`${base} ${GENDER_INITIALS_BG[person.gender]} inline-flex items-center justify-center font-serif font-semibold`}
    >
      {initials}
    </span>
  );
}
