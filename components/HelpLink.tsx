import Link from "next/link";

import { HELP_LINKS, type HelpLinkKey } from "@/lib/help/links";

/**
 * Link „Hilfe“ in der Fußzeile (app/layout.tsx), nur für Angemeldete. Die
 * Fußzeile hat eine feste Höhe (--footer-h) — deshalb einzeilig, ohne
 * eigenen Innenabstand nach oben/unten.
 */
export function FooterHelpLink() {
  return (
    <>
      <span aria-hidden className="mx-2">
        ·
      </span>
      <Link href="/hilfe" className="underline underline-offset-2 hover:text-stone-900 dark:hover:text-stone-100" data-testid="footer-help">
        Hilfe
      </Link>
    </>
  );
}

/**
 * Kontexthilfe: kleiner Link zur passenden Seite der Anwender-Hilfe
 * (/hilfe/…). Standardtext „Wie funktioniert das?“; mit `compact` nur ein
 * „?“ im Kreis, der Text steht dann für Screenreader und als Tooltip da.
 * Ziele in lib/help/links.ts (dort per Test gegen docs/anwender/ geprüft).
 */
export function HelpLink({
  to,
  label = "Wie funktioniert das?",
  compact = false,
  className = "",
}: {
  to: HelpLinkKey;
  label?: string;
  compact?: boolean;
  className?: string;
}) {
  const href = HELP_LINKS[to];
  if (compact) {
    return (
      <Link
        href={href}
        title={label}
        data-testid="help-link"
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-accent-700 ring-1 ring-accent-300 hover:bg-accent-50 max-md:h-11 max-md:w-11 dark:text-accent-300 dark:ring-accent-700 dark:hover:bg-accent-900/40 ${className}`}
      >
        <span aria-hidden>?</span>
        <span className="sr-only">{label}</span>
      </Link>
    );
  }
  return (
    <Link href={href} data-testid="help-link" className={`btn-link inline-flex items-center gap-1 ${className}`}>
      <span
        aria-hidden
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold ring-1 ring-current"
      >
        ?
      </span>
      {label}
    </Link>
  );
}
