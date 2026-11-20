import { safeHttpUrl, urlHost } from "@/lib/source-classify";

/**
 * Link zum Eintrag eines Belegs bei einem Anbieter („Eintrag öffnen ·
 * www.myheritage.de“). Die Adresse stammt oft aus einer importierten Datei —
 * also nicht vertrauenswürdig: nur http/https (erneut geprüft), neues
 * Fenster ohne Verweis zurück, nie serverseitig abgerufen.
 */
export function CitationLink({ url, className = "" }: { url: string | null | undefined; className?: string }) {
  const safe = safeHttpUrl(url);
  if (!safe) return null;
  const host = urlHost(safe);
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className={`text-xs text-accent-700 underline-offset-2 hover:underline dark:text-accent-300 ${className}`}
      title={safe}
      data-testid="citation-link"
    >
      Eintrag öffnen{host ? ` · ${host}` : ""}
    </a>
  );
}
