import Link from "next/link";

import { placeKey } from "@/lib/places/normalize";
import type { PlaceLinkDto } from "@/lib/services/place-pages";

/**
 * Ortsangabe als Freitext der Person — mit Verweis auf die Ortsseite, wenn
 * der Text einem Ort zugeordnet ist, und dezent dem erkannten Ort, wenn er
 * anders heißt („Breslau → Wrocław, Polen“). Ohne Zuordnung reiner Text.
 * Für Server- und Client-Komponenten (keine Hooks).
 */
export function PlaceText({ text, links }: { text: string | null | undefined; links?: Record<string, PlaceLinkDto> }) {
  if (!text) return null;
  const link = links?.[placeKey(text)];
  if (!link) return <>{text}</>;
  return (
    <>
      <Link href={`/places/${link.ref}`} className="btn-link" title={link.label} data-testid="place-link">
        {text}
      </Link>
      {!link.same && <span className="muted text-xs"> → {link.short}</span>}
    </>
  );
}
