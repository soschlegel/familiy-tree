/**
 * Erfundene „Wahrheit“ und daraus mehrere sich überschneidende Importe mit
 * Rauschen und Fallen — für die Genauigkeit von „Importe verbinden“
 * (tests/import-linking.test.ts). Deterministisch (fester Startwert).
 */
import { toFuzzyDate, type FuzzyDate } from "@/lib/dates";
import type { LinkPerson } from "@/lib/import-linking";

type Truth = {
  id: string;
  given: string;
  surname: string; // Geburtsname
  married?: string; // Ehename (Frauen)
  gender: "MALE" | "FEMALE";
  birth: [number, number, number];
  death: [number, number, number] | null;
  parents: string[];
  partners: string[];
  children: string[];
  family: number;
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const MALE = ["Johann", "Georg", "Heinrich", "Friedrich", "Wilhelm", "Karl", "Peter", "Jakob", "Michael", "Christian", "Philipp", "Konrad", "Martin", "Andreas", "Valentin"];
const FEMALE = ["Anna", "Maria", "Katharina", "Elisabeth", "Margarethe", "Barbara", "Eva", "Sophia", "Christina", "Magdalena", "Dorothea", "Juliana", "Susanna", "Regina", "Helena"];
const SUR = ["Kelvaro", "Wendtner", "Zubitan", "Mortes", "Lavinsk", "Pemura", "Toskal", "Rivane", "Bolden", "Sartek", "Fennow", "Grabitz", "Hollmer", "Ilsner", "Jorvald", "Kastrup", "Lindorf", "Merkow", "Norbeck", "Osterkamp"];

export type Generated = { truth: Map<string, Truth>; imports: LinkPerson[][]; truthOf: Map<string, string> };

/**
 * `families` Stammfamilien über `generations` Generationen; `imports` Importe,
 * jeder deckt eine zusammenhängende Auswahl Familien ab (Überlappung über die
 * Ehen zwischen Familien). Fallen: gleichnamige Geschwister, Vater und Sohn
 * gleichen Namens, Zwillinge mit gleichem ersten Vornamen, Wiederverheiratung,
 * Dublette innerhalb eines Imports, falsche Einzelbrücke, Widerspruch in einem
 * dritten Import.
 */
export function generate(opts: { families: number; generations: number; imports: number; seed?: number; coverage?: number }): Generated {
  const r = rng(opts.seed ?? 42);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const truth = new Map<string, Truth>();
  let n = 0;
  const mk = (t: Omit<Truth, "id" | "parents" | "partners" | "children">): Truth => {
    const p: Truth = { ...t, id: `T${++n}`, parents: [], partners: [], children: [] };
    truth.set(p.id, p);
    return p;
  };
  const day = (y: number): [number, number, number] => [y, 1 + Math.floor(r() * 12), 1 + Math.floor(r() * 28)];
  const marry = (a: Truth, b: Truth) => {
    a.partners.push(b.id);
    b.partners.push(a.id);
    const wife = a.gender === "FEMALE" ? a : b;
    const husband = a.gender === "FEMALE" ? b : a;
    wife.married = husband.surname;
  };
  const child = (f: Truth, m: Truth, given: string, gender: "MALE" | "FEMALE", year: number, die = true) => {
    const c = mk({ given, surname: f.surname, gender, birth: day(year), death: die && r() < 0.85 ? day(year + 40 + Math.floor(r() * 40)) : null, family: f.family });
    c.parents.push(f.id, m.id);
    f.children.push(c.id);
    m.children.push(c.id);
    return c;
  };
  // Stammfamilien
  let couples: [Truth, Truth][] = [];
  for (let f = 0; f < opts.families; f++) {
    const y = 1700 + Math.floor(r() * 20);
    const h = mk({ given: pick(MALE), surname: SUR[f % SUR.length] + (f >= SUR.length ? "er" : ""), gender: "MALE", birth: day(y), death: day(y + 60), family: f });
    const w = mk({ given: pick(FEMALE), surname: pick(SUR) + "in", gender: "FEMALE", birth: day(y + 3), death: day(y + 65), family: f });
    marry(h, w);
    couples.push([h, w]);
  }
  let traps = 0;
  for (let g = 1; g < opts.generations; g++) {
    const next: [Truth, Truth][] = [];
    for (const [h, w] of couples) {
      const base = h.birth[0] + 25;
      const kids: Truth[] = [];
      const count = 2 + Math.floor(r() * 3);
      for (let i = 0; i < count; i++) {
        const gender = r() < 0.5 ? "MALE" : "FEMALE";
        kids.push(child(h, w, pick(gender === "MALE" ? MALE : FEMALE), gender, base + i * 3));
      }
      // Fallen
      const t = traps++ % 5;
      if (t === 0) {
        // gleichnamige Geschwister: erstes Kind früh gestorben
        const first = child(h, w, "Margarethe", "FEMALE", base - 2, false);
        first.death = [base - 2, 12, 1];
        kids.push(child(h, w, "Margarethe", "FEMALE", base + 12));
      } else if (t === 1) {
        // Vater und Sohn gleichen Namens
        kids.push(child(h, w, h.given, "MALE", base + 10));
      } else if (t === 2) {
        // Zwillinge: gleicher erster Vorname, gleicher Tag
        const a = child(h, w, "Anna Maria", "FEMALE", base + 14);
        const b = child(h, w, "Anna Katharina", "FEMALE", base + 14);
        b.birth = [...a.birth];
        kids.push(a, b);
      } else if (t === 3) {
        // Wiederverheiratung des Vaters
        const w2 = mk({ given: pick(FEMALE), surname: pick(SUR) + "ow", gender: "FEMALE", birth: day(h.birth[0] + 15), death: null, family: h.family });
        marry(h, w2);
        kids.push(child(h, w2, pick(MALE), "MALE", base + 20));
      }
      // Ehen der Kinder: mit Kindern anderer Familien (verbindet Familien) oder Fremden
      for (const k of kids) {
        if (k.death && k.death[0] - k.birth[0] < 2) continue;
        if (r() < 0.25) continue;
        const spouse = mk({
          given: pick(k.gender === "MALE" ? FEMALE : MALE),
          surname: pick(SUR) + "mann",
          gender: k.gender === "MALE" ? "FEMALE" : "MALE",
          birth: day(k.birth[0] + Math.floor(r() * 6) - 3),
          death: r() < 0.8 ? day(k.birth[0] + 50 + Math.floor(r() * 30)) : null,
          family: (k.family + 1) % opts.families,
        });
        marry(k, spouse);
        next.push(k.gender === "MALE" ? [k, spouse] : [spouse, k]);
      }
    }
    couples = next.slice(0, opts.families * 3);
  }

  // Importe: je Import ein Fenster über die Familien (Überlappung)
  const imports: LinkPerson[][] = [];
  const truthOf = new Map<string, string>();
  const famCount = opts.families;
  const coverage = opts.coverage ?? 0.6;
  const fuzzy = (d: [number, number, number] | null, k: number): FuzzyDate | null => {
    if (!d) return null;
    const x = r();
    if (x < 0.06 * k) return null;
    if (x < 0.25) return toFuzzyDate(`${d[0]}-01-01`, "YEAR", r() < 0.5 ? "ABOUT" : "EXACT");
    return toFuzzyDate(`${d[0]}-${String(d[1]).padStart(2, "0")}-${String(d[2]).padStart(2, "0")}`);
  };
  for (let i = 0; i < opts.imports; i++) {
    const start = Math.floor((i * famCount) / opts.imports);
    const width = Math.max(1, Math.round(famCount * coverage));
    const fams = new Set(Array.from({ length: width }, (_, j) => (start + j) % famCount));
    const group = `IMPORT-${i + 1}`;
    const recs = new Map<string, LinkPerson>();
    for (const t of truth.values()) {
      if (!fams.has(t.family) || r() < 0.08) continue;
      const id = `${group}:${t.id}`;
      truthOf.set(id, t.id);
      const nameStyle = t.married ? r() : 1;
      recs.set(t.id, {
        id,
        group,
        givenName: t.given,
        familyName: t.married && nameStyle < 0.7 ? t.married : t.surname,
        birthName: t.married && nameStyle < 0.5 ? t.surname : null,
        gender: t.gender,
        birth: fuzzy(t.birth, 1),
        death: t.death && r() < 0.85 ? fuzzy(t.death, 2) : null,
        birthPlace: null,
        variants: [],
        parents: [],
        partners: [],
        children: [],
        parentNames: [],
        partnerNames: [],
        trees: [group],
      });
    }
    for (const [tid, rec] of recs) {
      const t = truth.get(tid)!;
      rec.parents = t.parents.filter((x) => recs.has(x)).map((x) => recs.get(x)!.id);
      rec.partners = t.partners.filter((x) => recs.has(x)).map((x) => recs.get(x)!.id);
      rec.children = t.children.filter((x) => recs.has(x)).map((x) => recs.get(x)!.id);
    }
    const byRecId = new Map([...recs.values()].map((x) => [x.id, x]));
    for (const rec of recs.values()) {
      const nm = (id: string) => {
        const o = byRecId.get(id)!;
        return `${o.givenName} ${o.familyName ?? ""}`.toLowerCase().trim();
      };
      rec.parentNames = rec.parents.map(nm);
      rec.partnerNames = rec.partners.map(nm);
    }
    imports.push([...recs.values()]);
  }

  // Dublette innerhalb eines Imports: eine verheiratete Frau zusätzlich unter dem Geburtsnamen
  const inner = imports[0].find((p) => truth.get(truthOf.get(p.id)!)!.married && p.parents.length);
  if (inner) {
    const t = truth.get(truthOf.get(inner.id)!)!;
    const dup: LinkPerson = { ...inner, id: `${inner.id}#2`, familyName: t.surname, birthName: null, partners: [], children: [], partnerNames: [] };
    truthOf.set(dup.id, t.id);
    imports[0].push(dup);
  }
  // Falsche Einzelbrücke: zwei verschiedene Menschen, gleicher Name, gleiche Daten, ohne gemeinsame Verwandte
  const lone = (group: string, tid: string, partner: string) => {
    const id = `${group}:${tid}`;
    const p: LinkPerson = {
      id,
      group,
      givenName: "Valentin",
      familyName: "Einzelmann",
      birthName: null,
      gender: "MALE",
      birth: toFuzzyDate("1801-02-03"),
      death: toFuzzyDate("1870-04-05"),
      birthPlace: null,
      variants: [],
      parents: [],
      partners: [`${id}-p`],
      children: [],
      parentNames: [],
      partnerNames: [partner],
      trees: [group],
    };
    const q: LinkPerson = { ...p, id: `${id}-p`, givenName: partner.split(" ")[0], familyName: "Einzelmann", gender: "FEMALE", birth: null, death: null, partners: [id], partnerNames: ["valentin einzelmann"] };
    truthOf.set(p.id, tid);
    truthOf.set(q.id, `${tid}-p`);
    return [p, q];
  };
  imports[0].push(...lone("IMPORT-1", "LONE-A", "sophia einzelmann"));
  imports[1].push(...lone("IMPORT-2", "LONE-B", "juliana einzelmann"));
  // Widerspruch in einem dritten Import: dieselbe Person mit ganz anderem Tod
  if (imports.length >= 3) {
    const shared = imports[0].find((p) => p.death && imports[1].some((q) => truthOf.get(q.id) === truthOf.get(p.id)) && imports[2].some((q) => truthOf.get(q.id) === truthOf.get(p.id)));
    if (shared) {
      const third = imports[2].find((q) => truthOf.get(q.id) === truthOf.get(shared.id))!;
      third.death = toFuzzyDate(`${(shared.death!.date.getUTCFullYear() + 30)}-06-06`);
    }
  }
  return { truth, imports, truthOf };
}
