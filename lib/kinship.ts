/**
 * Verwandtschaftsbezeichnungen — reine Funktionen ohne Datenbank.
 *
 * Zwei Blickwinkel:
 *
 * 1. Blutsverwandtschaft (findBloodRelation + bloodRelationTerm): über die
 *    nächsten gemeinsamen Vorfahren. Gezählt werden leibliche und
 *    Adoptiv-Elternschaften (Adoption begründet rechtlich Verwandtschaft),
 *    Stief- und Pflegeelternschaften nicht.
 *
 * 2. Verbindungsweg (describePath): der kürzeste Weg über Eltern- und
 *    Partnerkanten, z.B. für Schwägerschaft ("Schwager", "Schwiegermutter")
 *    oder Stiefverhältnisse. Lässt sich kein Begriff ableiten, bleibt die
 *    Kette ("Mutter → Bruder → Ehefrau").
 *
 * Alle Begriffe beschreiben, was die ZIELPERSON für die Ausgangsperson ist
 * ("B ist der Onkel von A").
 */
import type { GraphIndex } from "./graph";

export type Sex = "MALE" | "FEMALE" | "OTHER" | "UNKNOWN";
export type Side = "paternal" | "maternal" | null;

/** Elternschaften, die eine Abstammungslinie begründen. */
const LINEAGE_SUBTYPES = new Set(["BIOLOGICAL", "ADOPTIVE"]);

const by = (sex: Sex, male: string, female: string, neutral: string) =>
  sex === "MALE" ? male : sex === "FEMALE" ? female : neutral;

/** "Ur" k-mal als Vorsilbe: 1 -> "Ur", 2 -> "Urur". */
const urPrefix = (k: number) => (k <= 0 ? "" : "Ur" + "ur".repeat(k - 1));

/** Erster Buchstabe klein — für zusammengesetzte Begriffe ("Halb" + "bruder"). */
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Bis zu dieser Zahl von "Ur"-Vorsilben ausgeschrieben, darüber Generationsangabe. */
const MAX_UR = 4;

// ---------------------------------------------------------------------------
// Begriffe für Blutsverwandtschaft
// ---------------------------------------------------------------------------

export type BloodTermInput = {
  /** Generationen von der Ausgangsperson hinauf zum gemeinsamen Vorfahren. */
  up: number;
  /** Generationen vom gemeinsamen Vorfahren hinab zur Zielperson. */
  down: number;
  /** Nur ein gemeinsamer Vorfahr bei bekannten zwei Elternteilen. */
  half?: boolean;
  /** Linie läuft nur über Adoption. */
  adoptive?: boolean;
  /** Geschlecht der Zielperson. */
  sex: Sex;
  /** Elternteil der Ausgangsperson, über das die Linie läuft. */
  side?: Side;
};

function ancestorTerm(up: number, sex: Sex): string {
  if (up === 1) return by(sex, "Vater", "Mutter", "Elternteil");
  if (up === 2) return by(sex, "Großvater", "Großmutter", "Großelternteil");
  const k = up - 2;
  if (k > MAX_UR) return by(sex, `Vorfahr in der ${up}. Generation`, `Vorfahrin in der ${up}. Generation`, `Vorfahr in der ${up}. Generation`);
  return urPrefix(k) + by(sex, "großvater", "großmutter", "großelternteil");
}

function descendantTerm(down: number, sex: Sex): string {
  if (down === 1) return by(sex, "Sohn", "Tochter", "Kind");
  if (down === 2) return by(sex, "Enkel", "Enkelin", "Enkelkind");
  const k = down - 2;
  if (k > MAX_UR) return by(sex, `Nachfahre in der ${down}. Generation`, `Nachfahrin in der ${down}. Generation`, `Nachfahre in der ${down}. Generation`);
  return urPrefix(k) + by(sex, "enkel", "enkelin", "enkelkind");
}

function uncleTerm(up: number, sex: Sex): string {
  // up = 2: Onkel, 3: Großonkel, 4: Urgroßonkel …
  if (up === 2) return by(sex, "Onkel", "Tante", "Onkel/Tante");
  const k = up - 3;
  if (k > MAX_UR) return by(sex, `Onkel in der ${up - 1}. Generation`, `Tante in der ${up - 1}. Generation`, `Onkel/Tante in der ${up - 1}. Generation`);
  const base = by(sex, "Großonkel", "Großtante", "Großonkel/-tante");
  return k === 0 ? base : urPrefix(k) + lowerFirst(base);
}

function nephewTerm(down: number, sex: Sex): string {
  if (down === 2) return by(sex, "Neffe", "Nichte", "Neffe/Nichte");
  const k = down - 3;
  if (k > MAX_UR) return by(sex, `Neffe in der ${down - 1}. Generation`, `Nichte in der ${down - 1}. Generation`, `Neffe/Nichte in der ${down - 1}. Generation`);
  const base = by(sex, "Großneffe", "Großnichte", "Großneffe/-nichte");
  return k === 0 ? base : urPrefix(k) + lowerFirst(base);
}

function cousinTerm(up: number, down: number, sex: Sex): string {
  const degree = Math.min(up, down) - 1;
  const removed = Math.abs(up - down);
  let term = `${by(sex, "Cousin", "Cousine", "Cousin/Cousine")} ${degree}. Grades`;
  if (removed > 0) {
    const gen = removed === 1 ? "eine Generation" : `${removed} Generationen`;
    // up > down: die Zielperson steht näher am gemeinsamen Vorfahren, also
    // in einer älteren Generation.
    term += `, ${gen} ${up > down ? "darüber" : "darunter"}`;
  }
  return term;
}

/**
 * Bezeichnung für eine Blutsverwandtschaft aus Sicht der Ausgangsperson.
 * Beispiele: (2,0) "Großmutter väterlicherseits", (1,1,half) "Halbbruder",
 * (2,2) "Cousin 1. Grades", (3,2) "Cousine 1. Grades, eine Generation darüber".
 */
export function bloodRelationTerm(input: BloodTermInput): string {
  const { up, down, sex } = input;
  if (up === 0 && down === 0) return "dieselbe Person";

  let term: string;
  if (down === 0) term = ancestorTerm(up, sex);
  else if (up === 0) term = descendantTerm(down, sex);
  else if (up === 1 && down === 1) term = by(sex, "Bruder", "Schwester", "Geschwister");
  else if (down === 1) term = uncleTerm(up, sex);
  else if (up === 1) term = nephewTerm(down, sex);
  else term = cousinTerm(up, down, sex);

  // Halbverwandtschaft gibt es nur in Seitenlinien.
  if (input.half && up >= 1 && down >= 1) term = "Halb" + lowerFirst(term);

  if (input.adoptive) {
    if ((up === 1 && down === 0) || (up === 0 && down === 1)) {
      term = "Adoptiv" + lowerFirst(term);
    } else {
      term += " (über Adoption)";
    }
  }

  // Seite nur, wo sie etwas aussagt: ab Großeltern bzw. Onkel/Tante.
  // Steht vor einem Generationszusatz: "Cousine 1. Grades mütterlicherseits,
  // eine Generation darüber".
  if (input.side && up >= 2) {
    const side = input.side === "paternal" ? " väterlicherseits" : " mütterlicherseits";
    const comma = term.indexOf(", ");
    term = comma >= 0 ? term.slice(0, comma) + side + term.slice(comma) : term + side;
  }
  return term;
}

// ---------------------------------------------------------------------------
// Gemeinsame Vorfahren finden
// ---------------------------------------------------------------------------

type AncestorInfo = {
  distance: number;
  /** Es gibt einen rein leiblichen Weg dieser Länge. */
  biological: boolean;
};

/** Vorfahren mit kürzestem Abstand (die Person selbst mit Abstand 0). */
export function ancestorDistances(
  index: GraphIndex,
  startId: string,
  maxDepth = 25,
): Map<string, AncestorInfo> {
  const result = new Map<string, AncestorInfo>([
    [startId, { distance: 0, biological: true }],
  ]);
  let frontier = [startId];
  for (let d = 1; d <= maxDepth && frontier.length > 0; d++) {
    const next = new Map<string, boolean>();
    for (const id of frontier) {
      const bio = result.get(id)!.biological;
      for (const e of index.parentsOf.get(id) ?? []) {
        if (!LINEAGE_SUBTYPES.has(e.subtype)) continue;
        if (result.has(e.from)) continue;
        const viaBio = bio && e.subtype === "BIOLOGICAL";
        next.set(e.from, (next.get(e.from) ?? false) || viaBio);
      }
    }
    for (const [id, biological] of next) result.set(id, { distance: d, biological });
    frontier = [...next.keys()];
  }
  return result;
}

const lineageParents = (index: GraphIndex, id: string) =>
  (index.parentsOf.get(id) ?? [])
    .filter((e) => LINEAGE_SUBTYPES.has(e.subtype))
    .map((e) => e.from);

export type BloodRelation = {
  up: number;
  down: number;
  /** Nächste gemeinsame Vorfahren (bei Vorfahr/Nachfahr: die Person selbst). */
  commonAncestorIds: string[];
  half: boolean;
  adoptive: boolean;
  /**
   * Elternteil der Ausgangsperson, über das die Linie läuft (für
   * väterlicher-/mütterlicherseits). null, wenn nicht eindeutig oder ohne
   * Bedeutung (up < 2).
   */
  lineParentId: string | null;
};

/**
 * Blutsverwandtschaft zweier Personen über die nächsten gemeinsamen
 * Vorfahren. null, wenn es keine gemeinsamen Vorfahren gibt.
 */
export function findBloodRelation(
  index: GraphIndex,
  aId: string,
  bId: string,
  maxDepth = 25,
): BloodRelation | null {
  if (aId === bId) {
    return { up: 0, down: 0, commonAncestorIds: [aId], half: false, adoptive: false, lineParentId: null };
  }
  const ua = ancestorDistances(index, aId, maxDepth);
  const ub = ancestorDistances(index, bId, maxDepth);

  let best: { up: number; down: number } | null = null;
  for (const [id, a] of ua) {
    const b = ub.get(id);
    if (!b) continue;
    const sum = a.distance + b.distance;
    if (
      !best ||
      sum < best.up + best.down ||
      // Bei gleicher Summe (Ahnenschwund) die nähere Linie zur Ausgangsperson.
      (sum === best.up + best.down && a.distance < best.up)
    ) {
      best = { up: a.distance, down: b.distance };
    }
  }
  if (!best) return null;
  const { up, down } = best;

  const common = [...ua.entries()]
    .filter(([id, a]) => a.distance === up && ub.get(id)?.distance === down)
    .map(([id]) => id)
    .sort();

  const adoptive = !common.some(
    (id) => ua.get(id)!.biological && ub.get(id)!.biological,
  );

  // Halb: genau ein gemeinsamer Vorfahr, obwohl auf beiden Seiten direkt
  // darunter zwei Elternteile bekannt sind. Fehlt der zweite Elternteil, ist
  // es eine Datenlücke — dann keine Aussage.
  let half = false;
  if (up >= 1 && down >= 1 && common.length === 1) {
    const g = common[0];
    const below = (dist: Map<string, AncestorInfo>, self: string, level: number) =>
      level === 1
        ? self
        : ((index.childrenOf.get(g) ?? [])
            .map((e) => e.to)
            .find((c) => dist.get(c)?.distance === level - 1) ?? null);
    const sideA = below(ua, aId, up);
    const sideB = below(ub, bId, down);
    half =
      sideA !== null &&
      sideB !== null &&
      lineageParents(index, sideA).length >= 2 &&
      lineageParents(index, sideB).length >= 2;
  }

  let lineParentId: string | null = null;
  if (up >= 2) {
    const commonSet = new Set(common);
    const leading = lineageParents(index, aId).filter((p) => {
      const d = ancestorDistances(index, p, up - 1);
      return [...commonSet].some((c) => d.get(c)?.distance === up - 1);
    });
    if (leading.length === 1) lineParentId = leading[0];
  }

  return { up, down, commonAncestorIds: common, half, adoptive, lineParentId };
}

// ---------------------------------------------------------------------------
// Verbindungsweg beschreiben
// ---------------------------------------------------------------------------

export type KinshipStep = {
  /** Rolle der erreichten Person gegenüber der vorigen. */
  relation: "parent" | "child" | "partner";
  subtype: string;
  /** Geschlecht der erreichten Person (UNKNOWN bei Platzhaltern). */
  sex: Sex;
};

const PARENT_PREFIX: Record<string, string> = {
  BIOLOGICAL: "",
  ADOPTIVE: "Adoptiv",
  STEP: "Stief",
  FOSTER: "Pflege",
};

/** Begriff für einen einzelnen Schritt ("Mutter", "Stiefsohn", "Ehefrau"). */
export function stepTerm(step: KinshipStep): string {
  const prefix = PARENT_PREFIX[step.subtype] ?? "";
  const join = (base: string) => (prefix ? prefix + lowerFirst(base) : base);
  switch (step.relation) {
    case "parent":
      return join(by(step.sex, "Vater", "Mutter", "Elternteil"));
    case "child":
      return join(by(step.sex, "Sohn", "Tochter", "Kind"));
    case "partner":
      if (step.subtype === "MARRIED") return by(step.sex, "Ehemann", "Ehefrau", "Ehepartner");
      if (step.subtype === "DIVORCED") {
        return by(step.sex, "geschiedener Ehemann", "geschiedene Ehefrau", "geschiedener Ehepartner");
      }
      return by(step.sex, "Partner", "Partnerin", "Partner/in");
  }
}

/** Teilweg nur aus Eltern-/Kindschritten der Form hinauf* hinab*. */
function bloodSegment(steps: KinshipStep[]): { up: number; down: number; adoptive: boolean } | null {
  if (steps.length === 0) return null;
  let up = 0;
  let down = 0;
  let adoptive = false;
  for (const s of steps) {
    if (s.relation === "partner" || !LINEAGE_SUBTYPES.has(s.subtype)) return null;
    if (s.subtype === "ADOPTIVE") adoptive = true;
    if (s.relation === "parent") {
      if (down > 0) return null; // erst hinauf, dann hinab
      up++;
    } else {
      down++;
    }
  }
  return { up, down, adoptive };
}

const sideOf = (first: KinshipStep | undefined): Side =>
  first?.relation === "parent" && first.sex === "MALE"
    ? "paternal"
    : first?.relation === "parent" && first.sex === "FEMALE"
      ? "maternal"
      : null;

const isCouple = (s: KinshipStep) => s.relation === "partner" && s.subtype !== "DIVORCED";

function partnerGenitive(step: KinshipStep): string {
  if (step.subtype === "MARRIED") return by(step.sex, "des Ehemanns", "der Ehefrau", "des Ehepartners");
  if (step.subtype === "DIVORCED") {
    return by(step.sex, "des geschiedenen Ehemanns", "der geschiedenen Ehefrau", "des geschiedenen Ehepartners");
  }
  return by(step.sex, "des Partners", "der Partnerin", "des Partners/der Partnerin");
}

const isSiblingSeg = (seg: { up: number; down: number } | null) =>
  seg !== null && seg.up === 1 && seg.down === 1;

/**
 * Begriff für einen Verbindungsweg. `term` ist null, wenn kein gängiger
 * Begriff passt; `chain` beschreibt den Weg Schritt für Schritt aus Sicht
 * der jeweils vorigen Person.
 */
export function describePath(steps: KinshipStep[]): { term: string | null; chain: string } {
  const chain = steps.map(stepTerm).join(" → ");
  if (steps.length === 0) return { term: "dieselbe Person", chain: "" };
  if (steps.length === 1) return { term: stepTerm(steps[0]), chain };

  const last = steps[steps.length - 1];
  const target = last.sex;

  // Reine Abstammung.
  const blood = bloodSegment(steps);
  if (blood) {
    return {
      term: bloodRelationTerm({ ...blood, sex: target, side: sideOf(steps[0]) }),
      chain,
    };
  }

  // Gemeinsames Kind: Kind -> dessen anderer Elternteil.
  if (
    steps.length === 2 &&
    steps[0].relation === "child" &&
    steps[1].relation === "parent" &&
    LINEAGE_SUBTYPES.has(steps[0].subtype) &&
    LINEAGE_SUBTYPES.has(steps[1].subtype)
  ) {
    return { term: by(target, "Vater eines gemeinsamen Kindes", "Mutter eines gemeinsamen Kindes", "anderer Elternteil eines gemeinsamen Kindes"), chain };
  }

  const partnerIdx = steps
    .map((s, i) => (s.relation === "partner" ? i : -1))
    .filter((i) => i >= 0);

  if (partnerIdx.length === 1) {
    const i = partnerIdx[0];
    const before = steps.slice(0, i);
    const after = steps.slice(i + 1);
    const partner = steps[i];

    // Blutsverwandter -> dessen Partner ("angeheiratet").
    if (after.length === 0) {
      const seg = bloodSegment(before);
      if (seg) {
        const { up, down } = seg;
        if (up === 0 && down === 1) return { term: by(target, "Schwiegersohn", "Schwiegertochter", "Schwiegerkind"), chain };
        if (up === 1 && down === 1) return { term: by(target, "Schwager", "Schwägerin", "Schwager/Schwägerin"), chain };
        if (down === 0 && isCouple(partner)) {
          if (up === 1) return { term: by(target, "Stiefvater", "Stiefmutter", "Stiefelternteil"), chain };
          if (up === 2) return { term: by(target, "Stiefgroßvater", "Stiefgroßmutter", "Stiefgroßelternteil"), chain };
        }
        if (up >= 2 && down >= 1) {
          const base = bloodRelationTerm({ up, down, sex: target, side: sideOf(before[0]) });
          return {
            term: by(target, `angeheirateter ${base}`, `angeheiratete ${base}`, `${base} (angeheiratet)`),
            chain,
          };
        }
      }
    }

    // Partner -> dessen Blutsverwandter.
    if (before.length === 0) {
      const seg = bloodSegment(after);
      if (seg) {
        const { up, down } = seg;
        if (up === 1 && down === 0) return { term: by(target, "Schwiegervater", "Schwiegermutter", "Schwiegerelternteil"), chain };
        if (up === 2 && down === 0) return { term: by(target, "Schwiegergroßvater", "Schwiegergroßmutter", "Schwiegergroßelternteil"), chain };
        if (up === 1 && down === 1) return { term: by(target, "Schwager", "Schwägerin", "Schwager/Schwägerin"), chain };
        if (up === 0 && down === 1) return { term: by(target, "Stiefsohn", "Stieftochter", "Stiefkind"), chain };
        if (up === 0 && down === 2) return { term: by(target, "Stiefenkel", "Stiefenkelin", "Stiefenkelkind"), chain };
        return { term: `${bloodRelationTerm({ up, down, sex: target })} ${partnerGenitive(partner)}`, chain };
      }
    }

    // Geschwister des Partners -> dessen Partner? (zwei Partnerkanten, siehe
    // unten) bzw. Partner des Geschwisters -> dessen Geschwister.
    if (isSiblingSeg(bloodSegment(before)) && isSiblingSeg(bloodSegment(after))) {
      return { term: by(target, "Schwippschwager", "Schwippschwägerin", "Schwippschwager/-schwägerin"), chain };
    }
  }

  if (
    partnerIdx.length === 2 &&
    partnerIdx[0] === 0 &&
    partnerIdx[1] === steps.length - 1 &&
    isSiblingSeg(bloodSegment(steps.slice(1, -1)))
  ) {
    return { term: by(target, "Schwippschwager", "Schwippschwägerin", "Schwippschwager/-schwägerin"), chain };
  }

  return { term: null, chain };
}
