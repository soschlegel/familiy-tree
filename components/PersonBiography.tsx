"use client";

import Link from "next/link";
import { useState } from "react";

import { HelpLink } from "@/components/HelpLink";
import type { Biography } from "@/lib/biography";

/**
 * Abschnitt „Lebenslauf“ der Personenseite: der aus den erfassten Daten
 * gebaute Text (lib/biography.ts), Namen anderer Personen als Link, dazu
 * „Text kopieren“ (reiner Text ohne Links). Der Text kommt fertig vom
 * Server und nennt nur Personen, die der Benutzer sehen darf.
 */
export function PersonBiography({ biography }: { biography: Biography }) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(biography.text);
      setCopied("ok");
    } catch {
      // Ohne Zwischenablage-Recht: Text markieren, damit Strg+C reicht.
      const el = document.getElementById("biography-text");
      const selection = window.getSelection();
      if (el && selection) {
        const range = document.createRange();
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setCopied("fail");
    }
  }

  return (
    <section aria-labelledby="biography-h" className="card space-y-3 p-5" data-testid="person-biography">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="biography-h" className="section-title">
          Lebenslauf
        </h2>
        <button type="button" className="btn-secondary" onClick={copy} data-testid="biography-copy">
          Text kopieren
        </button>
      </div>
      <div id="biography-text" className="space-y-3 font-serif text-[1.05rem] leading-relaxed" data-testid="biography-text">
        {biography.paragraphs.map((paragraph, i) => (
          <p key={i}>
            {paragraph.map((seg, j) =>
              seg.personId ? (
                <Link
                  key={j}
                  href={`/people/${seg.personId}`}
                  className="text-accent-800 underline decoration-accent-300 underline-offset-2 hover:decoration-accent-600 dark:text-accent-200 dark:decoration-accent-700 dark:hover:decoration-accent-400"
                  data-testid="biography-person-link"
                >
                  {seg.text}
                </Link>
              ) : (
                <span key={j}>{seg.text}</span>
              ),
            )}
          </p>
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs muted" data-testid="biography-note">
        <span>Automatisch aus den erfassten Daten erstellt.</span>
        <HelpLink to="lebenslauf" label="Wie entsteht der Text?" className="text-xs" />
        {copied === "ok" && (
          <span role="status" className="font-medium text-accent-700 dark:text-accent-300">
            Text kopiert.
          </span>
        )}
        {copied === "fail" && (
          <span role="status" className="font-medium">
            Kopieren nicht möglich — der Text ist markiert, kopiere ihn mit Strg+C.
          </span>
        )}
      </p>
    </section>
  );
}
