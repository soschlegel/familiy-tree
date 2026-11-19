/**
 * Prüfprogramm für eine GEDCOM-Datei vor dem Import:
 *
 *   npm run gedcom:check -- <datei.ged> [--show-names] [--json]
 *                                       [--compare <älterer-export.ged>]
 *
 * Gibt standardmäßig nur Zählungen, Tag-Pfade und Kennungen (@I12@) aus —
 * keine Namen, Daten, Orte oder Texte. `--show-names` ergänzt bei Diagnosen
 * die Namen der betroffenen Personen (nur für den eigenen Gebrauch).
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { diagnoseGedcom, type GedcomDiagnostic } from "./diagnostics";
import { diffDocuments, type DocumentDiff, type RecordDiff } from "./diff";
import { verifyLossless, type LosslessReport } from "./lossless";
import { parseGedcom, type ParseResultWithTrace } from "./parse";
import { writeGedcom } from "./writer";

export interface CheckReport {
  file: string;
  bytes: number;
  millis: number;
  heapMb: number;
  header: Record<string, string | number | undefined>;
  encoding: ParseResultWithTrace["encoding"];
  records: Record<string, number>;
  stats: ParseResultWithTrace["stats"];
  events: Record<string, number>;
  familyStatus: Record<string, number>;
  childKinds: Record<string, number>;
  dateKinds: Record<string, number>;
  identity: Record<string, number>;
  media: Record<string, number>;
  privacy: Record<string, number>;
  warnings: Record<string, number>;
  warningSamples: { code: string; line?: number; message: string }[];
  diagnostics: Record<string, number>;
  diagnosticList: (GedcomDiagnostic & { names?: string[] })[];
  unknownTags: { tag: string; count: number; paths: Record<string, number> }[];
  lossless: Omit<LosslessReport, "lost"> & { lost: number; lostPaths: string[] };
  roundTrip: { equalRecords: boolean; lost: number; warnings: number; differences: string[] };
  compare?: DocumentDiff;
}

const inc = (o: Record<string, number>, k: string, n = 1) => {
  o[k] = (o[k] ?? 0) + n;
};

export function checkGedcom(bytes: Uint8Array, file: string, options: { showNames?: boolean; compareWith?: Uint8Array } = {}): CheckReport {
  const heapBefore = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const r = parseGedcom(bytes, { keepRaw: true });
  const millis = performance.now() - t0;
  const heapMb = Math.max(0, (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024);
  const doc = r.document;
  const h = doc.header;

  const events: Record<string, number> = {};
  const dateKinds: Record<string, number> = {};
  const countDates = (v: unknown) => {
    JSON.stringify(v, (_k, x) => {
      if (x && typeof x === "object" && "kind" in x && "original" in x) inc(dateKinds, x.kind + (x.lenient ? " (nachsichtig)" : ""));
      return x;
    });
  };
  for (const p of doc.persons) for (const e of p.events) inc(events, `INDI ${e.type}`);
  for (const f of doc.families) for (const e of f.events) inc(events, `FAM ${e.type}`);
  countDates(doc);

  const familyStatus: Record<string, number> = {};
  const childKinds: Record<string, number> = {};
  for (const f of doc.families) {
    inc(familyStatus, f.partners.length === 2 ? `${f.status} (${f.statusEvidence})` : `${f.partners.length} Partner`);
    for (const c of f.children) for (const k of c.kinds) inc(childKinds, k);
  }

  const identity: Record<string, number> = { persons: doc.persons.length };
  for (const p of doc.persons) {
    const types = new Set(p.externalIds.map((e) => e.type));
    for (const t of types) inc(identity, `persons with ${t}`);
    if (p.updated) inc(identity, "persons with _UPD");
    if (p.changed) inc(identity, "persons with CHAN");
    const rin = p.externalIds.find((e) => e.type === "RIN")?.value;
    if (rin && rin.replace(/^MH:/, "") === p.id) inc(identity, "persons xref = RIN");
  }
  for (const f of doc.families) if (f.externalIds.some((e) => e.type === "UID")) inc(identity, "families with UID");
  for (const s of doc.sources) if (s.externalIds.some((e) => e.type === "UID" || e.type === "RIN")) inc(identity, "sources with UID/RIN");

  const media: Record<string, number> = { records: doc.media.length };
  const links = [...doc.persons.flatMap((p) => p.media), ...doc.families.flatMap((f) => f.media)];
  for (const l of links) {
    inc(media, l.inline ? "inline links" : "record links");
    if (l.primary) inc(media, "primary");
    for (const f of l.inline?.files ?? []) inc(media, f.isUrl ? "files as URL" : "files as path");
    if (l.inline?.externalIds.some((e) => e.type === "PHOTO_RIN")) inc(media, "with _PHOTO_RIN");
  }
  for (const m of doc.media) for (const f of m.files) inc(media, f.isUrl ? "files as URL" : "files as path");

  const privacy: Record<string, number> = {};
  for (const p of doc.persons) {
    if (p.privacy.restrictions.length) inc(privacy, "RESN");
    if (p.privacy.placeholderName) inc(privacy, "placeholder name");
    if (p.privacy.livingMarked) inc(privacy, "marked living");
    for (const m of p.privacy.markers) if (m.source !== "RESN" && m.source !== "NAME") inc(privacy, m.source);
  }

  const warnings: Record<string, number> = {};
  for (const w of r.warnings) inc(warnings, w.code);

  const diag = diagnoseGedcom(doc);
  const diagnostics: Record<string, number> = {};
  for (const d of diag) inc(diagnostics, `${d.severity} ${d.code}`);
  const names = new Map(doc.persons.map((p) => [p.id, p.names[0]?.full ?? "(ohne Namen)"]));
  const diagnosticList = diag.map((d) => (options.showNames && d.personIds ? { ...d, names: d.personIds.map((id) => names.get(id) ?? "?") } : d));

  const lossless = verifyLossless(r);

  // Roundtrip: schreiben, wieder lesen, Datensatzzahlen vergleichen
  const written = writeGedcom(doc);
  const again = parseGedcom(written.bytes, { keepRaw: true });
  const sameCounts =
    again.document.persons.length === doc.persons.length &&
    again.document.families.length === doc.families.length &&
    again.document.sources.length === doc.sources.length;
  const diffBack = diffDocuments(doc, again.document, { xrefMap: written.idMap, ignoreDateText: true });
  const unchanged = Object.values(diffBack).every((d) => d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0);

  const report: CheckReport = {
    file: basename(file),
    bytes: bytes.length,
    millis: Math.round(millis),
    heapMb: Math.round(heapMb),
    header: {
      producer: h.sourceId,
      producerName: h.sourceName,
      producerVersion: h.sourceVersion,
      gedcomVersion: h.gedcomVersion,
      form: h.gedcomForm,
      charset: h.charset,
      language: h.language,
      exportDate: h.exportDate,
      dialect: h.dialect,
    },
    encoding: r.encoding,
    records: r.stats.records,
    stats: r.stats,
    events,
    familyStatus,
    childKinds,
    dateKinds,
    identity,
    media,
    privacy,
    warnings,
    warningSamples: r.warnings.slice(0, 20).map((w) => ({ code: w.code, line: w.line, message: w.message })),
    diagnostics,
    diagnosticList,
    unknownTags: r.unknownTags.map((u) => ({ tag: u.tag, count: u.count, paths: u.paths })),
    lossless: { ...lossless, lost: lossless.lost.length, lostPaths: [...new Set(lossless.lost.map((l) => l.path))].slice(0, 20) },
    roundTrip: {
      equalRecords: sameCounts && unchanged,
      lost: verifyLossless(again).lost.length,
      warnings: again.warnings.length,
      differences: (Object.entries(diffBack) as [string, RecordDiff][]).flatMap(([kind, d]) => [
        ...d.added.map((x) => `${kind} @${x.id}@ neu`),
        ...d.removed.map((x) => `${kind} @${x.id}@ fehlt`),
        ...d.changed.map((x) => `${kind} @${x.idA}@: ${x.fields.join(", ")}`),
      ]).slice(0, 30),
    },
  };
  if (options.compareWith) {
    report.compare = diffDocuments(parseGedcom(options.compareWith).document, doc);
  }
  return report;
}

function table(title: string, o: Record<string, number | string | undefined>): string {
  const entries = Object.entries(o).filter(([, v]) => v !== undefined);
  if (!entries.length) return `${title}: —`;
  const w = Math.max(...entries.map(([k]) => k.length));
  return `${title}:\n${entries.map(([k, v]) => `  ${k.padEnd(w)}  ${v}`).join("\n")}`;
}

export function formatReport(r: CheckReport): string {
  const out: string[] = [];
  out.push(`GEDCOM-Prüfung: ${r.file} (${(r.bytes / 1024).toFixed(0)} KB, gelesen in ${r.millis} ms)`);
  out.push(table("Kopf", r.header));
  out.push(table("Kodierung", { verwendet: r.encoding.encoding, BOM: r.encoding.bom ? "ja" : "nein", angegeben: r.encoding.declared, erkannt: r.encoding.detectedBy }));
  out.push(table("Datensätze", r.records));
  out.push(
    table("Zeilen", {
      gesamt: r.stats.lines,
      Knoten: r.stats.nodes,
      "CONC/CONT": r.stats.continuationLines,
      leer: r.stats.blankLines,
      repariert: r.stats.repairedLines,
      verworfen: r.stats.skippedLines,
    }),
  );
  out.push(table("Ereignisse", r.events));
  out.push(table("Familienstand", r.familyStatus));
  out.push(table("Eltern-Kind-Arten (je Elternteil)", r.childKinds));
  out.push(table("Datumsformen", r.dateKinds));
  out.push(table("Kennungen", r.identity));
  out.push(table("Medien", r.media));
  out.push(table("Privatsphäre", r.privacy));
  out.push(table("Warnungen", r.warnings));
  for (const w of r.warningSamples) out.push(`  - ${w.code}${w.line ? ` (Zeile ${w.line})` : ""}: ${w.message}`);
  out.push(table("Diagnosen", r.diagnostics));
  for (const d of r.diagnosticList.slice(0, 50)) {
    out.push(`  - [${d.severity}] ${d.message}${d.names ? `  {${d.names.join(" | ")}}` : ""}`);
  }
  if (r.diagnosticList.length > 50) out.push(`  … ${r.diagnosticList.length - 50} weitere`);
  out.push(`Nicht interpretierte Tags (bleiben als Rohdaten erhalten): ${r.unknownTags.length}`);
  for (const u of r.unknownTags) {
    out.push(`  ${u.tag.padEnd(24)} ${String(u.count).padStart(6)}  ${Object.entries(u.paths).map(([p, n]) => `${p}${n !== u.count ? ` (${n})` : ""}`).join(", ")}`);
  }
  out.push(
    `Verlustfreiheit: ${r.lossless.nodes} Knoten — ${r.lossless.consumed} verstanden, ${r.lossless.preserved} als Rohdaten erhalten, ${r.lossless.lost} verloren; Zeilenbilanz ${r.lossless.linesBalanced ? "stimmt" : "STIMMT NICHT"}.`,
  );
  if (r.lossless.lostPaths.length) out.push(`  verloren: ${r.lossless.lostPaths.join(", ")}`);
  out.push(
    `Roundtrip (schreiben und wieder lesen): ${r.roundTrip.equalRecords ? "unverändert" : "ABWEICHUNGEN"}, ${r.roundTrip.lost} verloren, ${r.roundTrip.warnings} Warnungen.`,
  );
  for (const d of r.roundTrip.differences) out.push(`  - ${d}`);
  if (r.compare) {
    out.push("Vergleich mit älterem Export (Schlüssel _UID → RIN → Xref):");
    for (const [k, d] of Object.entries(r.compare)) {
      out.push(`  ${k.padEnd(13)} neu ${d.added.length}, entfernt ${d.removed.length}, geändert ${d.changed.length}, nur Stempel ${d.touched.length}, gleich ${d.unchanged}`);
    }
  }
  return out.join("\n");
}

function main(argv: string[]): number {
  const args = argv.filter((a) => !a.startsWith("--"));
  const showNames = argv.includes("--show-names");
  const json = argv.includes("--json");
  const cmpIdx = argv.indexOf("--compare");
  const compareFile = cmpIdx >= 0 ? argv[cmpIdx + 1] : undefined;
  const file = args.find((a) => a !== compareFile);
  if (!file) {
    console.error("Aufruf: npm run gedcom:check -- <datei.ged> [--show-names] [--json] [--compare <älterer-export.ged>]");
    return 2;
  }
  const report = checkGedcom(readFileSync(file), file, {
    showNames,
    compareWith: compareFile ? readFileSync(compareFile) : undefined,
  });
  console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
  return report.lossless.lost === 0 ? 0 : 1;
}

const invokedDirectly = typeof process !== "undefined" && process.argv[1] && /gedcom[\\/]cli\.ts$/.test(process.argv[1]);
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
