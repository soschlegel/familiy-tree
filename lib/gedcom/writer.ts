/**
 * Zwischenmodell → GEDCOM 5.5.1 (UTF-8, optional mit BOM).
 *
 * Streng beim Schreiben: Kopf mit dieser App als Quelle, Pflicht-SUBM,
 * Zeilen höchstens 255 Bytes (UTF-8) mit CONC/CONT an Code-Point-Grenzen und
 * nie an einem Leerzeichen, `@` als `@@`, Daten aus der Struktur (englische
 * GEDCOM-Monatskürzel), Kennungen höchstens 20 Zeichen. Nicht Verstandenes
 * aus dem Import (`extensions`) wird an derselben Stelle zurückgeschrieben.
 */

import { formatGedcomDate } from "./dates";
import { encodeUtf8 } from "./encoding";
import { FAMILY_EVENT_TAGS, INDIVIDUAL_EVENT_TAGS } from "./interpret";
import { UNMARRIED_MARKER } from "./relationships";
import type {
  GedcomAddress,
  GedcomChildKind,
  GedcomCitation,
  GedcomDocument,
  GedcomEvent,
  GedcomEventType,
  GedcomExtension,
  GedcomExternalId,
  GedcomFamily,
  GedcomMediaLink,
  GedcomMediaObject,
  GedcomName,
  GedcomNode,
  GedcomNoteRef,
  GedcomPerson,
  GedcomPlace,
  GedcomPrivacy,
  GedcomSource,
  GedcomWarning,
} from "./types";

export interface WriteOptions {
  /** UTF-8-BOM voranstellen (manche Windows-Programme erwarten es). Standard: false. */
  bom?: boolean;
  /** Zeilenende; Standard CRLF (wie die meisten Programme). */
  lineEnding?: "\r\n" | "\n";
  /** HEAD.SOUR: Kennung, Name, Version dieser App. */
  sourceId?: string;
  sourceName?: string;
  sourceVersion?: string;
  /** Exportzeitpunkt (Standard: jetzt). */
  now?: Date;
  /** HEAD.LANG (Standard: aus dem Dokument, sonst "German"). */
  language?: string;
  /** Name des Einsenders, falls das Dokument keinen hat. */
  submitterName?: string;
  /** Nicht Verstandenes aus dem Import zurückschreiben (Standard: true). */
  includeExtensions?: boolean;
  /** Maximale Zeilenlänge in Bytes (Standard 255). */
  maxLineBytes?: number;
}

export interface WriteResult {
  text: string;
  bytes: Uint8Array;
  /** Alte Kennung → geschriebene Kennung (ohne @). */
  idMap: Record<string, string>;
  warnings: GedcomWarning[];
}

const EVENT_TAG_INDI: Record<string, string> = Object.fromEntries(
  Object.entries(INDIVIDUAL_EVENT_TAGS).map(([tag, type]) => [type, tag]),
);
const EVENT_TAG_FAM: Record<string, string> = Object.fromEntries(Object.entries(FAMILY_EVENT_TAGS).map(([tag, type]) => [type, tag]));

const ID_TAG_OUT: Record<string, string> = {
  UID: "_UID",
  RIN: "RIN",
  AFN: "AFN",
  REFN: "REFN",
  EXID: "EXID",
  FSID: "_FSFTID",
  APID: "_APID",
  PHOTO_RIN: "_PHOTO_RIN",
  PROJECT_GUID: "_PROJECT_GUID",
  SITE_ID: "_EXPORTED_FROM_SITE_ID",
};

const PEDI_OUT: Record<GedcomChildKind, string | undefined> = {
  BIOLOGICAL: "birth",
  ADOPTIVE: "adopted",
  FOSTER: "foster",
  STEP: "step",
  OTHER: undefined,
};
const REL_OUT: Record<GedcomChildKind, string> = {
  BIOLOGICAL: "Natural",
  ADOPTIVE: "Adopted",
  FOSTER: "Foster",
  STEP: "Step",
  OTHER: "Unknown",
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// ---------------------------------------------------------------------------
// Knoten bauen
// ---------------------------------------------------------------------------

const node = (tag: string, value?: string, children: GedcomNode[] = []): GedcomNode => {
  const n: GedcomNode = { tag, children };
  if (value !== undefined && value !== "") n.value = value;
  return n;
};
const ptr = (tag: string, id: string, children: GedcomNode[] = []): GedcomNode => ({ tag, pointer: id, children });

class Builder {
  readonly warnings: GedcomWarning[] = [];
  constructor(
    private readonly idMap: Map<string, string>,
    private readonly includeExt: boolean,
    private readonly doc: GedcomDocument,
  ) {}

  id(old: string): string {
    return this.idMap.get(old) ?? old;
  }

  /** Erweiterungen an den passenden Stellen einhängen (Pfad relativ zu `target`). */
  merge(target: GedcomNode, exts: GedcomExtension[] | undefined): void {
    if (!this.includeExt || !exts) return;
    for (const e of exts) {
      let at = target;
      for (const tag of e.path) {
        let next = at.children.find((c) => c.tag === tag);
        if (!next) {
          next = node(tag);
          at.children.push(next);
        }
        at = next;
      }
      at.children.push(this.remap(e.node));
    }
  }

  /** Zeiger in Rohdaten auf neue Kennungen umschreiben. */
  remap(n: GedcomNode): GedcomNode {
    const out: GedcomNode = { tag: n.tag, children: n.children.map((c) => this.remap(c)) };
    if (n.xref !== undefined) out.xref = this.id(n.xref);
    if (n.value !== undefined) out.value = n.value;
    if (n.pointer !== undefined) out.pointer = this.id(n.pointer);
    return out;
  }

  ids(list: GedcomExternalId[]): GedcomNode[] {
    return list.map((x) => {
      const tag = ID_TAG_OUT[x.type] ?? `_${x.type.replace(/[^A-Za-z0-9_]/g, "_")}`;
      return node(tag, x.value, x.scheme !== undefined ? [node("TYPE", x.scheme)] : []);
    });
  }

  stamps(t: { changed?: string; updated?: string }): GedcomNode[] {
    const out: GedcomNode[] = [];
    if (t.changed) {
      const m = t.changed.trim().match(/^(.*?)\s+(\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/);
      const date = node("DATE", m ? m[1] : t.changed.trim());
      if (m) date.children.push(node("TIME", m[2]));
      out.push(node("CHAN", undefined, [date]));
    }
    if (t.updated) out.push(node("_UPD", t.updated));
    return out;
  }

  privacy(p: GedcomPrivacy | undefined): GedcomNode[] {
    if (!p) return [];
    const out = p.restrictions.map((r) => node("RESN", r));
    for (const m of p.markers) {
      if (m.source === "RESN" || m.source === "NAME") continue;
      out.push(node(m.source, m.value));
    }
    return out;
  }

  note(n: GedcomNoteRef): GedcomNode {
    const out = n.noteId ? ptr("NOTE", this.id(n.noteId)) : node("NOTE", n.content?.original ?? n.content?.text ?? "");
    out.children.push(...n.citations.map((c) => this.citation(c)));
    this.merge(out, n.extensions);
    return out;
  }

  citation(c: GedcomCitation): GedcomNode {
    const out = c.sourceId ? ptr("SOUR", this.id(c.sourceId)) : node("SOUR", c.inlineText ?? "");
    if (c.page !== undefined) out.children.push(node("PAGE", c.page));
    if (c.eventType !== undefined || c.role !== undefined) {
      out.children.push(node("EVEN", c.eventType, c.role !== undefined ? [node("ROLE", c.role)] : []));
    }
    if (c.sourceId) {
      if (c.date || c.texts.length) {
        const data = node("DATA");
        if (c.date) data.children.push(node("DATE", formatGedcomDate(c.date)));
        data.children.push(...c.texts.map((t) => node("TEXT", t)));
        out.children.push(data);
      }
    } else {
      out.children.push(...c.texts.map((t) => node("TEXT", t)));
      if (c.date) out.children.push(node("DATA", undefined, [node("DATE", formatGedcomDate(c.date))]));
    }
    if (c.quality !== undefined) out.children.push(node("QUAY", String(c.quality)));
    out.children.push(...c.notes.map((n) => this.note(n)));
    out.children.push(...c.media.map((m) => this.mediaLink(m)));
    out.children.push(...this.ids(c.externalIds));
    this.merge(out, c.extensions);
    return out;
  }

  address(a: GedcomAddress | undefined): GedcomNode[] {
    if (!a) return [];
    const out: GedcomNode[] = [];
    const hasAddr = a.text !== undefined || a.lines?.length || a.city || a.state || a.postalCode || a.country;
    if (hasAddr) {
      const addr = node("ADDR", a.text);
      (a.lines ?? []).forEach((l, i) => addr.children.push(node(`ADR${Math.min(i + 1, 3)}`, l)));
      if (a.city !== undefined) addr.children.push(node("CITY", a.city));
      if (a.state !== undefined) addr.children.push(node("STAE", a.state));
      if (a.postalCode !== undefined) addr.children.push(node("POST", a.postalCode));
      if (a.country !== undefined) addr.children.push(node("CTRY", a.country));
      out.push(addr);
    }
    out.push(...a.phones.map((v) => node("PHON", v)));
    out.push(...a.emails.map((v) => node("EMAIL", v)));
    out.push(...a.faxes.map((v) => node("FAX", v)));
    out.push(...a.urls.map((v) => node("WWW", v)));
    return out;
  }

  place(p: GedcomPlace): GedcomNode {
    const out = node("PLAC", p.name);
    if (p.form && p.form.join(", ") !== (this.doc.header.placeForm ?? []).join(", ")) out.children.push(node("FORM", p.form.join(", ")));
    if (p.latitude !== undefined || p.longitude !== undefined) {
      const map = node("MAP");
      if (p.latitude !== undefined) map.children.push(node("LATI", `${p.latitude < 0 ? "S" : "N"}${Math.abs(p.latitude)}`));
      if (p.longitude !== undefined) map.children.push(node("LONG", `${p.longitude < 0 ? "W" : "E"}${Math.abs(p.longitude)}`));
      out.children.push(map);
    }
    out.children.push(...p.notes.map((n) => this.note(n)));
    out.children.push(...p.citations.map((c) => this.citation(c)));
    this.merge(out, p.extensions);
    return out;
  }

  mediaObjectChildren(m: GedcomMediaObject): GedcomNode[] {
    const out: GedcomNode[] = [];
    for (const f of m.files) {
      const file = node("FILE", f.location);
      if (f.format !== undefined || f.mediaType !== undefined) {
        file.children.push(node("FORM", f.format ?? guessFormat(f.location), f.mediaType !== undefined ? [node("TYPE", f.mediaType)] : []));
      }
      if (f.title !== undefined) file.children.push(node("TITL", f.title));
      out.push(file);
    }
    if (m.title !== undefined) out.push(node("TITL", m.title));
    if (m.fileSize !== undefined) out.push(node("_FILESIZE", String(m.fileSize)));
    out.push(...m.notes.map((n) => this.note(n)));
    out.push(...m.citations.map((c) => this.citation(c)));
    out.push(...this.ids(m.externalIds));
    out.push(...this.stamps(m));
    return out;
  }

  mediaLink(l: GedcomMediaLink): GedcomNode {
    const out = l.mediaId ? ptr("OBJE", this.id(l.mediaId)) : node("OBJE");
    if (l.inline) out.children.push(...this.mediaObjectChildren(l.inline));
    if (l.title !== undefined) out.children.push(node("TITL", l.title));
    if (l.primary) out.children.push(node("_PRIM", "Y"));
    if (l.personalPhoto !== undefined) out.children.push(node("_PERSONALPHOTO", l.personalPhoto ? "Y" : "N"));
    if (l.cutout !== undefined) out.children.push(node("_CUTOUT", l.cutout ? "Y" : "N"));
    if (l.primaryCutout !== undefined) out.children.push(node("_PRIM_CUTOUT", l.primaryCutout ? "Y" : "N"));
    if (l.inline) this.merge(out, l.inline.extensions);
    this.merge(out, l.extensions);
    return out;
  }

  event(e: GedcomEvent, family: boolean): GedcomNode {
    const table = family ? EVENT_TAG_FAM : EVENT_TAG_INDI;
    let tag = table[e.type] ?? EVENT_TAG_INDI[e.type] ?? EVENT_TAG_FAM[e.type];
    if (!tag) {
      tag = e.type.endsWith("ATTRIBUTE") ? "FACT" : "EVEN";
    }
    const out = node(tag, e.value);
    if (e.label !== undefined) out.children.push(node("TYPE", e.label));
    else if ((tag === "EVEN" || tag === "FACT") && e.type !== "CUSTOM_EVENT" && e.type !== "CUSTOM_ATTRIBUTE") {
      out.children.push(node("TYPE", e.type));
    }
    if (e.date) out.children.push(node("DATE", formatGedcomDate(e.date)));
    if (e.place) out.children.push(this.place(e.place));
    out.children.push(...this.address(e.address));
    if (e.age !== undefined) out.children.push(node("AGE", e.age));
    if (e.partnerAges?.husband !== undefined) out.children.push(node("HUSB", undefined, [node("AGE", e.partnerAges.husband)]));
    if (e.partnerAges?.wife !== undefined) out.children.push(node("WIFE", undefined, [node("AGE", e.partnerAges.wife)]));
    if (e.agency !== undefined) out.children.push(node("AGNC", e.agency));
    if (e.religion !== undefined) out.children.push(node("RELI", e.religion));
    if (e.cause !== undefined) out.children.push(node("CAUS", e.cause));
    if (e.adoption?.familyId) {
      out.children.push(ptr("FAMC", this.id(e.adoption.familyId), e.adoption.by !== undefined ? [node("ADOP", e.adoption.by)] : []));
    }
    out.children.push(...this.privacy(e.privacy));
    out.children.push(...e.notes.map((n) => this.note(n)));
    out.children.push(...e.citations.map((c) => this.citation(c)));
    out.children.push(...e.media.map((m) => this.mediaLink(m)));
    out.children.push(...this.ids(e.externalIds));
    if (e.preferred !== undefined) out.children.push(node("_PRIM", e.preferred ? "Y" : "N"));
    out.children.push(...this.stamps(e));
    this.merge(out, e.extensions);
    return out;
  }

  name(n: GedcomName): GedcomNode {
    let value = n.original;
    if (!value || !sameNameParts(value, n)) {
      const given = n.given ?? "";
      const sur = n.surname ?? "";
      value = `${given} /${sur}/${n.suffix ? ` ${n.suffix}` : ""}`.trim();
    }
    const out = node("NAME", value);
    if (n.typeLabel !== undefined || n.type !== undefined) out.children.push(node("TYPE", n.typeLabel ?? n.type!.toLowerCase()));
    if (n.prefix !== undefined) out.children.push(node("NPFX", n.prefix));
    if (n.given !== undefined) out.children.push(node("GIVN", n.given));
    if (n.nickname !== undefined) out.children.push(node("NICK", n.nickname));
    if (n.surnamePrefix !== undefined) out.children.push(node("SPFX", n.surnamePrefix));
    if (n.surname !== undefined) out.children.push(node("SURN", n.surname));
    if (n.suffix !== undefined) out.children.push(node("NSFX", n.suffix));
    if (n.callName !== undefined) out.children.push(node("_RUFNAME", n.callName));
    out.children.push(...n.marriedSurnames.map((s) => node("_MARNM", s)));
    out.children.push(...n.aliases.map((s) => node("_AKA", s)));
    for (const v of n.variants) {
      out.children.push(node(v.kind === "phonetic" ? "FONE" : "ROMN", v.value, v.method !== undefined ? [node("TYPE", v.method)] : []));
    }
    if (n.preferred !== undefined) out.children.push(node("_PRIM", n.preferred ? "Y" : "N"));
    out.children.push(...n.notes.map((x) => this.note(x)));
    out.children.push(...n.citations.map((c) => this.citation(c)));
    this.merge(out, n.extensions);
    return out;
  }

  person(p: GedcomPerson, index: FamilyIndex, adoptionFamilies: Set<string>): GedcomNode {
    const out: GedcomNode = { tag: "INDI", xref: this.id(p.id), children: [] };
    out.children.push(...this.privacy(p.privacy));
    out.children.push(...p.names.map((n) => this.name(n)));
    if (p.sex !== "UNKNOWN" || p.sexRaw !== undefined) {
      let sex = p.sexRaw ?? { MALE: "M", FEMALE: "F", OTHER: "U", UNKNOWN: "U" }[p.sex];
      if (p.sex === "OTHER" && !p.sexRaw) {
        this.warnings.push({ code: "INCONSISTENT_LINK", message: "Geschlecht „divers“ gibt es in GEDCOM 5.5.1 nicht — als U geschrieben.", recordId: p.id });
      }
      if (!/^[MFU]$/.test(sex)) sex = "U";
      out.children.push(node("SEX", sex));
    } else out.children.push(node("SEX", "U"));
    out.children.push(...p.events.map((e) => this.event(e, false)));

    // FAMC: Reihenfolge der Person zuerst, dann übrige.
    const asChild = [...(index.asChild.get(p.id) ?? [])];
    asChild.sort((a, b) => orderIndex(p.parentFamilies, a.id) - orderIndex(p.parentFamilies, b.id));
    for (const f of asChild) {
      const c = f.children.find((x) => x.childId === p.id)!;
      const famc = ptr("FAMC", this.id(f.id));
      const pedi = pediFor(f, c, adoptionFamilies.has(`${p.id} ${f.id}`));
      if (pedi !== undefined) famc.children.push(node("PEDI", pedi));
      if (c.status !== undefined) famc.children.push(node("STAT", c.status));
      famc.children.push(...c.notes.map((n) => this.note(n)));
      this.merge(famc, c.childSideExtensions);
      out.children.push(famc);
    }
    const asPartner = [...(index.asPartner.get(p.id) ?? [])];
    asPartner.sort(
      (a, b) =>
        orderIndex(p.spouseFamilies.map((s) => s.familyId), a.id) - orderIndex(p.spouseFamilies.map((s) => s.familyId), b.id),
    );
    for (const f of asPartner) {
      const fams = ptr("FAMS", this.id(f.id));
      this.merge(fams, p.spouseFamilies.find((s) => s.familyId === f.id)?.extensions);
      out.children.push(fams);
    }
    out.children.push(...p.notes.map((n) => this.note(n)));
    out.children.push(...p.citations.map((c) => this.citation(c)));
    out.children.push(...p.media.map((m) => this.mediaLink(m)));
    out.children.push(...this.ids(p.externalIds));
    out.children.push(...this.stamps(p));
    this.merge(out, p.extensions);
    return out;
  }

  family(f: GedcomFamily, sexOf: Map<string, string>): GedcomNode {
    const out: GedcomNode = { tag: "FAM", xref: this.id(f.id), children: [] };
    out.children.push(...this.privacy(f.privacy));
    const roles = f.partnerRoles.length === f.partners.length ? f.partnerRoles : rolesBySex(f.partners, sexOf);
    f.partners.forEach((pid, i) => out.children.push(ptr(roles[i], this.id(pid))));
    const sameRoles = roles.length === 2 && roles[0] === roles[1];
    for (const c of f.children) {
      const chil = ptr("CHIL", this.id(c.childId));
      // Arten verschieden je Elternteil: _FREL/_MREL (FTM/Legacy-Praxis).
      if (c.kinds.length === 2 && c.kinds[0] !== c.kinds[1]) {
        c.kinds.forEach((k, i) => {
          const label = c.kindLabels[i];
          const tag = (sameRoles ? i === 0 : roles[i] === "HUSB") ? "_FREL" : "_MREL";
          chil.children.push(node(tag, label !== undefined && labelMatches(label, k) ? label : REL_OUT[k]));
        });
      }
      this.merge(chil, c.familySideExtensions);
      out.children.push(chil);
    }
    const events = [...f.events];
    out.children.push(...events.map((e) => this.event(e, true)));
    // Familienstand: nur ausdrücklich Bekanntes schreiben.
    const hasMarr = f.events.some((e) => e.type === "MARRIAGE");
    const hasDiv = f.events.some((e) => e.type === "DIVORCE" || e.type === "ANNULMENT");
    if (f.statusMarker && f.statusMarker.tag !== "NO") {
      out.children.push(node(f.statusMarker.tag, f.statusMarker.value));
    } else if (f.status === "UNMARRIED" && !f.events.some((e) => e.type === "MARRIAGE")) {
      out.children.push(node("_STAT", UNMARRIED_MARKER));
    } else if (f.status === "MARRIED" && !hasMarr) {
      out.children.push(node("MARR", "Y"));
    }
    if (f.status === "DIVORCED" && !hasDiv) out.children.push(node("DIV", "Y"));
    out.children.push(...f.notes.map((n) => this.note(n)));
    out.children.push(...f.citations.map((c) => this.citation(c)));
    out.children.push(...f.media.map((m) => this.mediaLink(m)));
    out.children.push(...this.ids(f.externalIds));
    out.children.push(...this.stamps(f));
    this.merge(out, f.extensions);
    return out;
  }

  source(s: GedcomSource): GedcomNode {
    const out: GedcomNode = { tag: "SOUR", xref: this.id(s.id), children: [] };
    if (s.title !== undefined) out.children.push(node("TITL", s.title));
    if (s.abbreviation !== undefined) out.children.push(node("ABBR", s.abbreviation));
    if (s.author !== undefined) out.children.push(node("AUTH", s.author));
    if (s.publication !== undefined) out.children.push(node("PUBL", s.publication));
    if (s.text !== undefined) out.children.push(node("TEXT", s.text));
    if (s.dataEvents.length || s.dataAgency !== undefined) {
      const data = node("DATA");
      for (const d of s.dataEvents) {
        const ev = node("EVEN", d.types);
        if (d.date) ev.children.push(node("DATE", formatGedcomDate(d.date)));
        if (d.place !== undefined) ev.children.push(node("PLAC", d.place));
        data.children.push(ev);
      }
      if (s.dataAgency !== undefined) data.children.push(node("AGNC", s.dataAgency));
      out.children.push(data);
    }
    for (const r of s.repositories) {
      const repo = r.repositoryId ? ptr("REPO", this.id(r.repositoryId)) : node("REPO", r.name);
      r.callNumbers.forEach((cn, i) =>
        repo.children.push(node("CALN", cn, i === 0 && r.mediaType !== undefined ? [node("MEDI", r.mediaType)] : [])),
      );
      if (!r.callNumbers.length && r.mediaType !== undefined) repo.children.push(node("CALN", undefined, [node("MEDI", r.mediaType)]));
      repo.children.push(...r.notes.map((n) => this.note(n)));
      this.merge(repo, r.extensions);
      out.children.push(repo);
    }
    out.children.push(...s.urls.map((u) => node("WWW", u)));
    if (s.sourceType !== undefined) out.children.push(node("_TYPE", s.sourceType));
    if (s.medium !== undefined) out.children.push(node("_MEDI", s.medium));
    out.children.push(...s.notes.map((n) => this.note(n)));
    out.children.push(...s.media.map((m) => this.mediaLink(m)));
    out.children.push(...this.ids(s.externalIds));
    out.children.push(...this.stamps(s));
    this.merge(out, s.extensions);
    return out;
  }
}

interface FamilyIndex {
  asChild: Map<string, GedcomFamily[]>;
  asPartner: Map<string, GedcomFamily[]>;
}

function orderIndex(order: string[], id: string): number {
  const i = order.indexOf(id);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
}

function labelMatches(label: string, kind: GedcomChildKind): boolean {
  const l = label.trim().toLowerCase();
  const map: Record<GedcomChildKind, RegExp> = {
    BIOLOGICAL: /^(birth|natural|biological|leiblich|blood)$/,
    ADOPTIVE: /^(adopted|adoptive|adoption|adoptiert)$/,
    FOSTER: /^(foster|pflege|pflegekind)$/,
    STEP: /^(step|stepchild|stief|stiefkind)$/,
    OTHER: /.*/,
  };
  return map[kind].test(l);
}

/** PEDI für INDI.FAMC: nur wenn eindeutig und nötig. */
function pediFor(f: GedcomFamily, c: GedcomFamily["children"][number], viaAdoptionEvent: boolean): string | undefined {
  if (f.partners.length === 0) return c.kindLabels[0];
  const kinds = c.kinds;
  if (!kinds.length || kinds.some((k) => k !== kinds[0])) return undefined;
  const label = c.kindLabels.find((l) => l !== undefined);
  if (label !== undefined && labelMatches(label, kinds[0])) return label;
  if (!c.explicit) return undefined;
  // Adoption nur über ein ADOP-Ereignis belegt: das Ereignis sagt es schon.
  if (viaAdoptionEvent && label === undefined) return undefined;
  return PEDI_OUT[kinds[0]] ?? label;
}

function rolesBySex(partners: string[], sexOf: Map<string, string>): ("HUSB" | "WIFE")[] {
  if (partners.length === 1) return [sexOf.get(partners[0]) === "FEMALE" ? "WIFE" : "HUSB"];
  if (partners.length === 2 && sexOf.get(partners[0]) === "FEMALE" && sexOf.get(partners[1]) === "MALE") return ["WIFE", "HUSB"];
  return partners.map((_, i) => (i === 0 ? "HUSB" : "WIFE"));
}

/**
 * Passt der ursprüngliche NAME-Wert noch zu den Teilen? GIVN/SURN dürfen
 * kürzer sein (SURN ohne „von“) — der Wert muss sie nur enthalten. Sonst
 * wird der Wert aus den Teilen neu gebildet.
 */
function sameNameParts(original: string, n: GedcomName): boolean {
  const m = original.match(/^([^/]*)\/([^/]*)\/?(.*)$/);
  const surnamePart = m ? m[2] : "";
  if (n.surname !== undefined && !surnamePart.includes(n.surname)) return false;
  if (n.given !== undefined && !original.includes(n.given)) return false;
  return true;
}

function guessFormat(location: string): string {
  const m = location.match(/\.([a-z0-9]{2,5})(?:[?#].*)?$/i);
  return m ? m[1].toLowerCase() : "jpg";
}

// ---------------------------------------------------------------------------
// Kennungen
// ---------------------------------------------------------------------------

const XREF_OK = /^[A-Za-z0-9_]{1,20}$/;

function buildIdMap(doc: GedcomDocument): Map<string, string> {
  const map = new Map<string, string>();
  const taken = new Set<string>();
  const groups: [string, { id?: string }[]][] = [
    ["U", doc.submitters],
    ["I", doc.persons],
    ["F", doc.families],
    ["S", doc.sources],
    ["R", doc.repositories],
    ["N", doc.notes],
    ["M", doc.media],
  ];
  for (const r of doc.unknownRecords) if (r.xref) taken.add(r.xref);
  // Erst gültige Kennungen übernehmen, dann den Rest neu vergeben.
  for (const [, list] of groups) {
    for (const item of list) {
      const id = item.id;
      if (id && XREF_OK.test(id) && !taken.has(id)) {
        map.set(id, id);
        taken.add(id);
      }
    }
  }
  for (const [prefix, list] of groups) {
    let n = 0;
    for (const item of list) {
      const id = item.id;
      if (!id || map.has(id)) continue;
      let candidate: string;
      do candidate = `${prefix}${++n}`;
      while (taken.has(candidate));
      taken.add(candidate);
      map.set(id, candidate);
    }
  }
  for (const r of doc.unknownRecords) if (r.xref && !map.has(r.xref)) map.set(r.xref, r.xref);
  return map;
}

// ---------------------------------------------------------------------------
// Zeilen
// ---------------------------------------------------------------------------

const utf8Len = (s: string) => {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
};

/** `@` verdoppeln, Kalender-Escapes (@#D…@) unverändert lassen. */
export function escapeValue(v: string): string {
  if (!v.includes("@")) return v;
  return v.split(/(@#[A-Z][^@]*@)/).map((part, i) => (i % 2 === 1 ? part : part.replace(/@/g, "@@"))).join("");
}

/**
 * Teilt einen Wert in Stücke von höchstens `maxBytes` Bytes, an
 * Code-Point-Grenzen, möglichst nicht neben einem Leerzeichen und nie
 * mitten in einem `@@`.
 */
export function splitForConc(value: string, maxBytes: number): string[] {
  const chars = [...value];
  const pieces: string[] = [];
  let start = 0;
  while (start < chars.length) {
    let bytes = 0;
    let end = start;
    while (end < chars.length) {
      const b = utf8Len(chars[end]);
      if (bytes + b > maxBytes) break;
      bytes += b;
      end++;
    }
    if (end < chars.length) {
      // Zurückgehen, bis weder vor noch nach der Trennstelle ein Leerzeichen
      // steht und kein @@ zerrissen wird.
      let cut = end;
      const ok = (i: number) =>
        i > start && chars[i - 1] !== " " && chars[i] !== " " && !(chars[i - 1] === "@" && chars[i] === "@");
      while (cut > start + 1 && !ok(cut) && end - cut < 40) cut--;
      if (ok(cut)) end = cut;
      else {
        // Notfall: wenigstens kein @@ zerreißen.
        while (end > start + 1 && chars[end - 1] === "@" && chars[end] === "@") end--;
      }
    }
    pieces.push(chars.slice(start, end).join(""));
    start = end;
  }
  return pieces.length ? pieces : [""];
}

function serialize(n: GedcomNode, level: number, out: string[], maxBytes: number): void {
  let head = `${level}`;
  if (n.xref !== undefined) head += ` @${n.xref}@`;
  head += ` ${n.tag}`;
  if (n.pointer !== undefined) {
    out.push(`${head} @${n.pointer}@`);
  } else if (n.value === undefined || n.value === "") {
    out.push(head);
  } else {
    const lines = n.value.replace(/\r\n?/g, "\n").split("\n");
    const contHead = `${level + 1} CONT`;
    const concHead = `${level + 1} CONC`;
    lines.forEach((line, li) => {
      const prefix = li === 0 ? head : contHead;
      const escaped = escapeValue(line);
      const room = maxBytes - Math.max(utf8Len(prefix), utf8Len(concHead)) - 1;
      const pieces = escaped === "" ? [""] : splitForConc(escaped, Math.max(room, 16));
      pieces.forEach((piece, pi) => {
        const p = pi === 0 ? prefix : concHead;
        out.push(piece === "" ? p : `${p} ${piece}`);
      });
    });
  }
  for (const c of n.children) serialize(c, level + 1, out, maxBytes);
}

function gedcomDate(d: Date): { date: string; time: string } {
  const pad = (x: number) => String(x).padStart(2, "0");
  return {
    date: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
  };
}

// ---------------------------------------------------------------------------
// Öffentlich
// ---------------------------------------------------------------------------

/** 7.0-Sprachcodes (BCP 47) → 5.5.1-Sprachnamen. */
const LANGUAGE_NAMES: Record<string, string> = {
  de: "German", en: "English", fr: "French", nl: "Dutch", it: "Italian", es: "Spanish", pl: "Polish",
  cs: "Czech", da: "Danish", sv: "Swedish", no: "Norwegian", nb: "Norwegian", fi: "Finnish", hu: "Hungarian",
  pt: "Portuguese", ru: "Russian", he: "Hebrew", la: "Latin",
};
function languageName(lang: string | undefined): string | undefined {
  if (!lang) return undefined;
  const code = lang.trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(lang.trim().split(/[-_]/)[0]) && LANGUAGE_NAMES[code] ? LANGUAGE_NAMES[code] : lang;
}

/** Kopftags, die nur das frühere Programm beschreiben — nicht übernehmen. */
const FOREIGN_HEADER_PATHS = new Set(["SOUR", "DATE", "GEDC", "CHAR", "DEST", "FILE"]);

export function writeGedcom(doc: GedcomDocument, options: WriteOptions = {}): WriteResult {
  const idMap = buildIdMap(doc);
  const includeExt = options.includeExtensions ?? true;
  const b = new Builder(idMap, includeExt, doc);
  const maxBytes = options.maxLineBytes ?? 255;
  const records: GedcomNode[] = [];

  // --- Kopf
  const now = gedcomDate(options.now ?? new Date());
  const head: GedcomNode = { tag: "HEAD", children: [] };
  head.children.push(
    node("GEDC", undefined, [node("VERS", "5.5.1"), node("FORM", "LINEAGE-LINKED")]),
    node("CHAR", "UTF-8"),
    node("SOUR", options.sourceId ?? "FAMILYTREE", [
      node("NAME", options.sourceName ?? "Stammbaum"),
      ...(options.sourceVersion ? [node("VERS", options.sourceVersion)] : []),
    ]),
    node("DATE", now.date, [node("TIME", now.time)]),
  );
  let submitterId = doc.header.submitterId && doc.submitters.some((s) => s.id === doc.header.submitterId) ? doc.header.submitterId : doc.submitters[0]?.id;
  const extraSubmitter = !submitterId;
  if (extraSubmitter) {
    submitterId = "SUBM1";
    let n = 1;
    while ([...idMap.values()].includes(submitterId)) submitterId = `SUBM${++n}`;
    idMap.set(submitterId, submitterId);
  }
  head.children.push(ptr("SUBM", b.id(submitterId!)));
  head.children.push(node("LANG", options.language ?? languageName(doc.header.language) ?? "German"));
  if (doc.header.placeForm?.length) head.children.push(node("PLAC", undefined, [node("FORM", doc.header.placeForm.join(", "))]));
  if (doc.header.copyright !== undefined) head.children.push(node("COPR", doc.header.copyright));
  if (doc.header.note !== undefined) head.children.push(node("NOTE", doc.header.note));
  head.children.push(...b.ids(doc.header.externalIds));
  if (includeExt) {
    b.merge(
      head,
      doc.header.extensions.filter(
        (e) => !(e.path.length && FOREIGN_HEADER_PATHS.has(e.path[0])) && !(e.path.length === 0 && e.node.tag === "SCHMA"),
      ),
    );
  }
  records.push(head);

  // --- Einsender
  if (extraSubmitter) {
    records.push({ tag: "SUBM", xref: submitterId, children: [node("NAME", options.submitterName ?? "Stammbaum-Export")] });
  }
  for (const s of doc.submitters) {
    const out: GedcomNode = { tag: "SUBM", xref: b.id(s.id), children: [node("NAME", s.name ?? options.submitterName ?? "Unbekannt")] };
    out.children.push(...b.address(s.address));
    if (s.language !== undefined) out.children.push(node("LANG", s.language));
    out.children.push(...s.notes.map((n) => b.note(n)));
    out.children.push(...b.ids(s.externalIds));
    out.children.push(...b.stamps(s));
    b.merge(out, s.extensions);
    records.push(out);
  }

  // --- Personen und Familien
  const sexOf = new Map(doc.persons.map((p) => [p.id, p.sex]));
  const adoptionFamilies = new Set<string>();
  for (const p of doc.persons) {
    for (const e of p.events) if (e.type === "ADOPTION" && e.adoption?.familyId) adoptionFamilies.add(`${p.id} ${e.adoption.familyId}`);
  }
  const personIds = new Set(doc.persons.map((p) => p.id));
  for (const f of doc.families) {
    for (const id of [...f.partners, ...f.children.map((c) => c.childId)]) {
      if (!personIds.has(id)) b.warnings.push({ code: "DANGLING_POINTER", message: `Familie @${f.id}@ verweist auf fehlende Person @${id}@.`, recordId: f.id });
    }
  }
  // Verzeichnis Person → Familien (sonst quadratische Laufzeit bei großen Dateien)
  const index: FamilyIndex = { asChild: new Map(), asPartner: new Map() };
  const addTo = (m: Map<string, GedcomFamily[]>, id: string, f: GedcomFamily) => {
    const list = m.get(id);
    if (!list) m.set(id, [f]);
    else if (!list.includes(f)) list.push(f);
  };
  for (const f of doc.families) {
    for (const c of f.children) addTo(index.asChild, c.childId, f);
    for (const pid of f.partners) addTo(index.asPartner, pid, f);
  }
  for (const p of doc.persons) records.push(b.person(p, index, adoptionFamilies));
  for (const f of doc.families) records.push(b.family(f, sexOf));

  // --- Quellen, Archive, Notizen, Medien
  for (const s of doc.sources) records.push(b.source(s));
  for (const r of doc.repositories) {
    const out: GedcomNode = { tag: "REPO", xref: b.id(r.id), children: [node("NAME", r.name ?? "")] };
    out.children.push(...b.address(r.address));
    out.children.push(...r.notes.map((n) => b.note(n)));
    out.children.push(...b.ids(r.externalIds));
    out.children.push(...b.stamps(r));
    b.merge(out, r.extensions);
    records.push(out);
  }
  for (const n of doc.notes) {
    const out: GedcomNode = { tag: "NOTE", xref: b.id(n.id), value: n.content.original ?? n.content.text, children: [] };
    out.children.push(...n.citations.map((c) => b.citation(c)));
    out.children.push(...b.ids(n.externalIds));
    out.children.push(...b.stamps(n));
    b.merge(out, n.extensions);
    records.push(out);
  }
  for (const m of doc.media) {
    const out: GedcomNode = { tag: "OBJE", xref: b.id(m.id!), children: b.mediaObjectChildren(m) };
    b.merge(out, m.extensions);
    records.push(out);
  }
  if (includeExt) {
    for (const r of doc.unknownRecords) {
      if (r.tag === "TRLR") continue; // Unterzeilen von TRLR sind in 5.5.1 nicht erlaubt
      records.push(b.remap(r));
    }
  }
  records.push({ tag: "TRLR", children: [] });

  const lines: string[] = [];
  for (const r of records) serialize(r, 0, lines, maxBytes);
  const eol = options.lineEnding ?? "\r\n";
  const text = lines.join(eol) + eol;
  return {
    text,
    bytes: encodeUtf8(text, options.bom ?? false),
    idMap: Object.fromEntries(idMap),
    warnings: b.warnings,
  };
}

export type { GedcomEventType };
