#!/usr/bin/env node
/**
 * Erzeugt die mitgelieferten Geodaten für Karte und Ortszuordnung
 * (README, „Karte und Orte“). Läuft NICHT zur Laufzeit und nicht im Build —
 * nur, wenn jemand die Dateien neu erzeugen will. Die Eingaben lädt man
 * vorher selbst in einen eigenen, leeren Ordner außerhalb des Repositorys:
 *
 *   GeoNames (CC BY 4.0, https://www.geonames.org/), aus
 *   https://download.geonames.org/export/dump/ :
 *     cities1000.zip (entpackt: cities1000.txt), admin1CodesASCII.txt,
 *     countryInfo.txt, DE.zip, AT.zip, CH.zip (entpackt: DE.txt, AT.txt, CH.txt),
 *     alternatenames/<LAND>.zip für alle europäischen Länder (entpackt in
 *     den Unterordner alt/, z.B. alt/PL.txt)
 *   Natural Earth (gemeinfrei, https://www.naturalearthdata.com/), aus
 *   https://github.com/nvkelso/natural-earth-vector (Tag v5.1.2):
 *     geojson/ne_50m_admin_0_countries.geojson
 *
 *   node scripts/build-geodata.mjs <geonames-ordner> <naturalearth-ordner>
 *
 * Ausgaben (im Repository):
 *   geo/gazetteer.tsv.gz        Ortsverzeichnis für die Zuordnung (nur Server)
 *   public/geo/countries.json   Ländergrenzen, bereits projiziert (Browser)
 *
 * Auswahl (Größe im Griff): Deutschland, Österreich, Schweiz mit ALLEN
 * bewohnten Orten (auch Dörfer und Ortsteile, inkl. historischer), übriges
 * Europa ab 1000 Einwohnern, Rest der Welt ab 5000 Einwohnern; dazu die
 * Verwaltungsregionen erster Ebene (Bundesländer, Bundesstaaten …), alle
 * Länder und eine kleine Liste historischer Landschaften (Schlesien, Banat
 * …) mit ungefährer Mitte. Weitere Namen nur in lateinischer Schrift.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const [, , geonamesDir, naturalEarthDir] = process.argv;
if (!geonamesDir || !naturalEarthDir) {
  console.error("Aufruf: node scripts/build-geodata.mjs <geonames-ordner> <naturalearth-ordner>");
  process.exit(2);
}
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

const FULL_COUNTRIES = new Set(["DE", "AT", "CH"]);
const WORLD_MIN_POP = 15000;
/** Sprachen, deren Namen aus den GeoNames-Alternativnamen übernommen werden ("" = ohne Angabe). */
const ALT_LANGS = new Set(["", "de", "en", "fr", "it", "nl", "pl", "cs", "sk", "hu", "ro", "hr", "sl", "sr", "bs", "da", "sv", "no", "nb", "nn", "lt", "lv", "et", "la", "lb", "rm", "pt", "es", "ca", "fi", "nds", "gsw", "bar", "fy", "lmo", "fur", "hsb", "dsb", "csb", "szl"]);

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

const readLines = (file) => fs.readFileSync(file, "utf8").split("\n").filter((l) => l && !l.startsWith("#"));

/** Wie lib/places/normalize.ts (normalizeForLookup) — bei Änderungen beide anpassen. */
function norm(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[łŁ]/g, "l")
    .replace(/[øØ]/g, "o")
    .replace(/[đĐ]/g, "d")
    .replace(/[æÆ]/g, "ae")
    .replace(/[œŒ]/g, "oe")
    .toLowerCase()
    .replace(/[’'`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const LATIN = /^[\p{Script=Latin}\p{Nd}\s'’.\-()/,]+$/u;
// Kürzel aus Großbuchstaben (Flughafen-, Postcodes) fallen weg — außer bei
// Ländern („USA“, „UK“, „DDR“).
const goodAlt = (n, codes = false) =>
  n.length >= 2 && n.length <= 60 && LATIN.test(n) && (codes || !/^[A-Z0-9]{2,5}$/.test(n)) && /\p{L}/u.test(n);

function altNames(main, raw, codes = false) {
  const seen = new Set([norm(main)]);
  const out = [];
  for (const n of (raw ?? "").split(",")) {
    const t = n.trim();
    if (!goodAlt(t, codes)) continue;
    const k = norm(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

const round = (v, d = 2) => Number(Number(v).toFixed(d));

// ---------------------------------------------------------------------------
// Länder
// ---------------------------------------------------------------------------

const countryInfo = new Map(); // ISO2 -> { name, continent, geonameId }
for (const line of readLines(path.join(geonamesDir, "countryInfo.txt"))) {
  const c = line.split("\t");
  // Amtssprachen, erste zuerst („pl“, „de-CH“ → „de“).
  const langs = (c[15] ?? "").split(",").map((l) => l.split("-")[0]).filter(Boolean);
  countryInfo.set(c[0], { name: c[4], continent: c[8], geonameId: c[16], langs });
}
const isEurope = (cc) => countryInfo.get(cc)?.continent === "EU";

const ne = JSON.parse(fs.readFileSync(path.join(naturalEarthDir, "ne_50m_admin_0_countries.geojson"), "utf8"));
const NE_NAME_KEYS = ["NAME_DE", "NAME_EN", "NAME", "NAME_LONG", "FORMAL_EN", "NAME_FR", "NAME_IT", "NAME_NL", "NAME_PL", "NAME_HU", "NAME_ES", "NAME_PT", "NAME_SV", "NAME_TR"];
const isoOf = (p) => (p.ISO_A2 && p.ISO_A2 !== "-99" ? p.ISO_A2 : p.ISO_A2_EH && p.ISO_A2_EH !== "-99" ? p.ISO_A2_EH : null);

/** Deutsche und historische Ländernamen, die Natural Earth nicht kennt. */
const EXTRA_COUNTRY_NAMES = {
  DE: ["Deutsches Reich", "Preußen", "Preussen", "Prussia", "Königreich Preußen", "DDR", "BRD", "Bundesrepublik Deutschland", "Deutschland", "Allemagne", "West Germany", "East Germany", "Germany"],
  AT: ["Österreich-Ungarn", "Austria-Hungary", "Österreich", "Cisleithanien"],
  CZ: ["Tschechoslowakei", "Czechoslovakia", "ČSSR", "Böhmen und Mähren"],
  RS: ["Jugoslawien", "Yugoslavia", "Serbien"],
  RU: ["Sowjetunion", "UdSSR", "USSR", "Soviet Union", "Russisches Reich", "Russian Empire", "Russland"],
  US: ["USA", "U.S.A.", "Vereinigte Staaten", "Vereinigte Staaten von Amerika", "Amerika", "United States of America", "United States"],
  GB: ["England", "Großbritannien", "Grossbritannien", "Vereinigtes Königreich", "UK", "Great Britain", "United Kingdom"],
  NL: ["Holland", "Niederlande"],
  MD: ["Moldawien", "Moldau"],
  BY: ["Weißrussland", "Weissrussland"],
  HU: ["Königreich Ungarn", "Ungarn"],
};

const countries = new Map(); // ISO2 -> { names[], lat, lon }
for (const f of ne.features) {
  const p = f.properties;
  const iso = isoOf(p);
  if (!iso) continue;
  const names = [];
  for (const k of NE_NAME_KEYS) if (typeof p[k] === "string" && p[k]) names.push(p[k]);
  const ex = countries.get(iso);
  if (ex) {
    ex.names.push(...names);
    continue;
  }
  countries.set(iso, { names, lat: p.LABEL_Y, lon: p.LABEL_X });
}
for (const [iso, info] of countryInfo) {
  const c = countries.get(iso);
  if (c) c.names.push(info.name);
}
for (const [iso, names] of Object.entries(EXTRA_COUNTRY_NAMES)) countries.get(iso)?.names.push(...names);

// ---------------------------------------------------------------------------
// Orte
// ---------------------------------------------------------------------------

/** Zeilen des Ortsverzeichnisses: [id, name, alts, lat, lon, cc, admin1, pop, kind] */
const rows = [];
const admin1Weights = new Map(); // "DE.09" -> { sx, sy, w }

function addPlace(c, kind = "P") {
  // geonameid, name, asciiname, alternatenames, lat, lon, fclass, fcode, cc, cc2, a1, a2, a3, a4, pop
  const pop = Number(c[14]) || 0;
  const name = c[1];
  // Europa: weitere Namen später aus den Alternativnamen je Land (mit
  // Sprache). Übrige Welt: höchstens vier lateinische Namen aus der
  // Städteliste, bevorzugt solche mit demselben Anfang wie der Hauptname
  // (z.B. „New York“ für „New York City“, „Saint Louis“ für „St. Louis“).
  const head = norm(name).slice(0, 3);
  const alts = isEurope(c[8])
    ? altNames(name, c[2])
    : altNames(name, `${c[2]},${c[3]}`)
        .map((n) => ({ n, s: (norm(n).startsWith(head) ? 0 : 100) + n.length }))
        .sort((a, b) => a.s - b.s)
        .slice(0, 4)
        .map((x) => x.n);
  rows.push([c[0], name, alts.join(";"), round(c[4]), round(c[5]), c[8], c[10] || "", pop || "", kind, ""]);
  if (kind === "P" && c[10]) {
    const k = `${c[8]}.${c[10]}`;
    const w = Math.max(pop, 1000);
    const a = admin1Weights.get(k) ?? { sx: 0, sy: 0, w: 0 };
    a.sx += Number(c[5]) * w;
    a.sy += Number(c[4]) * w;
    a.w += w;
    admin1Weights.set(k, a);
  }
}

const adm1Features = new Map(); // "DE.09" -> Spalten des ADM1-Eintrags (nur DE/AT/CH)
const seenIds = new Set();
for (const cc of FULL_COUNTRIES) {
  for (const line of readLines(path.join(geonamesDir, `${cc}.txt`))) {
    const c = line.split("\t");
    if (c[6] === "A" && c[7] === "ADM1") adm1Features.set(`${c[8]}.${c[10]}`, c);
    if (c[6] !== "P") continue;
    seenIds.add(c[0]);
    addPlace(c);
  }
}
for (const line of readLines(path.join(geonamesDir, "cities1000.txt"))) {
  const c = line.split("\t");
  if (seenIds.has(c[0])) continue;
  const cc = c[8];
  if (FULL_COUNTRIES.has(cc)) continue;
  const pop = Number(c[14]) || 0;
  const seat = /^PPLA\d?$|^PPLC$/.test(c[7]);
  if (!isEurope(cc) && pop < WORLD_MIN_POP && !seat) continue;
  addPlace(c);
}

// Regionen erster Ebene
const admin1Names = new Map();
for (const line of readLines(path.join(geonamesDir, "admin1CodesASCII.txt"))) {
  const [code, name, ascii, id] = line.split("\t");
  admin1Names.set(code, { name, ascii, id });
}
/** Deutsche Anzeigenamen für Regionen im deutschen Sprachraum. */
const ADMIN1_DE = {
  "DE.01": "Baden-Württemberg", "DE.02": "Bayern", "DE.03": "Bremen", "DE.04": "Hamburg", "DE.05": "Hessen",
  "DE.06": "Niedersachsen", "DE.07": "Nordrhein-Westfalen", "DE.08": "Rheinland-Pfalz", "DE.09": "Saarland",
  "DE.10": "Schleswig-Holstein", "DE.11": "Brandenburg", "DE.12": "Mecklenburg-Vorpommern", "DE.13": "Sachsen",
  "DE.14": "Sachsen-Anhalt", "DE.15": "Thüringen", "DE.16": "Berlin",
  "AT.01": "Burgenland", "AT.02": "Kärnten", "AT.03": "Niederösterreich", "AT.04": "Oberösterreich", "AT.05": "Salzburg",
  "AT.06": "Steiermark", "AT.07": "Tirol", "AT.08": "Vorarlberg", "AT.09": "Wien",
  "CH.ZH": "Zürich", "CH.SG": "St. Gallen", "CH.LU": "Luzern", "CH.GR": "Graubünden", "CH.GE": "Genf", "CH.VD": "Waadt",
  "CH.VS": "Wallis", "CH.TI": "Tessin", "CH.NE": "Neuenburg", "CH.FR": "Freiburg", "CH.BS": "Basel-Stadt",
};
for (const [code, v] of admin1Names) {
  const de = ADMIN1_DE[code];
  if (de) admin1Names.set(code, { ...v, name: de, ascii: `${v.name},${v.ascii}` });
}
for (const [code, { name, ascii, id }] of admin1Names) {
  const [cc, a1] = code.split(".");
  const feat = adm1Features.get(code);
  let lat, lon;
  let alts = altNames(name, ascii);
  if (feat) {
    lat = feat[4];
    lon = feat[5];
    alts = altNames(name, `${ascii},${feat[1]},${feat[3]}`);
  } else {
    const w = admin1Weights.get(code);
    if (!w) continue;
    lat = w.sy / w.w;
    lon = w.sx / w.w;
  }
  rows.push([id, name, alts.join(";"), round(lat), round(lon), cc, a1, "", "A", ""]);
}

// Weitere Namen europäischer Orte und Regionen aus den Alternativnamen je
// Land (alternatenames/<LAND>.txt): nur ausgewählte Sprachen, historische
// Namen („Breslau“, „Paane“, „Temeswar“) eingeschlossen.
// Anzeige (Entscheidung des Eigentümers): heutiger offizieller Name vorn,
// der deutsche bzw. historische Name in Klammern — „Wrocław (Breslau)“.
// Hauptname = GeoNames-Name; ist der nur der englische („Munich“), der Name
// in der Landessprache („München“). Spalte 10 = deutscher Name (heutig vor
// historisch), leer wenn er dem Hauptnamen entspricht.
const placeRows = new Map(rows.map((r) => [r[0], r]));
const altDir = path.join(geonamesDir, "alt");
let altCount = 0;
let localNames = 0;
let germanNames = 0;
/** Vergleich ohne Umlaut-Umschreibung: „Muenchen“ ist kein eigener Name. */
const foldDe = (n) => norm(n.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue"));
const fixRomanian = (n) => n.replace(/ş/g, "ș").replace(/Ş/g, "Ș").replace(/ţ/g, "ț").replace(/Ţ/g, "Ț");
for (const [cc, info] of countryInfo) {
  if (!isEurope(cc)) continue;
  const file = path.join(altDir, `${cc}.txt`);
  if (!fs.existsSync(file)) continue;
  const extra = new Map();
  const english = new Map(); // geonameid -> Set englischer Namen
  const local = new Map(); // geonameid -> { name, rank }
  const german = new Map(); // geonameid -> [{ name, rank }]
  const better = (map, id, name, rank) => {
    const prev = map.get(id);
    if (!prev || rank < prev.rank) map.set(id, { name, rank });
  };
  for (const line of readLines(file)) {
    // alternateNameId, geonameid, isolanguage, alternate name, isPreferred, isShort, isColloquial, isHistoric, from, to
    const a = line.split("	");
    if (!placeRows.has(a[1])) continue;
    if (a[2] === "en") {
      const set = english.get(a[1]) ?? new Set();
      set.add(a[3]);
      english.set(a[1], set);
    }
    if (!ALT_LANGS.has(a[2])) continue;
    if (a[6] === "1" && a[7] !== "1") continue; // umgangssprachlich
    const list = extra.get(a[1]) ?? [];
    list.push(a[3]);
    extra.set(a[1], list);
    if (!goodAlt(a[3])) continue;
    const pref = a[4] === "1" ? 0 : a[5] === "1" ? 1 : 2;
    const historic = a[7] === "1";
    const li = info.langs.indexOf(a[2]);
    // Nur die erste Amtssprache: „Lviv“ soll nicht zum polnischen „Lwów“ werden.
    if (li === 0 && !historic) better(local, a[1], a[3], pref);
    if (a[2] === "de") german.set(a[1], [...(german.get(a[1]) ?? []), { name: a[3], rank: (historic ? 10 : 0) + pref }]);
  }
  for (const [id, names] of extra) {
    const r = placeRows.get(id);
    // Regionen im deutschen Sprachraum haben schon deutsche Namen (ADMIN1_DE).
    const keepMain = r[8] === "A" && FULL_COUNTRIES.has(r[5]);
    let main = r[1];
    const loc = local.get(id)?.name;
    if (!keepMain && loc && english.get(id)?.has(main) && loc !== main) {
      main = loc;
      localNames++;
    }
    if (cc === "RO") main = fixRomanian(main);
    // Deutscher Name, der sich wirklich unterscheidet (nicht „Wroclaw“ für
    // „Wrocław“): heutige vor historischen, bevorzugte zuerst.
    // Deutscher Sprachraum: keine Klammer (Entscheidung des Eigentümers).
    const de = FULL_COUNTRIES.has(r[5])
      ? ""
      : ((german.get(id) ?? []).filter((g) => foldDe(g.name) !== foldDe(main)).sort((x, y) => x.rank - y.rank)[0]?.name ?? "");
    if (de) germanNames++;
    const merged = altNames(main, [r[1], r[2].replace(/;/g, ","), ...names].join(","));
    altCount += merged.length;
    r[1] = main;
    r[2] = merged.join(";");
    r[9] = de;
  }
}
console.log(`Weitere Namen (Europa): ${altCount}, Namen in Landessprache: ${localNames}, deutsche Namen: ${germanNames}`);

// Länder
for (const [iso, c] of countries) {
  const info = countryInfo.get(iso);
  const main = c.names[0];
  rows.push([info?.geonameId ?? "", main, altNames(main, c.names.join(","), true).join(";"), round(c.lat), round(c.lon), iso, "", "", "C", ""]);
}

// Historische Landschaften (ungefähre Mitte, von Hand; Präzision „Region“).
const HISTORIC = [
  ["Schlesien", "Silesia;Śląsk;Slezsko", 51.0, 16.8, "PL"],
  ["Oberschlesien", "Upper Silesia;Górny Śląsk", 50.4, 18.4, "PL"],
  ["Niederschlesien", "Lower Silesia;Dolny Śląsk", 51.1, 16.2, "PL"],
  ["Ostpreußen", "Ostpreussen;East Prussia;Prusy Wschodnie", 54.4, 21.0, "PL"],
  ["Westpreußen", "Westpreussen;West Prussia", 53.6, 18.4, "PL"],
  ["Pommern", "Pomerania;Pomorze;Hinterpommern", 53.9, 15.8, "PL"],
  ["Provinz Posen", "Posen (Provinz);Grand Duchy of Posen", 52.4, 17.2, "PL"],
  ["Böhmen", "Bohemia;Čechy;Boehmen", 49.9, 14.4, "CZ"],
  ["Mähren", "Moravia;Morava;Maehren", 49.4, 17.0, "CZ"],
  ["Sudetenland", "", 50.4, 14.2, "CZ"],
  ["Banat", "Bánság", 45.6, 21.2, "RO"],
  ["Batschka", "Bačka;Bácska", 45.6, 19.4, "RS"],
  ["Siebenbürgen", "Transylvania;Transilvania;Erdély;Siebenbuergen", 46.6, 24.4, "RO"],
  ["Bukowina", "Bukovina", 47.9, 25.6, "RO"],
  ["Galizien", "Galicia (Ostmitteleuropa);Galicja", 49.8, 22.5, "PL"],
  ["Bessarabien", "Bessarabia", 46.8, 28.8, "MD"],
  ["Dobrudscha", "Dobruja;Dobrogea", 44.3, 28.3, "RO"],
  ["Wolhynien", "Volhynia;Wołyń", 50.8, 25.5, "UA"],
  ["Kurland", "Courland;Kurzeme", 56.8, 22.3, "LV"],
  ["Livland", "Livonia", 57.6, 25.6, "LV"],
  ["Krain", "Carniola;Kranjska", 46.1, 14.6, "SI"],
  ["Südtirol", "South Tyrol;Alto Adige;Suedtirol", 46.7, 11.4, "IT"],
  ["Elsass", "Alsace;Elsaß", 48.3, 7.5, "FR"],
  ["Lothringen", "Lorraine", 48.9, 6.3, "FR"],
  ["Elsass-Lothringen", "Alsace-Lorraine;Reichsland Elsaß-Lothringen", 48.6, 7.0, "FR"],
  ["Ostfriesland", "East Frisia", 53.4, 7.5, "DE"],
  ["Mecklenburg", "", 53.6, 12.2, "DE"],
  ["Holstein", "", 54.1, 10.2, "DE"],
  ["Westfalen", "Westphalia;Provinz Westfalen", 51.8, 8.0, "DE"],
  ["Rheinprovinz", "Rhine Province;Rheinland", 50.8, 6.9, "DE"],
  ["Württemberg", "Wuerttemberg;Kingdom of Württemberg", 48.6, 9.3, "DE"],
  ["Hohenzollern", "Hohenzollernsche Lande", 48.2, 9.1, "DE"],
  ["Pfalz", "Rheinpfalz;Palatinate;Kurpfalz", 49.4, 7.9, "DE"],
  ["Franken", "Franconia", 49.7, 10.8, "DE"],
  ["Oberfranken", "Upper Franconia", 50.0, 11.3, "DE"],
  ["Mittelfranken", "Middle Franconia", 49.3, 10.6, "DE"],
  ["Unterfranken", "Lower Franconia", 50.0, 9.9, "DE"],
  ["Oberpfalz", "Upper Palatinate", 49.4, 12.1, "DE"],
  ["Schwaben", "Swabia", 48.3, 10.4, "DE"],
  ["Hessen-Nassau", "Hesse-Nassau", 50.7, 9.0, "DE"],
  ["Hunsrück", "Hunsrueck", 49.9, 7.3, "DE"],
  ["Eifel", "", 50.3, 6.7, "DE"],
  ["Pommern (Vorpommern)", "Vorpommern;Western Pomerania", 54.0, 13.4, "DE"],
];
HISTORIC.forEach(([name, alts, lat, lon, cc], i) => {
  rows.push([`h${i + 1}`, name, altNames(name, alts.replace(/;/g, ",")).join(";"), lat, lon, cc, "", "", "H", ""]);
});

// ---------------------------------------------------------------------------
// Schreiben: Ortsverzeichnis
// ---------------------------------------------------------------------------

const header = [
  "# Ortsverzeichnis für die Ortszuordnung (scripts/build-geodata.mjs).",
  "# Quelle: GeoNames (https://www.geonames.org/), Lizenz CC BY 4.0;",
  "# Länder-Mittelpunkte: Natural Earth (gemeinfrei). Historische Landschaften von Hand.",
  "# Spalten: id, name, weitere Namen (;), lat, lon, Land, Region-Code, Einwohner, Art (P Ort, A Region, H hist. Landschaft, C Land), deutscher Name (wenn abweichend)",
];
const text = [...header, ...rows.map((r) => r.join("\t"))].join("\n") + "\n";
fs.mkdirSync(path.join(ROOT, "geo"), { recursive: true });
const gz = zlib.gzipSync(Buffer.from(text, "utf8"), { level: 9 });
fs.writeFileSync(path.join(ROOT, "geo", "gazetteer.tsv.gz"), gz);
const kinds = rows.reduce((m, r) => ((m[r[8]] = (m[r[8]] ?? 0) + 1), m), {});
console.log(`Ortsverzeichnis: ${rows.length} Einträge ${JSON.stringify(kinds)}, ${(text.length / 1e6).toFixed(1)} MB roh, ${(gz.length / 1e6).toFixed(2)} MB gzip`);

// ---------------------------------------------------------------------------
// Ländergrenzen: Mercator, vereinfacht, als SVG-Pfade
// ---------------------------------------------------------------------------

/** Wie lib/map/projection.ts — Breite der Weltkarte in Einheiten. */
const WORLD = 1000;
const MAX_LAT = 84;
const project = (lon, lat) => {
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return [((lon + 180) / 360) * WORLD, ((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2) * WORLD];
};

function simplify(points, tolerance) {
  // Douglas-Peucker, iterativ.
  if (points.length <= 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const t2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let max = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      let d2;
      if (len2 === 0) d2 = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d2 = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      }
      if (d2 > max) {
        max = d2;
        idx = i;
      }
    }
    if (max > t2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const SCALE = 10; // eine Nachkommastelle in Karteneinheiten (~0,04° am Äquator)
function ringPath(ring, tolerance) {
  const pts = simplify(ring.map(([lon, lat]) => project(lon, lat)), tolerance);
  if (pts.length < 4) return "";
  const q = pts.map(([x, y]) => [Math.round(x * SCALE), Math.round(y * SCALE)]);
  let d = `M${q[0][0] / SCALE} ${q[0][1] / SCALE}`;
  let [px, py] = q[0];
  let segs = 0;
  for (let i = 1; i < q.length; i++) {
    const [x, y] = q[i];
    if (x === px && y === py) continue;
    d += `l${(x - px) / SCALE} ${(y - py) / SCALE}`;
    px = x;
    py = y;
    segs++;
  }
  return segs >= 2 ? `${d}z` : "";
}

const outCountries = [];
for (const f of ne.features) {
  const p = f.properties;
  if (p.ADM0_A3 === "ATA") continue; // Antarktis: auf Mercator unbrauchbar
  const iso = isoOf(p) ?? p.ADM0_A3;
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  // Europa feiner als der Rest der Welt.
  const europe = p.CONTINENT === "Europe" || ["TR", "CY", "GE", "AM", "AZ"].includes(iso);
  const tol = europe ? 0.06 : 0.15;
  const d = polys
    .map((poly) => poly.map((ring) => ringPath(ring, tol)).join(""))
    .join("");
  if (!d) continue;
  outCountries.push({ id: iso, name: p.NAME_DE || p.NAME, d });
}
const countriesJson = {
  attribution: "Ländergrenzen: Natural Earth (gemeinfrei), naturalearthdata.com — heutige Grenzen",
  projection: { type: "mercator", world: WORLD, maxLat: MAX_LAT },
  countries: outCountries,
};
fs.mkdirSync(path.join(ROOT, "public", "geo"), { recursive: true });
const cj = JSON.stringify(countriesJson);
fs.writeFileSync(path.join(ROOT, "public", "geo", "countries.json"), cj);
console.log(`Ländergrenzen: ${outCountries.length} Länder, ${(cj.length / 1e3).toFixed(0)} KB (gzip ${(zlib.gzipSync(cj).length / 1e3).toFixed(0)} KB)`);
