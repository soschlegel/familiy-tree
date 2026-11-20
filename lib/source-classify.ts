/**
 * Quellen aus Importen einordnen — rein, ohne Datenbank. Genealogie-Anbieter
 * (MyHeritage, Ancestry, FamilySearch …) liefern ihre Quellen mit eigenen
 * Tags (`_TYPE`, `_MEDI`), Titeln wie „… Stammbäume“ und Links in Text und
 * Fundstellen. Daraus werden Art, Anbieter und Internetadresse; HTML wird
 * Text. Nichts ist an einen Anbieter fest verdrahtet: unbekannte Anbieter
 * fallen auf die allgemeinen Muster zurück.
 */
import { htmlToText, looksLikeHtml } from "./gedcom/html";

/** Arten wie in prisma/schema.prisma (SourceKind). */
export type ClassifiedKind =
  | "CHURCH_BOOK"
  | "CIVIL_REGISTRY"
  | "CENSUS"
  | "GRAVESTONE"
  | "FAMILY_DOCUMENT"
  | "ORAL"
  | "WEBSITE"
  | "ONLINE_TREE"
  | "ONLINE_COLLECTION"
  | "OTHER";

/** Bekannte Anbieter: Anzeigename und Erkennung (Hostname bzw. Name im Text). */
export const PROVIDERS: { name: string; hosts: RegExp; text: RegExp }[] = [
  { name: "MyHeritage", hosts: /(^|\.)myheritage\.[a-z.]+$|(^|\.)mhcache\.com$/i, text: /\bmy\s?heritage\b/i },
  { name: "Ancestry", hosts: /(^|\.)ancestry(library)?\.[a-z.]+$/i, text: /\bancestry(\.com)?\b/i },
  { name: "FamilySearch", hosts: /(^|\.)familysearch\.org$/i, text: /\bfamily\s?search\b/i },
  { name: "Geneanet", hosts: /(^|\.)geneanet\.org$/i, text: /\bgeneanet\b/i },
  { name: "Filae", hosts: /(^|\.)filae\.com$/i, text: /\bfilae\b/i },
  { name: "Geni", hosts: /(^|\.)geni\.com$/i, text: /\bgeni\.com\b/i },
  { name: "WikiTree", hosts: /(^|\.)wikitree\.com$/i, text: /\bwikitree\b/i },
  { name: "Find a Grave", hosts: /(^|\.)findagrave\.com$/i, text: /\bfind\s?a\s?grave\b/i },
  { name: "BillionGraves", hosts: /(^|\.)billiongraves\.com$/i, text: /\bbilliongraves\b/i },
  { name: "Matricula", hosts: /(^|\.)matricula-online\.eu$/i, text: /\bmatricula\b/i },
  { name: "Archion", hosts: /(^|\.)archion\.de$/i, text: /\barchion\b/i },
  { name: "CompGen", hosts: /(^|\.)(compgen|genealogy)\.(de|net)$/i, text: /\bcompgen\b/i },
  { name: "Geneee/OFB", hosts: /(^|\.)online-ofb\.de$/i, text: /\bonline-ofb\b/i },
];

/** Stammbäume anderer Nutzer (abgeleitet, nicht unabhängig). */
const TREE = /stammb[äa]ume?\b|family\s?trees?\b|smart\s?match|world\s?family\s?tree|familienstammbaum|online[- ]?stammbaum|user\s?trees?|member\s?trees?|public\s?member|geni\b|wikitree/i;
/** Was eine Sammlung IST, unabhängig vom Anbieter. */
const CONTENT: [RegExp, ClassifiedKind][] = [
  [/kirch|church|pfarr|parish|tauf|bapt|christening|kirchenb|matrik/i, "CHURCH_BOOK"],
  [/standesamt|civil|vital\s?records?|personenstand|zivilstand|état\s?civil|etat\s?civil|geburtsregister|heiratsregister|sterberegister|births?,?\s+marriages?|deaths?\s+index/i, "CIVIL_REGISTRY"],
  [/census|volksz|zensus|einwohner|recensement/i, "CENSUS"],
  [/grab|grave|cemetery|friedhof|tomb|burials?\b|sépulture/i, "GRAVESTONE"],
  [/mündlich|oral|interview|erzähl/i, "ORAL"],
  [/famili(en)?(papiere|unterlagen|bibel|chronik)|brief|letter|bibel|bible|tagebuch|diary/i, "FAMILY_DOCUMENT"],
];
/** Hinweise auf eine Online-Sammlung/Datenbank. */
const COLLECTION = /collection|sammlung|datenbank|database|index\b|records?\b|verzeichnis|archiv|newspaper|zeitung|adressb|directory|online/i;

export type SourceEvidence = {
  title?: string | null;
  type?: string | null; // _TYPE
  medium?: string | null; // _MEDI
  author?: string | null;
  publication?: string | null; // PUBL
  repository?: string | null; // REPO.NAME
  text?: string | null; // TEXT, NOTE
  urls?: string[]; // WWW/_URL/_LINK
  /** PAGE-Angaben der Belege, die auf diese Quelle verweisen (Beispiele genügen). */
  citationPages?: string[];
};

export type ClassifiedSource = {
  kind: ClassifiedKind;
  /** Freie Art (z.B. das _TYPE der Datei), wenn sie mehr sagt als die Art. */
  kindLabel: string | null;
  provider: string | null;
  url: string | null;
  /** Stammbaum anderer Nutzer o.ä. — Verlässlichkeit der Belege wird begrenzt. */
  derived: boolean;
};

const URL_RE = /\bhttps?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?]/gi;

/** Alle http(s)-Adressen in einem Text (auch in HTML-Links). */
export function findUrls(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(/href\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) out.push(m[1]);
  for (const m of text.matchAll(URL_RE)) out.push(m[0]);
  return [...new Set(out.map(decodeAmp))];
}
const decodeAmp = (u: string) => u.replace(/&amp;/g, "&");

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Anbieter aus Adressen bzw. Text; null, wenn keiner erkennbar ist. */
export function detectProvider(urls: string[], texts: (string | null | undefined)[]): string | null {
  for (const u of urls) {
    const h = hostOf(u);
    if (!h) continue;
    const p = PROVIDERS.find((x) => x.hosts.test(h));
    if (p) return p.name;
  }
  const joined = texts.filter(Boolean).join("\n");
  return PROVIDERS.find((x) => x.text.test(joined))?.name ?? null;
}

/** HTML → Text (Original bleibt in den Rohdaten); sonst unverändert. */
export function plainText(s: string | null | undefined): string | null {
  if (!s) return s ?? null;
  const t = looksLikeHtml(s) ? htmlToText(s) : s;
  return t.trim() || null;
}

export function classifySource(e: SourceEvidence): ClassifiedSource {
  const title = plainText(e.title) ?? "";
  const type = plainText(e.type) ?? "";
  const medium = plainText(e.medium) ?? "";
  const text = [plainText(e.publication), plainText(e.text), plainText(e.author), plainText(e.repository)].filter(Boolean).join("\n");
  const urls = [
    ...(e.urls ?? []).flatMap((u) => findUrls(u)),
    ...findUrls(e.text),
    ...findUrls(e.publication),
    ...(e.citationPages ?? []).flatMap((p) => findUrls(p)),
  ];
  const provider = detectProvider(urls, [title, type, medium, text]);
  // Eigene Adresse der Quelle: zuerst ausdrücklich angegebene, sonst die aus
  // dem Text (nicht die Fundstellen einzelner Belege).
  const ownUrl = [...(e.urls ?? []).flatMap((u) => findUrls(u)), ...findUrls(e.text), ...findUrls(e.publication)].find((u) => hostOf(u)) ?? null;
  const label = type || null;
  const head = `${title}\n${type}\n${medium}`;

  // 1. Was die Quelle IST (Kirchenbuch, Volkszählung …) — auch wenn ein
  //    Anbieter sie online bereitstellt.
  for (const [re, kind] of CONTENT) {
    if (re.test(head)) return { kind, kindLabel: label && !re.test(label) ? label : null, provider, url: ownUrl, derived: false };
  }
  // 2. Stammbäume anderer Nutzer
  if (TREE.test(head)) return { kind: "ONLINE_TREE", kindLabel: label, provider, url: ownUrl, derived: true };
  // 3. Sammlung/Datenbank eines Anbieters
  if (provider && (COLLECTION.test(head) || COLLECTION.test(text) || urls.length > 0)) {
    return { kind: "ONLINE_COLLECTION", kindLabel: label, provider, url: ownUrl, derived: false };
  }
  // 4. Allgemeine Webseite
  if (/web|online|internet|site|www\./i.test(head) || ownUrl) return { kind: "WEBSITE", kindLabel: label, provider, url: ownUrl, derived: false };
  return { kind: "OTHER", kindLabel: label, provider, url: ownUrl, derived: false };
}

/**
 * Fundstelle eines Belegs: Steht darin eine Adresse, wird sie zur
 * Internetadresse des Belegs, und der Rest bleibt Fundstelle (oder leer).
 */
export function splitCitationPage(page: string | null | undefined): { detail: string | null; url: string | null } {
  const text = plainText(page);
  if (!text) return { detail: null, url: null };
  const url = findUrls(page).find((u) => hostOf(u)) ?? null;
  if (!url) return { detail: text, url: null };
  const rest = text
    .replace(url, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, "")
    .trim();
  return { detail: rest || null, url };
}

/** Höchstlänge einer gespeicherten Beleg- bzw. Quellenadresse. */
export const MAX_URL_LENGTH = 2000;

/**
 * Nur unbedenkliche Adressen: http/https, ohne Zugangsdaten, begrenzt lang.
 * Sonst null. Die App ruft solche Adressen nie selbst ab und leitet nie
 * darauf um — sie werden nur als Link angezeigt (rel="noopener noreferrer").
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v || v.length > MAX_URL_LENGTH) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Hostname für die Anzeige („www.myheritage.de“). */
export function urlHost(value: string | null | undefined): string | null {
  try {
    return value ? new URL(value).hostname : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Anzeige: unabhängig davon, ob die Zeile schon neu eingelesen wurde
// ---------------------------------------------------------------------------

/**
 * Beleg zur Anzeige: Steht im gespeicherten Beleg (ältere Importe) die
 * Adresse noch in der Fundstelle, wird sie hier herausgelöst — mit derselben
 * Prüfung wie gespeicherte Adressen; HTML in der Fundstelle wird Text.
 */
export function displayCitation(c: { detail: string | null; url: string | null }): { detail: string | null; url: string | null } {
  const stored = safeHttpUrl(c.url);
  if (stored) return { detail: plainText(c.detail), url: stored };
  if (!c.detail) return { detail: null, url: null };
  const split = splitCitationPage(c.detail);
  const url = safeHttpUrl(split.url);
  return url ? { detail: split.detail, url } : { detail: plainText(c.detail), url: null };
}

/**
 * Art und Anbieter zur Anzeige: Ist eine Quelle als „Sonstige“ bzw.
 * „Webseite“ gespeichert (ältere Importe), ordnet die Einordnung sie anhand
 * von Titel, Art-Bezeichnung, Notizen, Adresse und einigen Fundstellen ein —
 * einmal je Quelle, nicht je Beleg. Gespeichertes anderer Arten bleibt.
 */
export function displaySourceKind<K extends string>(
  s: { kind: K; kindLabel: string | null; title: string; notes?: string | null; url?: string | null; provider?: string | null },
  citationDetails: (string | null)[] = [],
): { kind: K | "ONLINE_TREE" | "ONLINE_COLLECTION"; provider: string | null } {
  if (s.kind !== "OTHER" && s.kind !== "WEBSITE") return { kind: s.kind, provider: s.provider ?? null };
  const c = classifySource({
    title: s.title,
    type: s.kindLabel,
    text: s.notes ?? null,
    urls: s.url ? [s.url] : [],
    citationPages: citationDetails.filter((x): x is string => Boolean(x)).slice(0, 20),
  });
  if (c.kind === "ONLINE_TREE" || c.kind === "ONLINE_COLLECTION") return { kind: c.kind, provider: s.provider ?? c.provider };
  return { kind: s.kind, provider: s.provider ?? c.provider };
}
