"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import type { Release } from "@/lib/release-notes";
import { apiFetch } from "./api-client";
import { ReleaseNoteList } from "./ReleaseNoteList";

/**
 * Fenster „Was ist neu?“ (README „Neuigkeiten“): erscheint einmal nach einer
 * neuen Version, mit den Releases seit dem zuletzt gesehenen (Auswahl auf
 * dem Server, `releasesSince` in lib/release-notes.ts). Das Layout bindet es
 * nur für Angemeldete ein, wenn es etwas zu zeigen gibt.
 *
 * Echtes `<dialog>` mit showModal: Fokus im Fenster, Escape schließt, danach
 * zurück zum vorher fokussierten Element. Jedes Schließen — „Gelesen“,
 * Escape, Klick auf den Hintergrund, Link „Alle Neuigkeiten“ — merkt
 * `latestId` als gesehen (PUT /api/me/release-seen). Scheitert das, kommt
 * das Fenster beim nächsten Laden wieder; eine Fehlermeldung wäre lästiger.
 */
export function WhatsNewDialog({ releases, more, latestId }: { releases: Release[]; more: number; latestId: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const saved = useRef(false);
  const [closed, setClosed] = useState(false);
  const pathname = usePathname();
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (closed || pathname === "/login" || !dialog || dialog.open) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
  }, [closed, pathname]);

  function onClose() {
    setClosed(true);
    if (!saved.current) {
      saved.current = true;
      void apiFetch("/api/me/release-seen", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ releaseId: latestId }),
      });
    }
    const target = returnFocus.current;
    if (target && target !== document.body && document.contains(target)) target.focus();
  }

  const close = () => dialogRef.current?.close();

  if (closed) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      data-testid="whats-new"
      onClose={onClose}
      // Klick auf den abgedunkelten Hintergrund schließt (das Ziel ist dann das <dialog> selbst).
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className="m-auto w-[min(36rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] rounded-xl border border-stone-200 bg-surface p-0 text-stone-900 shadow-xl backdrop:bg-stone-950/50 dark:border-stone-700 dark:text-stone-100"
    >
      <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <div className="border-b border-stone-200 px-5 pb-3 pt-4 dark:border-stone-800">
          <h2 id={titleId} className="section-title">
            Was ist neu?
          </h2>
          <p className="mt-1 text-sm muted">Das hat sich im Stammbaum zuletzt geändert.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <ReleaseNoteList releases={releases} headingLevel={3} />
          {more > 0 && (
            <p className="mt-4 text-sm muted" data-testid="whats-new-more">
              {more === 1
                ? "Eine weitere Neuigkeit seit deinem letzten Besuch steht"
                : `${more} weitere Neuigkeiten seit deinem letzten Besuch stehen`}{" "}
              auf der Seite „Neuigkeiten“.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-stone-200 px-5 pb-4 pt-3 dark:border-stone-800">
          <Link href="/neuigkeiten" className="btn-secondary min-h-11" onClick={close}>
            Alle Neuigkeiten
          </Link>
          <button type="button" className="btn-primary min-h-11" onClick={close} autoFocus>
            Gelesen
          </button>
        </div>
      </div>
    </dialog>
  );
}
