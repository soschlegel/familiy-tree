/**
 * Rohbaum → Zwischenmodell.
 *
 * Grundsatz: Jeder Knoten wird entweder verstanden (und dann vollständig
 * samt Unterknoten verarbeitet) oder unverändert als `GedcomExtension` an das
 * nächste Element des Modells gehängt. Mit `trace` wird jeder verstandene
 * Knoten in `consumed` vermerkt — der Test beweist damit, dass keine Zeile
 * verloren geht.
 */

import { parseGedcomDate } from "./dates";
import { noteContent } from "./html";
import { computeFamilyStatus, FAMILY_STATUS_TAGS, partnerStatusFromLabel } from "./status";
import type {
  GedcomAddress,
  GedcomChildKind,
  GedcomCitation,
  GedcomDate,
  GedcomDialect,
  GedcomDocument,
  GedcomEvent,
  GedcomEventType,
  GedcomExtension,
  GedcomExternalId,
  GedcomFamily,
  GedcomFamilyChild,
  GedcomHeader,
  GedcomMediaFile,
  GedcomMediaLink,
  GedcomMediaObject,
  GedcomName,
  GedcomNameType,
  GedcomNode,
  GedcomNote,
  GedcomNoteRef,
  GedcomPerson,
  GedcomPlace,
  GedcomPrivacy,
  GedcomRepository,
  GedcomRepositoryRef,
  GedcomSex,
  GedcomSource,
  GedcomSubmitter,
  GedcomUnknownTag,
} from "./types";
import type { WarningSink } from "./warnings";

// ---------------------------------------------------------------------------
// Tabellen
// ---------------------------------------------------------------------------

export const INDIVIDUAL_EVENT_TAGS: Record<string, GedcomEventType> = {
  BIRT: "BIRTH",
  CHR: "CHRISTENING",
  BAPM: "BAPTISM",
  DEAT: "DEATH",
  BURI: "BURIAL",
  CREM: "CREMATION",
  ADOP: "ADOPTION",
  CHRA: "ADULT_CHRISTENING",
  BARM: "BAR_MITZVAH",
  BASM: "BAS_MITZVAH",
  BLES: "BLESSING",
  CONF: "CONFIRMATION",
  FCOM: "FIRST_COMMUNION",
  ORDN: "ORDINATION",
  NATU: "NATURALIZATION",
  EMIG: "EMIGRATION",
  IMMI: "IMMIGRATION",
  CENS: "CENSUS",
  PROB: "PROBATE",
  WILL: "WILL",
  GRAD: "GRADUATION",
  RETI: "RETIREMENT",
  EVEN: "CUSTOM_EVENT",
  // Merkmale
  CAST: "CASTE",
  DSCR: "PHYSICAL_DESCRIPTION",
  EDUC: "EDUCATION",
  IDNO: "ID_NUMBER",
  NATI: "NATIONALITY",
  NCHI: "CHILDREN_COUNT",
  NMR: "MARRIAGE_COUNT",
  OCCU: "OCCUPATION",
  PROP: "PROPERTY",
  RELI: "RELIGION",
  RESI: "RESIDENCE",
  SSN: "SOCIAL_SECURITY_NUMBER",
  TITL: "NOBILITY_TITLE",
  FACT: "CUSTOM_ATTRIBUTE",
};

export const FAMILY_EVENT_TAGS: Record<string, GedcomEventType> = {
  ANUL: "ANNULMENT",
  CENS: "CENSUS",
  DIV: "DIVORCE",
  DIVF: "DIVORCE_FILED",
  ENGA: "ENGAGEMENT",
  MARB: "MARRIAGE_BANN",
  MARC: "MARRIAGE_CONTRACT",
  MARR: "MARRIAGE",
  MARL: "MARRIAGE_LICENSE",
  MARS: "MARRIAGE_SETTLEMENT",
  RESI: "RESIDENCE",
  EVEN: "CUSTOM_EVENT",
  NCHI: "CHILDREN_COUNT",
  FACT: "CUSTOM_ATTRIBUTE",
};

const ID_TAGS: Record<string, string> = {
  _UID: "UID",
  UID: "UID",
  RIN: "RIN",
  AFN: "AFN",
  REFN: "REFN",
  EXID: "EXID",
  _FSFTID: "FSID",
  _FID: "FSID",
  FSID: "FSID",
  _APID: "APID",
  _PHOTO_RIN: "PHOTO_RIN",
};

const PRIVACY_TAGS = new Set(["_PRIV", "_PRIVATE", "_LIVING", "_PRIVACY", "_CONFIDENTIAL"]);

/** Platzhalternamen für lebende bzw. private Personen (klein geschrieben). */
const PLACEHOLDER_NAMES = new Set([
  "private", "living", "lebend", "lebende person", "privat", "privatperson", "private person",
  "vertraulich", "confidential", "[private]", "<private>", "(private)", "[living]", "<living>", "(living)",
  "living person", "privé", "vivant",
]);

const NAME_TYPES: Record<string, GedcomNameType> = {
  BIRTH: "BIRTH",
  MAIDEN: "MAIDEN",
  MARRIED: "MARRIED",
  AKA: "AKA",
  ALIAS: "AKA",
  IMMIGRANT: "IMMIGRANT",
  RELIGIOUS: "RELIGIOUS",
  PROFESSIONAL: "PROFESSIONAL",
  NICKNAME: "NICKNAME",
  OTHER: "OTHER",
};

export function childKindFromLabel(label: string): GedcomChildKind {
  const l = label.trim().toLowerCase();
  if (/^(birth|natural|biological|leiblich|blood)$/.test(l)) return "BIOLOGICAL";
  if (/^(adopted|adoptive|adoption|adoptiert)$/.test(l)) return "ADOPTIVE";
  if (/^(foster|pflege|pflegekind)$/.test(l)) return "FOSTER";
  if (/^(step|stepchild|stief|stiefkind)$/.test(l)) return "STEP";
  return "OTHER";
}

export function detectDialect(sourceId?: string, sourceName?: string): GedcomDialect {
  const s = `${sourceId ?? ""} ${sourceName ?? ""}`.toUpperCase();
  if (s.includes("MYHERITAGE")) return "MYHERITAGE";
  if (s.includes("ANCESTRY")) return "ANCESTRY";
  if (s.includes("FAMILYSEARCH") || s.includes("FAMILY_SEARCH") || s.includes("FSFT")) return "FAMILYSEARCH";
  if (s.includes("GRAMPS")) return "GRAMPS";
  if (s.includes("AHNENBLATT")) return "AHNENBLATT";
  if (/\bFTM\b|FAMILY TREE MAKER|FTW|FAMILY_TREE_MAKER/.test(s)) return "FAMILY_TREE_MAKER";
  if (s.includes("LEGACY")) return "LEGACY";
  if (s.includes("ROOTSMAGIC")) return "ROOTSMAGIC";
  if (/\bPAF\b/.test(s)) return "PAF";
  if (s.includes("WEBTREES")) return "WEBTREES";
  if (s.includes("HEREDIS")) return "HEREDIS";
  if (s.includes("FAMILY_HISTORIAN") || s.includes("FAMILY HISTORIAN") || /\bFH\b/.test(s)) return "FAMILY_HISTORIAN";
  if (s.includes("STAMMBAUM")) return "STAMMBAUM";
  return "UNKNOWN";
}

// ---------------------------------------------------------------------------
// Kontext
// ---------------------------------------------------------------------------

/** Wohin nicht Verstandenes kommt: Liste des Elements + relativer Pfad. */
interface Ctx {
  exts: GedcomExtension[];
  path: string[];
  /** Absoluter Pfad des aktuellen Elternknotens (für die Übersicht). */
  abs: string;
}

const sub = (ctx: Ctx, tag: string): Ctx => ({ exts: ctx.exts, path: [...ctx.path, tag], abs: `${ctx.abs}.${tag}` });
const entity = (exts: GedcomExtension[], abs: string): Ctx => ({ exts, path: [], abs });

type RefKind = "INDI" | "FAM" | "SOUR" | "NOTE" | "OBJE" | "REPO" | "SUBM";

interface PendingChildLink {
  pedi?: string;
  status?: string;
  notes: GedcomNoteRef[];
  extensions: GedcomExtension[];
}

export interface InterpretOptions {
  trace?: boolean;
}

export class Interpreter {
  readonly doc: GedcomDocument;
  readonly consumed = new Set<GedcomNode>();
  private readonly trace: boolean;
  private readonly unknown = new Map<string, GedcomUnknownTag>();
  private readonly ids = new Map<string, RefKind | "OTHER">();
  private readonly refs: { kind: RefKind; id: string; line?: number; from: string }[] = [];
  /** FAMC-Angaben der Kinder: key `${childId} ${familyId}`. */
  private readonly famc = new Map<string, PendingChildLink>();
  private readonly famsOf = new Map<string, Set<string>>();
  private readonly adoptions: { childId: string; familyId: string; by: string }[] = [];
  private placeForm?: string[];
  major: 5 | 7 = 5;
  private noIdCounter = 0;
  private recordId = "";

  constructor(
    private readonly sink: WarningSink,
    options: InterpretOptions = {},
  ) {
    this.trace = !!options.trace;
    this.doc = {
      header: { dialect: "UNKNOWN", majorVersion: 5, externalIds: [], extensions: [] },
      persons: [],
      families: [],
      sources: [],
      repositories: [],
      notes: [],
      media: [],
      submitters: [],
      unknownRecords: [],
    };
  }

  // --- Grundoperationen ----------------------------------------------------

  private use(node: GedcomNode): void {
    if (this.trace) this.consumed.add(node);
  }

  private keep(node: GedcomNode, ctx: Ctx): void {
    ctx.exts.push({ path: ctx.path, node });
    const tag = node.tag;
    const path = ctx.abs ? `${ctx.abs}.${tag}` : tag;
    let entry = this.unknown.get(tag);
    if (!entry) {
      entry = { tag, count: 0, examplePath: path, paths: {} };
      this.unknown.set(tag, entry);
    }
    entry.count++;
    if (entry.paths[path] !== undefined || Object.keys(entry.paths).length < 20) {
      entry.paths[path] = (entry.paths[path] ?? 0) + 1;
    }
  }

  /** Blatt: Wert zurück, unerwartete Unterknoten bleiben als Erweiterung. */
  private leaf(node: GedcomNode, ctx: Ctx): string {
    this.use(node);
    if (node.children.length) {
      const c = sub(ctx, node.tag);
      for (const child of node.children) this.keep(child, c);
    }
    return node.value ?? "";
  }

  private ref(kind: RefKind, node: GedcomNode): string | undefined {
    if (!node.pointer) return undefined;
    if (node.pointer === "VOID") return undefined;
    this.refs.push({ kind, id: node.pointer, line: node.line, from: this.recordId });
    return node.pointer;
  }

  unknownTags(): GedcomUnknownTag[] {
    return [...this.unknown.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  // --- Datensätze ------------------------------------------------------------

  record(node: GedcomNode): void {
    let id = node.xref;
    const kind = recordKind(node.tag);
    if (kind && node.tag !== "HEAD" && node.tag !== "TRLR") {
      if (!id) {
        id = `_NOID${++this.noIdCounter}`;
        this.sink.add("MISSING_XREF", `Datensatz ${node.tag} ohne Kennung — erhält „${id}“.`, node.line);
      } else if (this.ids.has(id)) {
        let n = 2;
        while (this.ids.has(`${id}~${n}`)) n++;
        const newId = `${id}~${n}`;
        this.sink.add("DUPLICATE_XREF", `Kennung @${id}@ ist doppelt vergeben — zweiter Datensatz erhält „${newId}“; Verweise gehen auf den ersten.`, node.line, id);
        id = newId;
      }
      this.ids.set(id, kind);
    } else if (id) {
      if (this.ids.has(id)) this.sink.add("DUPLICATE_XREF", `Kennung @${id}@ ist doppelt vergeben.`, node.line, id);
      else this.ids.set(id, "OTHER");
    }
    this.recordId = id ?? node.tag;

    switch (node.tag) {
      case "HEAD":
        this.use(node);
        return this.header(node);
      case "TRLR":
        this.use(node);
        for (const c of node.children) this.keepRecordChild(c);
        return;
      case "INDI":
        this.use(node);
        this.doc.persons.push(this.person(node, id!));
        return;
      case "FAM":
        this.use(node);
        this.doc.families.push(this.family(node, id!));
        return;
      case "SOUR":
        this.use(node);
        this.doc.sources.push(this.source(node, id!));
        return;
      case "REPO":
        this.use(node);
        this.doc.repositories.push(this.repository(node, id!));
        return;
      case "NOTE":
      case "SNOTE":
        this.use(node);
        this.doc.notes.push(this.noteRecord(node, id!));
        return;
      case "OBJE":
        this.use(node);
        this.doc.media.push(this.mediaRecord(node, id!));
        return;
      case "SUBM":
        this.use(node);
        this.doc.submitters.push(this.submitter(node, id!));
        return;
      default: {
        // Unbekannter Datensatz (z.B. MyHeritage `0 _PUBLISH`, SUBN, _MTTAG)
        this.doc.unknownRecords.push(node);
        const ctx: Ctx = { exts: [], path: [], abs: "" };
        this.keep(node, ctx);
        if (node.children.length === 0 && !node.value) {
          this.sink.add("EMPTY_RECORD", `Leerer Datensatz ${node.tag}.`, node.line);
        }
      }
    }
  }

  private keepRecordChild(node: GedcomNode): void {
    const ctx: Ctx = { exts: [], path: [], abs: "TRLR" };
    this.keep(node, ctx);
    this.doc.unknownRecords.push({ tag: "TRLR", children: [node] });
  }

  // --- Kopf ------------------------------------------------------------------

  private header(node: GedcomNode): void {
    const h: GedcomHeader = this.doc.header;
    const ctx = entity(h.extensions, "HEAD");
    for (const c of node.children) {
      switch (c.tag) {
        case "SOUR": {
          this.use(c);
          h.sourceId = c.value;
          const sc = sub(ctx, "SOUR");
          for (const s of c.children) {
            if (s.tag === "VERS") h.sourceVersion = this.leaf(s, sc);
            else if (s.tag === "NAME") h.sourceName = this.leaf(s, sc);
            else if (s.tag === "CORP" && s.children.length === 0) h.sourceCorporation = this.leaf(s, sc);
            else this.keep(s, sc);
          }
          break;
        }
        case "GEDC": {
          this.use(c);
          const gc = sub(ctx, "GEDC");
          for (const s of c.children) {
            if (s.tag === "VERS") h.gedcomVersion = this.leaf(s, gc);
            else if (s.tag === "FORM" && s.children.length === 0) h.gedcomForm = this.leaf(s, gc);
            else this.keep(s, gc);
          }
          break;
        }
        case "CHAR":
          h.charset = this.leaf(c, ctx);
          break;
        case "LANG":
          h.language = this.leaf(c, ctx);
          break;
        case "DEST":
          h.destination = this.leaf(c, ctx);
          break;
        case "FILE":
          h.fileName = this.leaf(c, ctx);
          break;
        case "COPR":
          h.copyright = this.leaf(c, ctx);
          break;
        case "NOTE":
          h.note = this.leaf(c, ctx);
          break;
        case "SUBM":
          if (c.pointer && c.children.length === 0) {
            this.use(c);
            h.submitterId = this.ref("SUBM", c);
          } else this.keep(c, ctx);
          break;
        case "DATE": {
          this.use(c);
          h.exportDate = c.value;
          const dc = sub(ctx, "DATE");
          for (const s of c.children) {
            if (s.tag === "TIME") h.exportTime = this.leaf(s, dc);
            else this.keep(s, dc);
          }
          break;
        }
        case "PLAC": {
          this.use(c);
          const pc = sub(ctx, "PLAC");
          for (const s of c.children) {
            if (s.tag === "FORM") h.placeForm = splitList(this.leaf(s, pc));
            else this.keep(s, pc);
          }
          this.placeForm = h.placeForm;
          break;
        }
        case "_UID":
        case "_PROJECT_GUID":
        case "_EXPORTED_FROM_SITE_ID":
          h.externalIds.push({
            type: c.tag === "_UID" ? "UID" : c.tag === "_PROJECT_GUID" ? "PROJECT_GUID" : "SITE_ID",
            value: this.leaf(c, ctx),
          });
          break;
        default:
          this.keep(c, ctx);
      }
    }
    h.majorVersion = h.gedcomVersion && /^7\./.test(h.gedcomVersion.trim()) ? 7 : 5;
    this.major = h.majorVersion;
    h.dialect = detectDialect(h.sourceId, h.sourceName);
  }

  // --- Gemeinsame Bausteine ---------------------------------------------------

  /** Kennungen, Änderungsstempel, Privatsphäre — gemeinsam für viele Elemente. */
  private common(
    c: GedcomNode,
    ctx: Ctx,
    target: { externalIds: GedcomExternalId[]; changed?: string; updated?: string; privacy?: GedcomPrivacy },
  ): boolean {
    const idType = ID_TAGS[c.tag];
    if (idType) {
      this.use(c);
      const id: GedcomExternalId = { type: idType, value: c.value ?? "" };
      const ic = sub(ctx, c.tag);
      for (const s of c.children) {
        if (s.tag === "TYPE" && (c.tag === "REFN" || c.tag === "EXID")) id.scheme = this.leaf(s, ic);
        else this.keep(s, ic);
      }
      target.externalIds.push(id);
      return true;
    }
    if (c.tag === "CHAN") {
      this.use(c);
      const cc = sub(ctx, "CHAN");
      for (const s of c.children) {
        if (s.tag === "DATE") {
          this.use(s);
          let stamp = s.value ?? "";
          const dc = sub(cc, "DATE");
          for (const t of s.children) {
            if (t.tag === "TIME") stamp += ` ${this.leaf(t, dc)}`;
            else this.keep(t, dc);
          }
          target.changed = stamp;
        } else this.keep(s, cc);
      }
      return true;
    }
    if (c.tag === "_UPD") {
      target.updated = this.leaf(c, ctx);
      return true;
    }
    if (target.privacy && (c.tag === "RESN" || PRIVACY_TAGS.has(c.tag))) {
      const v = this.leaf(c, ctx);
      if (c.tag === "RESN") {
        for (const r of v.split(/[,\s]+/).filter(Boolean)) target.privacy.restrictions.push(r.toLowerCase());
      }
      if (c.tag === "_LIVING" && /^(y|yes|true|1)$/i.test(v.trim())) target.privacy.livingMarked = true;
      target.privacy.markers.push({ source: c.tag, value: v });
      return true;
    }
    return false;
  }

  private date(c: GedcomNode, ctx: Ctx): GedcomDate {
    this.use(c);
    const dc = sub(ctx, "DATE");
    for (const s of c.children) this.keep(s, dc);
    const d = parseGedcomDate(c.value ?? "");
    if (d.kind === "INVALID" && d.original) {
      this.sink.add("INVALID_DATE", "Datum nicht nach GEDCOM-Regeln lesbar — als Text erhalten.", c.line, this.recordId);
    }
    if (d.start?.unconverted || d.end?.unconverted) {
      this.sink.add("UNCONVERTED_CALENDAR", "Datum in einem Kalender, der nicht umgerechnet wurde — Original bleibt erhalten.", c.line, this.recordId);
    }
    return d;
  }

  private place(c: GedcomNode, ctx: Ctx): GedcomPlace {
    this.use(c);
    const name = c.value ?? "";
    const p: GedcomPlace = { name, parts: splitList(name), notes: [], citations: [], extensions: [] };
    const pc = entity(p.extensions, `${ctx.abs}.PLAC`);
    for (const s of c.children) {
      switch (s.tag) {
        case "FORM":
          p.form = splitList(this.leaf(s, pc));
          break;
        case "MAP": {
          this.use(s);
          const mc = sub(pc, "MAP");
          for (const t of s.children) {
            const v = t.tag === "LATI" ? coord(t.value ?? "", "N", "S") : t.tag === "LONG" ? coord(t.value ?? "", "E", "W") : undefined;
            if (v === undefined) {
              this.keep(t, mc);
              continue;
            }
            this.leaf(t, mc);
            if (t.tag === "LATI") p.latitude = v;
            else p.longitude = v;
          }
          break;
        }
        case "NOTE":
          p.notes.push(this.noteRef(s, pc));
          break;
        case "SOUR":
          p.citations.push(this.citation(s, pc));
          break;
        default:
          this.keep(s, pc);
      }
    }
    const form = p.form ?? this.placeForm;
    if (form && form.length && p.parts.length) {
      p.jurisdictions = p.parts.map((part, i) => ({ level: form[i] ?? "", name: part }));
    }
    return p;
  }

  private address(c: GedcomNode, ctx: Ctx, addr: GedcomAddress): void {
    this.use(c);
    if (c.value) addr.text = c.value;
    const ac = sub(ctx, "ADDR");
    for (const s of c.children) {
      switch (s.tag) {
        case "ADR1":
        case "ADR2":
        case "ADR3":
          (addr.lines ??= []).push(this.leaf(s, ac));
          break;
        case "CITY":
          addr.city = this.leaf(s, ac);
          break;
        case "STAE":
          addr.state = this.leaf(s, ac);
          break;
        case "POST":
          addr.postalCode = this.leaf(s, ac);
          break;
        case "CTRY":
          addr.country = this.leaf(s, ac);
          break;
        default:
          this.keep(s, ac);
      }
    }
  }

  /** PHON/EMAIL/FAX/WWW neben ADDR; true, wenn verarbeitet. */
  private contact(c: GedcomNode, ctx: Ctx, get: () => GedcomAddress): boolean {
    const key = c.tag === "PHON" ? "phones" : c.tag === "EMAIL" || c.tag === "_EMAIL" ? "emails" : c.tag === "FAX" ? "faxes" : c.tag === "WWW" || c.tag === "_URL" ? "urls" : null;
    if (!key) return false;
    if (c.tag === "_EMAIL" || c.tag === "_URL") return false;
    get()[key].push(this.leaf(c, ctx));
    return true;
  }

  noteRef(c: GedcomNode, ctx: Ctx): GedcomNoteRef {
    this.use(c);
    const n: GedcomNoteRef = { citations: [], extensions: [] };
    if (c.pointer) n.noteId = this.ref("NOTE", c);
    else n.content = noteContent(c.value ?? "");
    const nc = entity(n.extensions, `${ctx.abs}.${c.tag}`);
    for (const s of c.children) {
      if (s.tag === "SOUR") n.citations.push(this.citation(s, nc));
      else this.keep(s, nc);
    }
    return n;
  }

  citation(c: GedcomNode, ctx: Ctx): GedcomCitation {
    this.use(c);
    const cit: GedcomCitation = { texts: [], notes: [], media: [], externalIds: [], extensions: [] };
    if (c.pointer) cit.sourceId = this.ref("SOUR", c);
    else if (c.value !== undefined) cit.inlineText = c.value;
    const cc = entity(cit.extensions, `${ctx.abs}.SOUR`);
    for (const s of c.children) {
      if (this.common(s, cc, cit)) continue;
      switch (s.tag) {
        case "PAGE":
          cit.page = this.leaf(s, cc);
          break;
        case "QUAY": {
          const v = (s.value ?? "").trim();
          if (/^[0-3]$/.test(v)) {
            this.leaf(s, cc);
            cit.quality = +v;
            cit.confidence = cit.quality === 3 ? "HIGH" : cit.quality === 2 ? "MEDIUM" : "LOW";
          } else {
            // Unlesbarer Wert: als Erweiterung behalten statt verwerfen.
            this.keep(s, cc);
          }
          break;
        }
        case "EVEN": {
          this.use(s);
          if (s.value !== undefined) cit.eventType = s.value;
          const ec = sub(cc, "EVEN");
          for (const t of s.children) {
            if (t.tag === "ROLE") cit.role = this.leaf(t, ec);
            else this.keep(t, ec);
          }
          break;
        }
        case "DATA": {
          this.use(s);
          const dc = sub(cc, "DATA");
          for (const t of s.children) {
            if (t.tag === "DATE") cit.date = this.date(t, dc);
            else if (t.tag === "TEXT") cit.texts.push(this.leaf(t, dc));
            else this.keep(t, dc);
          }
          break;
        }
        case "TEXT":
          cit.texts.push(this.leaf(s, cc));
          break;
        case "NOTE":
          cit.notes.push(this.noteRef(s, cc));
          break;
        case "OBJE":
          cit.media.push(this.mediaLink(s, cc));
          break;
        default:
          this.keep(s, cc);
      }
    }
    return cit;
  }

  private mediaFile(c: GedcomNode, ctx: Ctx, obj: GedcomMediaObject): void {
    this.use(c);
    const location = c.value ?? "";
    const f: GedcomMediaFile = { location, isUrl: /^[a-z][a-z0-9+.-]*:\/\//i.test(location.trim()) };
    const fc = sub(ctx, "FILE");
    for (const s of c.children) {
      if (s.tag === "FORM" || s.tag === "MIME") {
        this.use(s);
        f.format = s.value;
        const tc = sub(fc, s.tag);
        for (const t of s.children) {
          if (t.tag === "TYPE" || t.tag === "MEDI") f.mediaType = this.leaf(t, tc);
          else this.keep(t, tc);
        }
      } else if (s.tag === "TITL") f.title = this.leaf(s, fc);
      else this.keep(s, fc);
    }
    obj.files.push(f);
  }

  /** Gemeinsamer Inhalt von OBJE-Datensatz und eingebettetem OBJE. */
  private mediaContent(c: GedcomNode, ctx: Ctx, obj: GedcomMediaObject, link?: GedcomMediaLink): boolean {
    if (this.common(c, ctx, obj)) return true;
    switch (c.tag) {
      case "FILE":
        this.mediaFile(c, ctx, obj);
        return true;
      case "FORM": {
        // 5.5: FORM direkt unter OBJE — gilt für die (erste) Datei.
        const v = this.leaf(c, ctx);
        if (obj.files.length && !obj.files[obj.files.length - 1].format) obj.files[obj.files.length - 1].format = v;
        else (obj as { pendingFormat?: string }).pendingFormat = v;
        return true;
      }
      case "TITL":
        obj.title = this.leaf(c, ctx);
        return true;
      case "_FILESIZE": {
        const v = c.value?.trim() ?? "";
        if (/^\d+$/.test(v)) {
          obj.fileSize = +this.leaf(c, ctx);
          return true;
        }
        return false;
      }
      case "NOTE":
        obj.notes.push(this.noteRef(c, ctx));
        return true;
      case "SOUR":
        obj.citations.push(this.citation(c, ctx));
        return true;
    }
    if (link) {
      const flag = () => /^(y|yes|true|1)$/i.test(this.leaf(c, ctx).trim());
      switch (c.tag) {
        case "_PRIM":
          link.primary = flag();
          return true;
        case "_PERSONALPHOTO":
          link.personalPhoto = flag();
          return true;
        case "_CUTOUT":
          link.cutout = flag();
          return true;
        case "_PRIM_CUTOUT":
          link.primaryCutout = flag();
          return true;
      }
    }
    return false;
  }

  mediaLink(c: GedcomNode, ctx: Ctx): GedcomMediaLink {
    this.use(c);
    const link: GedcomMediaLink = { primary: false, extensions: [] };
    const abs = `${ctx.abs}.OBJE`;
    if (c.pointer) {
      link.mediaId = this.ref("OBJE", c);
      const lc = entity(link.extensions, abs);
      for (const s of c.children) {
        const flag = () => /^(y|yes|true|1)$/i.test(this.leaf(s, lc).trim());
        if (s.tag === "_PRIM") link.primary = flag();
        else if (s.tag === "_PERSONALPHOTO") link.personalPhoto = flag();
        else if (s.tag === "_CUTOUT") link.cutout = flag();
        else if (s.tag === "_PRIM_CUTOUT") link.primaryCutout = flag();
        else if (s.tag === "TITL") link.title = this.leaf(s, lc);
        else this.keep(s, lc);
      }
      return link;
    }
    const obj: GedcomMediaObject = { files: [], notes: [], citations: [], externalIds: [], extensions: [] };
    const oc = entity(obj.extensions, abs);
    for (const s of c.children) {
      if (!this.mediaContent(s, oc, obj, link)) this.keep(s, oc);
    }
    fixPendingFormat(obj);
    link.inline = obj;
    return link;
  }

  private event(c: GedcomNode, type: GedcomEventType, ctx: Ctx, family: boolean): GedcomEvent {
    this.use(c);
    const ev: GedcomEvent = { type, notes: [], citations: [], media: [], externalIds: [], extensions: [] };
    if (c.value !== undefined) ev.value = c.value;
    const ec = entity(ev.extensions, `${ctx.abs}.${c.tag}`);
    let addr: GedcomAddress | undefined;
    const getAddr = () => (addr ??= { phones: [], emails: [], faxes: [], urls: [] });
    let privacy: GedcomPrivacy | undefined;
    const target = {
      externalIds: ev.externalIds,
      changed: undefined as string | undefined,
      updated: undefined as string | undefined,
      privacy: (privacy = emptyPrivacy()),
    };
    for (const s of c.children) {
      if (this.common(s, ec, target)) continue;
      if (this.contact(s, ec, getAddr)) continue;
      switch (s.tag) {
        case "TYPE":
          ev.label = this.leaf(s, ec);
          break;
        case "DATE":
          ev.date = this.date(s, ec);
          break;
        case "PLAC":
          ev.place = this.place(s, ec);
          break;
        case "ADDR":
          this.address(s, ec, getAddr());
          break;
        case "AGE":
          ev.age = this.leaf(s, ec);
          break;
        case "CAUS":
          ev.cause = this.leaf(s, ec);
          break;
        case "AGNC":
          ev.agency = this.leaf(s, ec);
          break;
        case "RELI":
          ev.religion = this.leaf(s, ec);
          break;
        case "NOTE":
          ev.notes.push(this.noteRef(s, ec));
          break;
        case "SOUR":
          ev.citations.push(this.citation(s, ec));
          break;
        case "OBJE":
          ev.media.push(this.mediaLink(s, ec));
          break;
        case "_PRIM":
          ev.preferred = /^(y|yes)$/i.test(this.leaf(s, ec).trim());
          break;
        case "HUSB":
        case "WIFE": {
          if (!family || s.pointer) {
            this.keep(s, ec);
            break;
          }
          this.use(s);
          const pc = sub(ec, s.tag);
          for (const t of s.children) {
            if (t.tag === "AGE") {
              ev.partnerAges ??= {};
              ev.partnerAges[s.tag === "HUSB" ? "husband" : "wife"] = this.leaf(t, pc);
            } else this.keep(t, pc);
          }
          break;
        }
        case "FAMC": {
          if (type !== "ADOPTION" || !s.pointer) {
            this.keep(s, ec);
            break;
          }
          this.use(s);
          const famId = this.ref("FAM", s);
          ev.adoption = { familyId: famId };
          const fc = sub(ec, "FAMC");
          for (const t of s.children) {
            if (t.tag === "ADOP" && type === "ADOPTION") ev.adoption.by = this.leaf(t, fc);
            else this.keep(t, fc);
          }
          if (type === "ADOPTION" && famId) {
            this.adoptions.push({ childId: this.recordId, familyId: famId, by: (ev.adoption.by ?? "BOTH").toUpperCase() });
          }
          break;
        }
        default:
          this.keep(s, ec);
      }
    }
    if (addr) ev.address = addr;
    if (target.changed) ev.changed = target.changed;
    if (target.updated) ev.updated = target.updated;
    if (privacy.markers.length) ev.privacy = privacy;
    return ev;
  }

  private name(c: GedcomNode, ctx: Ctx): GedcomName {
    this.use(c);
    const original = c.value ?? "";
    const n: GedcomName = {
      full: original.replace(/\//g, " ").replace(/\s+/g, " ").trim(),
      original,
      marriedSurnames: [],
      aliases: [],
      variants: [],
      notes: [],
      citations: [],
      extensions: [],
    };
    const sm = original.match(/^([^/]*)\/([^/]*)\/?(.*)$/);
    if (sm) {
      const given = sm[1].trim();
      const surname = sm[2].trim();
      if (given) n.given = given;
      if (surname) n.surname = surname;
    } else if (original.trim()) n.given = original.trim();
    const nc = entity(n.extensions, `${ctx.abs}.NAME`);
    for (const s of c.children) {
      switch (s.tag) {
        case "GIVN":
          n.given = this.leaf(s, nc);
          break;
        case "SURN":
          n.surname = this.leaf(s, nc);
          break;
        case "NPFX":
          n.prefix = this.leaf(s, nc);
          break;
        case "SPFX":
          n.surnamePrefix = this.leaf(s, nc);
          break;
        case "NSFX":
          n.suffix = this.leaf(s, nc);
          break;
        case "NICK":
          n.nickname = this.leaf(s, nc);
          break;
        case "_RUFNAME":
        case "_RUFN":
          n.callName = this.leaf(s, nc);
          break;
        case "TYPE": {
          const v = this.leaf(s, nc);
          n.typeLabel = v;
          n.type = NAME_TYPES[v.trim().toUpperCase()] ?? "OTHER";
          break;
        }
        case "_MARNM":
        case "_MARN":
          n.marriedSurnames.push(this.leaf(s, nc));
          break;
        case "_AKA":
          n.aliases.push(this.leaf(s, nc));
          break;
        case "FONE":
        case "ROMN": {
          this.use(s);
          const v = { kind: s.tag === "FONE" ? "phonetic" : "romanized", value: s.value ?? "" } as GedcomName["variants"][number];
          const vc = sub(nc, s.tag);
          for (const t of s.children) {
            if (t.tag === "TYPE") v.method = this.leaf(t, vc);
            else this.keep(t, vc);
          }
          n.variants.push(v);
          break;
        }
        case "NOTE":
          n.notes.push(this.noteRef(s, nc));
          break;
        case "SOUR":
          n.citations.push(this.citation(s, nc));
          break;
        case "_PRIM":
          n.preferred = /^(y|yes)$/i.test(this.leaf(s, nc).trim());
          break;
        default:
          this.keep(s, nc);
      }
    }
    return n;
  }

  // --- Personen ----------------------------------------------------------------

  private person(node: GedcomNode, id: string): GedcomPerson {
    const p: GedcomPerson = {
      id,
      names: [],
      sex: "UNKNOWN",
      events: [],
      notes: [],
      citations: [],
      media: [],
      externalIds: [],
      privacy: emptyPrivacy(),
      parentFamilies: [],
      spouseFamilies: [],
      extensions: [],
    };
    const ctx = entity(p.extensions, "INDI");
    for (const c of node.children) {
      if (this.common(c, ctx, p)) continue;
      const evType = INDIVIDUAL_EVENT_TAGS[c.tag];
      if (evType) {
        p.events.push(this.event(c, evType, ctx, false));
        continue;
      }
      switch (c.tag) {
        case "NAME":
          p.names.push(this.name(c, ctx));
          break;
        case "SEX": {
          const v = this.leaf(c, ctx).trim();
          const sex: GedcomSex | undefined = ({ M: "MALE", F: "FEMALE", U: "UNKNOWN", X: "OTHER" } as Record<string, GedcomSex>)[v.toUpperCase()];
          p.sex = sex ?? "UNKNOWN";
          if (!sex || v !== v.toUpperCase()) p.sexRaw = v;
          break;
        }
        case "FAMC": {
          const famId = this.ref("FAM", c);
          if (!famId) {
            this.keep(c, ctx);
            break;
          }
          this.use(c);
          const key = `${id} ${famId}`;
          const pending: PendingChildLink = this.famc.get(key) ?? { notes: [], extensions: [] };
          const fc = entity(pending.extensions, "INDI.FAMC");
          for (const s of c.children) {
            if (s.tag === "PEDI") pending.pedi = this.leaf(s, fc);
            else if (s.tag === "STAT") pending.status = this.leaf(s, fc);
            else if (s.tag === "NOTE") pending.notes.push(this.noteRef(s, fc));
            else this.keep(s, fc);
          }
          this.famc.set(key, pending);
          if (!p.parentFamilies.includes(famId)) p.parentFamilies.push(famId);
          break;
        }
        case "FAMS": {
          const famId = this.ref("FAM", c);
          if (!famId) {
            this.keep(c, ctx);
            break;
          }
          this.use(c);
          const entry = { familyId: famId, extensions: [] as GedcomExtension[] };
          const fc = entity(entry.extensions, "INDI.FAMS");
          for (const s of c.children) this.keep(s, fc);
          p.spouseFamilies.push(entry);
          let set = this.famsOf.get(id);
          if (!set) this.famsOf.set(id, (set = new Set()));
          set.add(famId);
          break;
        }
        case "NOTE":
          p.notes.push(this.noteRef(c, ctx));
          break;
        case "SOUR":
          p.citations.push(this.citation(c, ctx));
          break;
        case "OBJE":
          p.media.push(this.mediaLink(c, ctx));
          break;
        default:
          this.keep(c, ctx);
      }
    }
    // Platzhalternamen erkennen (keine Entscheidung, nur Markierung).
    for (const n of p.names) {
      const candidates = [n.full, n.given ?? "", n.surname ?? ""].map((s) => s.trim().toLowerCase());
      if (candidates.some((s) => PLACEHOLDER_NAMES.has(s))) {
        p.privacy.placeholderName = true;
        p.privacy.markers.push({ source: "NAME", value: "placeholder" });
        break;
      }
    }
    if (p.privacy.restrictions.length || p.privacy.markers.some((m) => m.source !== "NAME")) {
      // nichts weiter: Entscheidung liegt beim Import
    }
    return p;
  }

  // --- Familien ----------------------------------------------------------------

  private family(node: GedcomNode, id: string): GedcomFamily {
    const f: GedcomFamily = {
      id,
      partners: [],
      partnerRoles: [],
      children: [],
      events: [],
      notes: [],
      citations: [],
      media: [],
      externalIds: [],
      privacy: emptyPrivacy(),
      extensions: [],
    };
    const ctx = entity(f.extensions, "FAM");
    for (const c of node.children) {
      if (this.common(c, ctx, f)) continue;
      if ((c.tag === "HUSB" || c.tag === "WIFE") && c.pointer === "VOID" && c.children.length === 0) {
        // 7.0: @VOID@ = ausdrücklich kein Partner — nichts zu übernehmen.
        this.use(c);
        continue;
      }
      if ((c.tag === "HUSB" || c.tag === "WIFE") && c.pointer) {
        if (f.partners.length >= 2) {
          this.sink.add("TOO_MANY_PARTNERS", "Familie mit mehr als zwei Partnern — weitere bleiben als Rohdaten erhalten.", c.line, id);
          this.keep(c, ctx);
          continue;
        }
        const pid = this.ref("INDI", c);
        if (!pid) {
          this.keep(c, ctx);
          continue;
        }
        this.use(c);
        const pc = sub(ctx, c.tag);
        for (const s of c.children) this.keep(s, pc);
        f.partners.push(pid);
        f.partnerRoles.push(c.tag);
        continue;
      }
      if (c.tag === "CHIL" && c.pointer) {
        const cid = this.ref("INDI", c);
        if (!cid) {
          this.keep(c, ctx);
          continue;
        }
        this.use(c);
        const child: GedcomFamilyChild = {
          childId: cid,
          kinds: [],
          kindLabels: [],
          explicit: false,
          notes: [],
          childSideExtensions: [],
          familySideExtensions: [],
        };
        const cc = entity(child.familySideExtensions, "FAM.CHIL");
        const labels: Record<string, string> = {};
        for (const s of c.children) {
          if (s.tag === "_FREL" || s.tag === "_MREL") labels[s.tag] = this.leaf(s, cc);
          else if (s.tag === "PEDI") labels.PEDI = this.leaf(s, cc);
          else if (s.tag === "NOTE") child.notes.push(this.noteRef(s, cc));
          else this.keep(s, cc);
        }
        (child as GedcomFamilyChild & { _labels?: Record<string, string> })._labels = labels;
        f.children.push(child);
        continue;
      }
      // Ausdrücklicher Familienstand: 7.0 `NO MARR`, _STAT/_MSTAT/_UST/TYPE.
      if (!f.statusMarker && c.tag === "NO" && c.value?.trim().toUpperCase() === "MARR") {
        this.use(c);
        f.statusMarker = { tag: "NO", value: c.value.trim() };
        const nc = sub(ctx, "NO");
        for (const s of c.children) this.keep(s, nc);
        continue;
      }
      if (!f.statusMarker && FAMILY_STATUS_TAGS.has(c.tag) && c.value && partnerStatusFromLabel(c.value) !== undefined) {
        f.statusMarker = { tag: c.tag, value: this.leaf(c, ctx) };
        continue;
      }
      const evType = FAMILY_EVENT_TAGS[c.tag];
      if (evType) {
        f.events.push(this.event(c, evType, ctx, true));
        continue;
      }
      switch (c.tag) {
        case "NOTE":
          f.notes.push(this.noteRef(c, ctx));
          break;
        case "SOUR":
          f.citations.push(this.citation(c, ctx));
          break;
        case "OBJE":
          f.media.push(this.mediaLink(c, ctx));
          break;
        default:
          this.keep(c, ctx);
      }
    }
    return f;
  }

  // --- Quellen, Archive, Notizen, Medien, Einsender ------------------------------

  private source(node: GedcomNode, id: string): GedcomSource {
    const s: GedcomSource = { id, urls: [], dataEvents: [], repositories: [], notes: [], media: [], externalIds: [], extensions: [] };
    const ctx = entity(s.extensions, "SOUR");
    for (const c of node.children) {
      if (this.common(c, ctx, s)) continue;
      switch (c.tag) {
        case "TITL":
          s.title = this.leaf(c, ctx);
          break;
        case "ABBR":
          s.abbreviation = this.leaf(c, ctx);
          break;
        case "AUTH":
          s.author = this.leaf(c, ctx);
          break;
        case "PUBL":
          s.publication = this.leaf(c, ctx);
          break;
        case "TEXT":
          s.text = this.leaf(c, ctx);
          break;
        case "WWW":
        case "_URL":
        case "_LINK":
          s.urls.push(this.leaf(c, ctx));
          break;
        case "_TYPE":
          s.sourceType = this.leaf(c, ctx);
          break;
        case "_MEDI":
          s.medium = this.leaf(c, ctx);
          break;
        case "DATA": {
          this.use(c);
          const dc = sub(ctx, "DATA");
          for (const d of c.children) {
            if (d.tag === "EVEN") {
              this.use(d);
              const de: GedcomSource["dataEvents"][number] = { types: d.value ?? "" };
              const ec = sub(dc, "EVEN");
              for (const e of d.children) {
                if (e.tag === "DATE") de.date = this.date(e, ec);
                else if (e.tag === "PLAC" && e.children.length === 0) de.place = this.leaf(e, ec);
                else this.keep(e, ec);
              }
              s.dataEvents.push(de);
            } else if (d.tag === "AGNC") s.dataAgency = this.leaf(d, dc);
            else if (d.tag === "NOTE") s.notes.push(this.noteRef(d, dc));
            else this.keep(d, dc);
          }
          break;
        }
        case "REPO":
          s.repositories.push(this.repoRef(c, ctx));
          break;
        case "NOTE":
          s.notes.push(this.noteRef(c, ctx));
          break;
        case "OBJE":
          s.media.push(this.mediaLink(c, ctx));
          break;
        default:
          this.keep(c, ctx);
      }
    }
    return s;
  }

  private repoRef(c: GedcomNode, ctx: Ctx): GedcomRepositoryRef {
    this.use(c);
    const r: GedcomRepositoryRef = { callNumbers: [], notes: [], extensions: [] };
    if (c.pointer) r.repositoryId = this.ref("REPO", c);
    else if (c.value) r.name = c.value;
    const rc = entity(r.extensions, `${ctx.abs}.REPO`);
    for (const s of c.children) {
      if (s.tag === "CALN") {
        this.use(s);
        r.callNumbers.push(s.value ?? "");
        const cc = sub(rc, "CALN");
        for (const t of s.children) {
          if (t.tag === "MEDI") r.mediaType = this.leaf(t, cc);
          else this.keep(t, cc);
        }
      } else if (s.tag === "NOTE") r.notes.push(this.noteRef(s, rc));
      else if (s.tag === "NAME" && !r.repositoryId) r.name = this.leaf(s, rc);
      else this.keep(s, rc);
    }
    return r;
  }

  private repository(node: GedcomNode, id: string): GedcomRepository {
    const r: GedcomRepository = { id, notes: [], externalIds: [], extensions: [] };
    const ctx = entity(r.extensions, "REPO");
    const getAddr = () => (r.address ??= { phones: [], emails: [], faxes: [], urls: [] });
    for (const c of node.children) {
      if (this.common(c, ctx, r)) continue;
      if (this.contact(c, ctx, getAddr)) continue;
      if (c.tag === "NAME") r.name = this.leaf(c, ctx);
      else if (c.tag === "ADDR") this.address(c, ctx, getAddr());
      else if (c.tag === "NOTE") r.notes.push(this.noteRef(c, ctx));
      else this.keep(c, ctx);
    }
    return r;
  }

  private noteRecord(node: GedcomNode, id: string): GedcomNote {
    const n: GedcomNote = { id, content: noteContent(node.value ?? ""), citations: [], externalIds: [], extensions: [] };
    const ctx = entity(n.extensions, node.tag);
    for (const c of node.children) {
      if (this.common(c, ctx, n)) continue;
      if (c.tag === "SOUR") n.citations.push(this.citation(c, ctx));
      else this.keep(c, ctx);
    }
    return n;
  }

  private mediaRecord(node: GedcomNode, id: string): GedcomMediaObject {
    const m: GedcomMediaObject = { id, files: [], notes: [], citations: [], externalIds: [], extensions: [] };
    const ctx = entity(m.extensions, "OBJE");
    for (const c of node.children) {
      if (!this.mediaContent(c, ctx, m)) this.keep(c, ctx);
    }
    fixPendingFormat(m);
    return m;
  }

  private submitter(node: GedcomNode, id: string): GedcomSubmitter {
    const s: GedcomSubmitter = { id, notes: [], externalIds: [], extensions: [] };
    const ctx = entity(s.extensions, "SUBM");
    const getAddr = () => (s.address ??= { phones: [], emails: [], faxes: [], urls: [] });
    for (const c of node.children) {
      if (this.common(c, ctx, s)) continue;
      if (this.contact(c, ctx, getAddr)) continue;
      if (c.tag === "NAME") s.name = this.leaf(c, ctx);
      else if (c.tag === "ADDR") this.address(c, ctx, getAddr());
      else if (c.tag === "LANG") s.language = this.leaf(c, ctx);
      else if (c.tag === "NOTE") s.notes.push(this.noteRef(c, ctx));
      else this.keep(c, ctx);
    }
    return s;
  }

  // --- Abschluss ---------------------------------------------------------------

  /** Verweise prüfen, Familien und Kinder-Arten zusammenführen. */
  finish(): void {
    const doc = this.doc;
    // Dialekt-Rückfall: MyHeritage-RINs ohne erkennbaren Kopf.
    if (doc.header.dialect === "UNKNOWN" && doc.persons.some((p) => p.externalIds.some((e) => e.type === "RIN" && e.value.startsWith("MH:")))) {
      doc.header.dialect = "MYHERITAGE";
    }

    // Verweise auf fehlende bzw. falsche Datensätze
    for (const r of this.refs) {
      const kind = this.ids.get(r.id);
      if (!kind) {
        this.sink.add("DANGLING_POINTER", `Verweis auf @${r.id}@ (${r.kind}) — dieser Datensatz fehlt.`, r.line, r.from);
      } else if (kind !== r.kind) {
        this.sink.add("WRONG_POINTER_TARGET", `Verweis auf @${r.id}@ erwartet ${r.kind}, gefunden ${kind}.`, r.line, r.from);
      }
    }

    const persons = new Map(doc.persons.map((p) => [p.id, p]));
    const families = new Map(doc.families.map((f) => [f.id, f]));

    // Einseitige Verknüpfungen ergänzen (Vereinigung beider Seiten).
    for (const [personId, famIds] of this.famsOf) {
      for (const famId of famIds) {
        const f = families.get(famId);
        if (!f || f.partners.includes(personId)) continue;
        this.sink.add("INCONSISTENT_LINK", `@${personId}@ nennt @${famId}@ als eigene Familie (FAMS), die Familie nennt die Person aber nicht.`, undefined, personId);
        if (f.partners.length < 2) {
          const sex = persons.get(personId)?.sex;
          const role: "HUSB" | "WIFE" =
            sex === "FEMALE" ? "WIFE" : sex === "MALE" ? "HUSB" : f.partnerRoles.includes("HUSB") ? "WIFE" : "HUSB";
          f.partners.push(personId);
          f.partnerRoles.push(role);
        }
      }
    }
    for (const f of doc.families) {
      for (const pid of f.partners) {
        const p = persons.get(pid);
        if (p && !p.spouseFamilies.some((s) => s.familyId === f.id)) {
          this.sink.add("INCONSISTENT_LINK", `@${f.id}@ nennt @${pid}@ als Partner, die Person verweist aber nicht zurück (FAMS).`, undefined, f.id);
          p.spouseFamilies.push({ familyId: f.id, extensions: [] });
        }
      }
    }
    for (const key of this.famc.keys()) {
      const [childId, famId] = key.split(" ");
      const f = families.get(famId);
      if (f && !f.children.some((c) => c.childId === childId)) {
        this.sink.add("INCONSISTENT_LINK", `@${childId}@ nennt @${famId}@ als Elternfamilie (FAMC), die Familie nennt das Kind aber nicht.`, undefined, childId);
        f.children.push({ childId, kinds: [], kindLabels: [], explicit: false, notes: [], childSideExtensions: [], familySideExtensions: [] });
      }
    }

    // Arten je Kind und Elternteil
    for (const f of doc.families) {
      for (const child of f.children) {
        const labels = (child as GedcomFamilyChild & { _labels?: Record<string, string> })._labels ?? {};
        delete (child as GedcomFamilyChild & { _labels?: unknown })._labels;
        const pending = this.famc.get(`${child.childId} ${f.id}`);
        const p = persons.get(child.childId);
        if (pending) {
          child.childSideExtensions = pending.extensions;
          child.notes.push(...pending.notes);
          if (pending.status) child.status = pending.status;
        } else if (p && !p.parentFamilies.includes(f.id)) {
          this.sink.add("INCONSISTENT_LINK", `@${f.id}@ nennt @${child.childId}@ als Kind, das Kind verweist aber nicht zurück (FAMC).`, undefined, f.id);
          p.parentFamilies.push(f.id);
        }
        const pedi = pending?.pedi ?? labels.PEDI;
        const adoption = this.adoptions.find((a) => a.childId === child.childId && a.familyId === f.id);
        child.kinds = [];
        child.kindLabels = [];
        const sameRoles = f.partnerRoles.length === 2 && f.partnerRoles[0] === f.partnerRoles[1];
        f.partnerRoles.forEach((role, idx) => {
          // Gleiche Rollen (zwei HUSB/zwei WIFE): _FREL gilt dem ersten, _MREL dem zweiten Partner.
          const own = (sameRoles ? idx === 0 : role === "HUSB") ? labels._FREL : labels._MREL;
          let label: string | undefined;
          let kind: GedcomChildKind = "BIOLOGICAL";
          if (own !== undefined) {
            label = own;
            kind = childKindFromLabel(own);
          } else if (pedi !== undefined) {
            label = pedi;
            kind = childKindFromLabel(pedi);
          } else if (adoption && (adoption.by === "BOTH" || adoption.by === role)) {
            kind = "ADOPTIVE";
          }
          child.kinds.push(kind);
          child.kindLabels.push(label);
        });
        child.explicit = labels._FREL !== undefined || labels._MREL !== undefined || pedi !== undefined || !!adoption;
        if (f.partners.length === 0 && pedi !== undefined) child.kindLabels = [pedi];
      }
      computeFamilyStatus(f);
    }
  }
}

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

function recordKind(tag: string): RefKind | undefined {
  switch (tag) {
    case "INDI":
    case "FAM":
    case "SOUR":
    case "OBJE":
    case "REPO":
    case "SUBM":
      return tag;
    case "NOTE":
    case "SNOTE":
      return "NOTE";
    case "HEAD":
    case "TRLR":
      return undefined;
  }
  return undefined;
}

export function emptyPrivacy(): GedcomPrivacy {
  return { restrictions: [], livingMarked: false, placeholderName: false, markers: [] };
}

function splitList(s: string): string[] {
  if (!s.trim()) return [];
  return s.split(",").map((x) => x.trim());
}

function coord(v: string, pos: string, neg: string): number | undefined {
  const m = v.trim().match(/^([NSEW])?\s*(-?\d+(?:[.,]\d+)?)$/i);
  if (!m) return undefined;
  const n = parseFloat(m[2].replace(",", "."));
  if (!Number.isFinite(n)) return undefined;
  const dir = m[1]?.toUpperCase();
  if (dir === neg) return -Math.abs(n);
  if (dir === pos) return Math.abs(n);
  return n;
}

function fixPendingFormat(obj: GedcomMediaObject): void {
  const pending = (obj as { pendingFormat?: string }).pendingFormat;
  if (pending === undefined) return;
  delete (obj as { pendingFormat?: string }).pendingFormat;
  if (obj.files.length && !obj.files[0].format) obj.files[0].format = pending;
  else obj.files.push({ location: "", isUrl: false, format: pending });
}
