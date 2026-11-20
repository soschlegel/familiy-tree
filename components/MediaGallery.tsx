"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { apiFetch, jsonBody } from "./api-client";

export type GalleryItem = {
  mediaId: string;
  caption: string | null;
  isPrimary: boolean;
};

/**
 * Dieselbe Galerie dient Personen und Ereignissen (Hochzeiten). Welches von
 * beiden, entscheidet der übergebene owner — die API bekommt entsprechend
 * personId oder relationshipId.
 */
export type MediaOwner =
  | { kind: "person"; id: string }
  | { kind: "relationship"; id: string };

export function MediaGallery({
  owner,
  items,
  canUpload,
  canDelete,
  title = "Bilder",
  compact = false,
}: {
  owner: MediaOwner;
  items: GalleryItem[];
  canUpload: boolean;
  canDelete: boolean;
  title?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const headingId = useId();
  const inputId = useId();

  const ownerField = owner.kind === "person" ? "personId" : "relationshipId";
  const primaryLabel = owner.kind === "person" ? "Porträt" : "Hauptbild";

  async function upload(input: HTMLInputElement) {
    const files = input.files;
    if (!files?.length || busy) return;
    setBusy("upload");
    setError(null);
    setNotice(null);

    // Nacheinander statt parallel: so bleibt die Reihenfolge stabil und der
    // Server bekommt bei mehreren großen Bildern keinen Speicherstoß.
    let done = 0;
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      form.append(ownerField, owner.id);

      const res = await apiFetch("/api/media", { method: "POST", body: form });
      if (!res.ok) {
        setError(`${file.name}: ${res.message}`);
        break;
      }
      done++;
    }

    // Dieselbe Datei soll sich danach erneut wählen lassen.
    input.value = "";
    setBusy(null);
    if (done > 0) setNotice(done === 1 ? "Bild hochgeladen." : `${done} Bilder hochgeladen.`);
    router.refresh();
  }

  async function makePrimary(mediaId: string) {
    if (busy) return;
    setBusy(mediaId);
    setError(null);
    setNotice(null);
    const res = await apiFetch(`/api/media/${mediaId}/primary`, jsonBody("POST", { [ownerField]: owner.id }));
    setBusy(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setNotice(`Als ${primaryLabel} festgelegt.`);
    router.refresh();
  }

  async function remove(mediaId: string) {
    if (busy) return;
    if (!confirm("Bild wirklich löschen? Das lässt sich nicht rückgängig machen.")) return;
    setBusy(mediaId);
    setError(null);
    setNotice(null);
    const res = await apiFetch(`/api/media/${mediaId}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setNotice("Bild gelöscht.");
    router.refresh();
  }

  const Heading = compact ? "h4" : "h2";

  return (
    <section className="space-y-3" aria-labelledby={headingId} data-testid={`gallery-${owner.kind}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Heading
          id={headingId}
          className={compact ? "text-sm font-semibold" : "section-title"}
        >
          {title}{" "}
          <span className="font-sans text-sm font-normal muted">({items.length})</span>
        </Heading>
        {canUpload && (
          <>
            <input
              id={inputId}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              disabled={busy !== null}
              onChange={(e) => void upload(e.currentTarget)}
            />
            <label
              htmlFor={inputId}
              className={`btn-secondary cursor-pointer ${compact ? "btn-sm" : ""} ${busy ? "pointer-events-none opacity-50" : ""}`}
            >
              {busy === "upload" ? "Lädt hoch…" : "Bilder hinzufügen"}
            </label>
          </>
        )}
      </div>

      <div aria-live="polite">
        {error && (
          <p role="alert" className="alert-error">
            {error}
          </p>
        )}
        {notice && !error && <p className="alert-success">{notice}</p>}
      </div>

      {items.length === 0 ? (
        <p className="text-sm muted">Noch keine Bilder.</p>
      ) : (
        <ul
          className={`grid gap-3 ${
            compact ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-4 lg:grid-cols-5"
          }`}
        >
          {items.map((item) => (
            <li key={item.mediaId} className="group relative">
              <figure>
                <a
                  href={`/api/media/${item.mediaId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-xl"
                  aria-label={`${item.caption ?? "Bild"} in voller Größe öffnen`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/media/${item.mediaId}?variant=thumb`}
                    alt={item.caption ?? (item.isPrimary ? primaryLabel : "Bild")}
                    loading="lazy"
                    decoding="async"
                    className={`aspect-square w-full rounded-xl object-cover transition duration-300 group-hover:scale-[1.03] ${
                      busy === item.mediaId ? "opacity-50" : ""
                    }`}
                  />
                </a>
                {item.isPrimary && (
                  <span className="absolute left-2 top-2 rounded-full bg-brass-700 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
                    {primaryLabel}
                  </span>
                )}
                {item.caption && (
                  <figcaption className="mt-1 truncate text-xs muted">{item.caption}</figcaption>
                )}
              </figure>

              {(canUpload || canDelete) && (
                // Aktionen auf dem Telefon immer sichtbar, sonst bei Zeiger
                // oder Tastaturfokus — nicht nur beim Überfahren mit der Maus.
                // Auf dem Telefon stehen sie unter dem Bild statt darauf: als
                // Tippziele (44 px) hätten sie auf dem Vorschaubild keinen Platz.
                <div className="absolute inset-x-2 bottom-2 flex justify-between gap-1 opacity-100 transition max-sm:static max-sm:mt-1.5 max-sm:flex-wrap sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                  {canUpload && !item.isPrimary ? (
                    <button
                      type="button"
                      onClick={() => void makePrimary(item.mediaId)}
                      disabled={busy !== null}
                      className="rounded-full bg-stone-900/80 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur hover:bg-stone-900 max-sm:min-h-11 max-sm:flex-1 max-sm:whitespace-nowrap max-sm:text-xs"
                    >
                      Als {primaryLabel}
                    </button>
                  ) : (
                    <span className="max-sm:hidden" />
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => void remove(item.mediaId)}
                      disabled={busy !== null}
                      className="rounded-full bg-red-700/90 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur hover:bg-red-700 max-sm:min-h-11 max-sm:flex-1 max-sm:whitespace-nowrap max-sm:text-xs"
                      aria-label="Bild löschen"
                    >
                      Löschen
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
