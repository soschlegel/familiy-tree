/**
 * Adresse der Seite „Wie sind wir verwandt?“ mit den beiden Personen als
 * Suchparameter `a` und `b` (teilbar; fehlende werden weggelassen). Für
 * Server- und Client-Komponenten.
 */
export function kinshipHref(a: string | null | undefined, b: string | null | undefined): string {
  const sp = new URLSearchParams();
  if (a) sp.set("a", a);
  if (b) sp.set("b", b);
  const s = sp.toString();
  return s ? `/kinship?${s}` : "/kinship";
}
