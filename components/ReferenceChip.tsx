"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

import { REFERENCE_COOKIE, REFERENCE_SELF, type ReferenceSource } from "@/lib/reference";

const YEAR = 60 * 60 * 24 * 365;

/**
 * Hinweis auf die Bezugsperson (README, „Bezugsperson“).
 *
 * - Vorübergehende Bezugsperson (aus `?bezug=` oder dem Cookie): deutlich als
 *   „Sicht von: <Name>“ mit „zurück zu mir“ (bzw. „aufheben“ ohne eigene
 *   Person).
 * - Eigene Person: zurückhaltend „Bezugsperson: <Name> (ich)“, auf dem
 *   Telefon ausgeblendet — dort ist der Platz knapp.
 *
 * Merkt sich eine per Adresse gewählte Bezugsperson im Cookie, damit sie
 * beim Weiterklicken im Baum und auf Personenseiten erhalten bleibt;
 * `?bezug=ich` vergisst sie wieder.
 */
export function ReferenceChip({
  id,
  name,
  source,
  hasSelf,
  param,
}: {
  id: string | null;
  name: string | null;
  source: ReferenceSource | null;
  hasSelf: boolean;
  /** Roher Wert von `?bezug=` (null ohne). */
  param: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    try {
      if (param === REFERENCE_SELF || (param && source === "self")) {
        document.cookie = `${REFERENCE_COOKIE}=; path=/; max-age=0; samesite=lax`;
      } else if (param && id === param && source === "param") {
        document.cookie = `${REFERENCE_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${YEAR}; samesite=lax`;
      }
    } catch {
      // ohne Cookie gilt die Bezugsperson nur für diese Adresse
    }
  }, [param, id, source]);

  if (!id || !name || !source) return null;

  function backToSelf() {
    try {
      document.cookie = `${REFERENCE_COOKIE}=; path=/; max-age=0; samesite=lax`;
    } catch {
      // siehe oben
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("bezug");
    startTransition(() => {
      router.replace(url.pathname + url.search, { scroll: false });
      router.refresh();
    });
  }

  if (source === "self") {
    return (
      <p
        data-testid="reference-chip"
        data-source="self"
        className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-brass-100 px-3 py-1 text-xs text-brass-700 ring-1 ring-brass-300 max-sm:hidden dark:bg-brass-700/20 dark:text-brass-300 dark:ring-brass-700"
      >
        <span className="muted">Bezugsperson:</span>
        <span className="truncate font-medium">{name}</span>
        <span>(ich)</span>
      </p>
    );
  }

  return (
    <div
      role="status"
      data-testid="reference-chip"
      data-source={source}
      aria-busy={pending}
      className="inline-flex max-w-full flex-wrap items-center gap-x-1 rounded-full bg-brass-100 py-0.5 pl-3 pr-1 text-sm text-brass-700 ring-2 ring-brass-400 dark:bg-brass-700/30 dark:text-brass-300 dark:ring-brass-500"
    >
      <span>Sicht von:</span>
      <span className="truncate font-semibold" data-testid="reference-chip-name">{name}</span>
      <span aria-hidden>·</span>
      <button
        type="button"
        onClick={backToSelf}
        disabled={pending}
        data-testid="reference-chip-reset"
        className="rounded-full px-2 py-1 font-medium underline underline-offset-2 hover:bg-white/60 max-md:min-h-11 dark:hover:bg-stone-900/40"
      >
        {hasSelf ? "zurück zu mir" : "aufheben"}
      </button>
    </div>
  );
}
