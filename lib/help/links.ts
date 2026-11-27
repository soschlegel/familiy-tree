/**
 * Ziele der Kontexthilfe („Wie funktioniert das?“ in der App) — an einer
 * Stelle, damit tests/help.test.ts prüfen kann, dass es Thema und Anker in
 * docs/anwender/ wirklich gibt. Wird eine Überschrift umbenannt, schlägt der
 * Test fehl, statt dass ein Link still ins Leere zeigt.
 */
export const HELP_LINKS = {
  startseite: "/hilfe/startseite#wie-wird-gezaehlt",
  karte: "/hilfe/karte#wie-wird-gezaehlt",
  zeitreise: "/hilfe/karte#zeitreise-wer-lebte-in-diesem-jahr",
  wurzeln:"/hilfe/karte#wurzeln-auf-der-personenseite",
  lebensweg: "/hilfe/karte#lebensweg",
  orteZuordnen: "/hilfe/orte-zuordnen",
  linien: "/hilfe/stammbaum#linienfarben",
  ringe: "/hilfe/stammbaum#ringe",
  ringeDrucken: "/hilfe/stammbaum#ringe-drucken",
  bezugsperson: "/hilfe/stammbaum#bezugsperson",
  herkunft: "/hilfe/stammbaum#herkunft",
  herkunftPerson: "/hilfe/personen#herkunft",
  lebenslauf: "/hilfe/personen#lebenslauf",
  dubletten: "/hilfe/dubletten",
  dublettenKlassen: "/hilfe/dubletten#was-bedeuten-sicher-wahrscheinlich-und-unklar",
  dublettenKi: "/hilfe/dubletten#von-der-ki-vorgepruefte-paare",
  kiZugang: "/hilfe/ki-zugang",
  einstellungen: "/hilfe/einstellungen",
  zeitgeschichteVerwalten: "/hilfe/einstellungen#zeitgeschichte",
  zeitgeschichteBaum: "/hilfe/stammbaum#zeitgeschichte-im-zeitstrahl",
  zeitgeschichteKarte: "/hilfe/karte#zeitgeschichte-in-der-zeitreise",
  zeitgeschichteLebenslauf: "/hilfe/personen#zeitgeschichte-im-lebenslauf",
  statistik: "/hilfe/statistik",
  rekorde: "/hilfe/statistik#rekorde",
  fortschritt: "/hilfe/statistik#forschungs-fortschritt",
  verwandtschaft: "/hilfe/verwandtschaft",
  verwandtschaftFreigabe: "/hilfe/verwandtschaft#nicht-freigegebene-personen",
  importVorschlaege: "/hilfe/import-und-export#vorschlaege-personen-die-es-schon-gibt",
} as const;

export type HelpLinkKey = keyof typeof HELP_LINKS;
