import Link from "next/link";

import { placeKey } from "@/lib/places/normalize";
import type { PlaceLinkDto } from "@/lib/services/place-pages";

/**
 * Enthält der zugeordnete Ortsname schon alles, was eingegeben wurde? Dann
 * braucht es den Originaltext nicht daneben („Karlsruhe“ in „Karlsruhe,
 * Baden-Württemberg, Deutschland“; „Danzig“ in „Gdańsk (Danzig), Polen“).
 * Steht im Freitext mehr (Anschrift, alte Landschaft), bleibt er sichtbar.
 */
export function textCoveredByLabel(text: string, label: string): boolean {
  const hay = label.toLocaleLowerCase("de");
  return text
    .split(",")
    .map((part) => part.trim().toLocaleLowerCase("de"))
    .filter(Boolean)
    .every((part) => hay.includes(part));
}

/**
 * Ortsangabe in der Anzeige: Ist der Freitext einem Ort zugeordnet, steht
 * der systematische Ort („Ort, Region, Land“, heutiger Name mit altem in
 * Klammern) als Verweis auf die Ortsseite — dort stehen alle Schreibweisen
 * und die Personen mit Bezug zu diesem Ort. Der eingegebene Text bleibt
 * gespeichert; er steht dezent daneben, wenn er mehr sagt als der Ortsname,
 * und immer im Titel des Verweises. Ohne Zuordnung reiner Text.
 * Für Server- und Client-Komponenten (keine Hooks).
 */
export function PlaceText({ text, links }: { text: string | null | undefined; links?: Record<string, PlaceLinkDto> }) {
  if (!text) return null;
  const link = links?.[placeKey(text)];
  if (!link) return <>{text}</>;
  return (
    <>
      <Link href={`/places/${link.ref}`} className="btn-link" title={`Eingegeben: ${text}`} data-testid="place-link">
        {link.label}
      </Link>
      {!textCoveredByLabel(text, link.label) && (
        <span className="muted text-xs" data-testid="place-original">
          {" "}
          · eingegeben: {text}
        </span>
      )}
    </>
  );
}
