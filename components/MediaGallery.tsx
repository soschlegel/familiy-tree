"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ownerField = owner.kind === "person" ? "personId" : "relationshipId";

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);

    // Nacheinander statt parallel: so bleibt die Reihenfolge stabil und der
    // Server bekommt bei mehreren großen Bildern keinen Speicherstoß.
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      form.append(ownerField, owner.id);

      const res = await fetch("/api/media", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(`${file.name}: ${body.error ?? res.status}`);
        break;
      }
    }

    setBusy(false);
    router.refresh();
  }

  async function makePrimary(mediaId: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/media/${mediaId}/primary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [ownerField]: owner.id }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Fehler ${res.status}`);
    }
    setBusy(false);
    router.refresh();
  }

  async function remove(mediaId: string) {
    if (!confirm("Bild wirklich löschen?")) return;
    setBusy(true);
    const res = await fetch(`/api/media/${mediaId}`, { method: "DELETE" });
    if (!res.ok) setError(`Löschen fehlgeschlagen (${res.status})`);
    setBusy(false);
    router.refresh();
  }

  const primaryLabel =
    owner.kind === "person" ? "Primärbild" : "Hauptbild";

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className={compact ? "text-sm font-medium" : "font-medium"}>
          {title} ({items.length})
        </h2>
        {canUpload && (
          <label className="cursor-pointer rounded-lg border border-stone-300 px-3 py-1.5 text-sm transition hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800">
            {busy ? "Lädt…" : "Bilder hinzufügen"}
            <input
              type="file"
              accept="image/*"
              multiple
              hidden
              disabled={busy}
              onChange={(e) => upload(e.target.files)}
            />
          </label>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-stone-500">Noch keine Bilder.</p>
      ) : (
        <div
          className={`grid gap-3 ${
            compact ? "grid-cols-4 sm:grid-cols-8" : "grid-cols-3 sm:grid-cols-5"
          }`}
        >
          {items.map((item) => (
            <figure key={item.mediaId} className="group relative">
              <a
                href={`/api/media/${item.mediaId}`}
                target="_blank"
                rel="noreferrer"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/media/${item.mediaId}?variant=thumb`}
                  alt={item.caption ?? ""}
                  className={`aspect-square w-full rounded-lg object-cover ring-offset-2 transition ${
                    item.isPrimary
                      ? "ring-2 ring-amber-500"
                      : "ring-0 hover:ring-2 hover:ring-stone-300"
                  }`}
                />
              </a>

              {item.isPrimary ? (
                <span className="absolute left-1 top-1 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-medium text-white shadow">
                  {primaryLabel}
                </span>
              ) : (
                canUpload && (
                  <button
                    onClick={() => makePrimary(item.mediaId)}
                    disabled={busy}
                    title={`Als ${primaryLabel} festlegen`}
                    className="absolute left-1 top-1 hidden rounded bg-stone-900/85 px-1.5 py-0.5 text-[10px] text-white shadow group-hover:block"
                  >
                    ★ {primaryLabel}
                  </button>
                )
              )}

              {canDelete && (
                <button
                  onClick={() => remove(item.mediaId)}
                  disabled={busy}
                  className="absolute right-1 top-1 hidden rounded bg-red-600/90 px-1.5 py-0.5 text-[10px] text-white shadow group-hover:block"
                >
                  Löschen
                </button>
              )}
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}
