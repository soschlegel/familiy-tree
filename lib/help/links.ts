/**
 * Ziele der Kontexthilfe („Wie funktioniert das?“ in der App) — an einer
 * Stelle, damit tests/help.test.ts prüfen kann, dass es Thema und Anker in
 * docs/anwender/ wirklich gibt. Wird eine Überschrift umbenannt, schlägt der
 * Test fehl, statt dass ein Link still ins Leere zeigt.
 */
export const HELP_LINKS = {
  karte: "/hilfe/karte#wie-wird-gezaehlt",
  wurzeln: "/hilfe/karte#wurzeln-auf-der-personenseite",
  orteZuordnen: "/hilfe/orte-zuordnen",
  linien: "/hilfe/stammbaum#linienfarben",
  bezugsperson: "/hilfe/stammbaum#bezugsperson",
  herkunft: "/hilfe/stammbaum#herkunft",
  herkunftPerson: "/hilfe/personen#herkunft",
  dubletten: "/hilfe/dubletten",
  dublettenKlassen: "/hilfe/dubletten#was-bedeuten-sicher-wahrscheinlich-und-unklar",
  dublettenKi: "/hilfe/dubletten#von-der-ki-vorgepruefte-paare",
  kiZugang: "/hilfe/ki-zugang",
  einstellungen: "/hilfe/einstellungen",
  statistik: "/hilfe/statistik",
  importVorschlaege: "/hilfe/import-und-export#vorschlaege-personen-die-es-schon-gibt",
} as const;

export type HelpLinkKey = keyof typeof HELP_LINKS;
