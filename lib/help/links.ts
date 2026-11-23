/**
 * Ziele der Kontexthilfe („Wie funktioniert das?“ in der App) — an einer
 * Stelle, damit tests/help.test.ts prüfen kann, dass es Thema und Anker in
 * docs/anwender/ wirklich gibt. Wird eine Überschrift umbenannt, schlägt der
 * Test fehl, statt dass ein Link still ins Leere zeigt.
 */
export const HELP_LINKS = {
  karte: "/hilfe/karte#wie-wird-gezaehlt",
  orteZuordnen: "/hilfe/orte-zuordnen",
  linien: "/hilfe/stammbaum#linienfarben",
  bezugsperson: "/hilfe/stammbaum#bezugsperson",
  dubletten: "/hilfe/dubletten",
  dublettenKlassen: "/hilfe/dubletten#was-bedeuten-sicher-wahrscheinlich-und-unklar",
  dublettenKi: "/hilfe/dubletten#von-der-ki-vorgepruefte-paare",
  kiZugang: "/hilfe/ki-zugang",
} as const;

export type HelpLinkKey = keyof typeof HELP_LINKS;
