/**
 * Importe verbinden — Abgleich über mehrere Importe (rein, ohne Datenbank).
 * Dienst und Oberfläche: lib/services/import-linking.ts, /research/connect.
 *
 * Personen tragen ihre Gruppe (Import = ImportLink.sourceTreeId; von Hand
 * erfasste Personen bilden die Gruppe "manual"). Verglichen wird nur über
 * Gruppengrenzen (bzw. innerhalb einer gewählten Gruppe) — nie alle Paare:
 * lib/duplicates.ts blockt nach Vornamen und Nachnamen.
 *
 * ## Ablauf
 * 1. **Anker**: Paare aus scoreDuplicate. „sicher“ nur nach dessen strenger
 *    Regel (gleicher ganzer Name, gleiches tagesgenaues Geburts- und
 *    Sterbedatum bzw. gemeinsame Eltern, kein Widerspruch). Eingetragene
 *    Vorfahren/Nachkommen sind nie ein Paar — auch nicht in der Ausbreitung
 *    und beim Prüfen der Cluster (lib/duplicates.ts, lineageOf).
 * 2. **Ausbreitung**: Ist ein Paar verbunden, werden Eltern×Eltern,
 *    Partner×Partner und Kinder×Kinder Kandidaten — mit gelockerter Schwelle
 *    (gleicher ganzer Vorname bzw. ein Vorname mehr, gleiches Geschlecht,
 *    vereinbare Daten). „sicher“ wird ein so gefundenes Paar nur, wenn das
 *    Paar, auf dem es ruht, selbst „sicher“ ist, der ganze Vorname gleich ist
 *    und beide ein vereinbares Geburtsdatum haben; sonst höchstens
 *    „wahrscheinlich“ (schwache Belege werden nicht „gewaschen“).
 * 3. **Eindeutigkeit**: je Person und anderer Gruppe höchstens ein Partner;
 *    zwei ähnlich gute Kandidaten → beide „unklar“.
 * 4. **Cluster** (mehr als zwei Importe): Vereinigung der angenommenen Paare;
 *    je Gruppe höchstens ein Mitglied, alle Mitglieder paarweise vereinbar —
 *    sonst wird die schwächste Kante gelöst („unklar“) und neu geprüft.
 * 5. **Brücken**: Eine Verbindung zwischen zwei sonst getrennten Teilen ist
 *    eine Brücke. Ist sie die einzige zwischen diesen Teilen und stützt sie
 *    sich auf keinen schon verbundenen Verwandten, ist sie nie „sicher“.
 */
import { datesCompatible } from "./merge-rules";
import { minYearDistance } from "./dates";
import { findDuplicatePairs, lineageOf, scoreDuplicate, type Confidence, type DupPerson, type Lineage } from "./duplicates";
import { firstGivenKey, nameKey } from "./name-keys";

export type LinkPerson = DupPerson & { group: string };

export type LinkPair = {
  a: string;
  b: string;
  confidence: Confidence;
  score: number;
  reasons: string[];
  conflicts: string[];
  /** Über einen Verwandten gefunden (Ausbreitung). */
  viaRelative: boolean;
  /** Verbindet zwei vorher getrennte Teile. */
  bridge?: { sizeA: number; sizeB: number; only: boolean };
  /**
   * Teilklasse „sehr wahrscheinlich“ innerhalb von „wahrscheinlich“: zwei
   * übereinstimmende Verwandte, oder gleiches tagesgenaues Geburtsdatum plus
   * ein übereinstimmender Verwandter; nie eine einzige Brücke, nie mit
   * einseitig fehlendem Geburtsdatum. Auf den erfundenen Testbäumen ≥ 99,9 %
   * richtig (tests/import-linking.test.ts) — trotzdem nie vorausgewählt.
   */
  veryLikely?: boolean;
};

export type LinkCluster = { members: string[]; confidence: Confidence };

export type LinkResult = {
  pairs: LinkPair[];
  /** Cluster aus Paaren der Klasse „sicher“ (Grundlage des schnellen Wegs). */
  sureClusters: LinkCluster[];
  /**
   * Teile des Stammbaums: Familienverbände (mindestens zwei verbundene
   * Personen) und Einzelpersonen ohne jede Verbindung — vorher und nach den
   * sicheren Verbindungen.
   */
  components: { before: number; afterSure: number; beforeGroups: number; beforeSingles: number; afterGroups: number; afterSingles: number };
  /** Verbindungspersonen je Gruppenpaar (nur „sicher“). */
  bridgesByGroups: { groups: [string, string]; count: number }[];
  durationMs: number;
};

export type LinkOptions = {
  /** Gruppen, die verglichen werden; leer = alle. */
  groups?: string[];
  /** Innerhalb derselben Gruppe vergleichen („Dubletten in diesem Import“). */
  withinGroup?: boolean;
  /** Paare, die nie vorgeschlagen werden („kein Duplikat“). */
  dismissed?: Set<string>;
  /**
   * Abstammung (Vorfahre/Nachkomme schließt ein Paar aus); ohne Angabe aus
   * den `parents` aller übergebenen Personen (lineageOf) — dieselbe Regel wie
   * die Dublettenliste, auch für die Ausbreitung über Verwandte.
   */
  lineage?: Lineage;
  /** Zusätzliche Kanten des Stammbaums für die Teile (ohne diese: aus parents/partners/children). */
};

const RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };
const pk = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Gelockerte Prüfung für Verwandte bereits verbundener Personen (Ausbreitung
 * hier; Folgedubletten nach einem Zusammenführen in
 * lib/services/merge-followups.ts). Sagt nur, ob ein Paar überhaupt in Frage
 * kommt — die Klasse „sicher“ vergibt sie nie.
 */
export function relaxedMatch(a: DupPerson, b: DupPerson): { ok: boolean; fullGiven: boolean; birthBoth: boolean } {
  const no = { ok: false, fullGiven: false, birthBoth: false };
  if (a.gender !== "UNKNOWN" && b.gender !== "UNKNOWN" && a.gender !== b.gender) return no;
  const ga = nameKey(a.givenName);
  const gb = nameKey(b.givenName);
  const fullGiven = Boolean(ga) && ga === gb;
  const ta = ga.split(" ");
  const tb = gb.split(" ");
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const subset = short.length > 0 && short.every((t) => long.includes(t)) && short.length < long.length;
  // Zwillinge „Anna Maria“ / „Anna Katharina“: nur der erste gleich → nein.
  if (!fullGiven && !subset) return no;
  if (firstGivenKey(a.givenName) !== firstGivenKey(b.givenName)) return no;
  for (const k of ["birth", "death"] as const) {
    const x = a[k];
    const y = b[k];
    if (x && y && !datesCompatible(x, y) && minYearDistance(x, y) > 1) return no;
  }
  return { ok: true, fullGiven, birthBoth: Boolean(a.birth && b.birth && datesCompatible(a.birth, b.birth)) };
}

/** Zusammenhängende Teile über Eltern-, Partner- und Kindkanten. */
function components(people: LinkPerson[], extraEdges: [string, string][] = []) {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a) || !parent.has(b)) return;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const p of people) parent.set(p.id, p.id);
  for (const p of people) for (const o of [...p.parents, ...p.partners, ...p.children]) union(p.id, o);
  for (const [a, b] of extraEdges) union(a, b);
  const size = new Map<string, number>();
  for (const p of people) size.set(find(p.id), (size.get(find(p.id)) ?? 0) + 1);
  const sizes = [...size.values()];
  return { find, size, count: size.size, groups: sizes.filter((n) => n >= 2).length, singles: sizes.filter((n) => n < 2).length };
}

export function linkImports(people: LinkPerson[], options: LinkOptions = {}): LinkResult {
  const t0 = performance.now();
  const byId = new Map(people.map((p) => [p.id, p]));
  const groups = options.groups?.length ? new Set(options.groups) : null;
  const inScope = (p: LinkPerson) => !groups || groups.has(p.group);
  const dismissed = options.dismissed ?? new Set<string>();
  // Abstammung über ALLE übergebenen Personen, nicht nur die gewählten Gruppen:
  // Die Kette kann über Personen anderer Importe laufen.
  const lineage = options.lineage ?? lineageOf(people);
  const allowed = (a: LinkPerson, b: LinkPerson) =>
    inScope(a) && inScope(b) && (options.withinGroup ? a.group === b.group : a.group !== b.group) && !dismissed.has(pk(a.id, b.id));

  // 1. Anker
  const cand = new Map<string, LinkPair>();
  for (const p of findDuplicatePairs(people.filter(inScope), { include: (x, y) => allowed(x as LinkPerson, y as LinkPerson), minScore: 0.5, lineage })) {
    let confidence = p.confidence;
    const reasons = [...p.reasons];
    // „wahrscheinlich“ nur mit einem Beleg über Name und ungefähres Jahr
    // hinaus: tagesgenau gleiche Geburt, passender Tod oder Verwandte. Sonst
    // sind es oft zwei Menschen gleichen Namens aus derselben Gegend und Zeit.
    if (confidence === "medium") {
      const strong = p.reasons.some((r) => /gleiches Geburtsdatum|gleiches Sterbedatum|^Tod |Eltern|Partner|Kind/.test(r));
      if (!strong) {
        confidence = "low";
        reasons.push("nur Name und ungefähres Geburtsjahr stimmen überein");
      }
    }
    cand.set(pk(p.a, p.b), { a: p.a, b: p.b, confidence, score: p.score, reasons, conflicts: p.conflicts, viaRelative: false });
  }

  // 2.+3. Annehmen mit Eindeutigkeit, Ausbreitung
  const matchOf = new Map<string, Map<string, { other: string; pair: LinkPair }>>(); // person → (Gruppe → Partner)
  const accepted = new Map<string, LinkPair>();
  const getMatch = (id: string, group: string) => matchOf.get(id)?.get(group);
  const setMatch = (p: LinkPair) => {
    const a = byId.get(p.a)!;
    const b = byId.get(p.b)!;
    const ma = matchOf.get(a.id) ?? new Map();
    const mb = matchOf.get(b.id) ?? new Map();
    ma.set(b.group, { other: b.id, pair: p });
    mb.set(a.group, { other: a.id, pair: p });
    matchOf.set(a.id, ma);
    matchOf.set(b.id, mb);
    accepted.set(pk(p.a, p.b), p);
  };
  const unclear = new Map<string, LinkPair>();

  /** Mehrdeutig: gibt es für a in der Gruppe von b einen ähnlich guten anderen Kandidaten? */
  const ambiguous = (p: LinkPair, pool: LinkPair[]) =>
    pool.some(
      (q) =>
        q !== p &&
        RANK[q.confidence] <= RANK.medium &&
        p.score - q.score < 0.15 &&
        ((q.a === p.a && byId.get(q.b)!.group === byId.get(p.b)!.group) ||
          (q.b === p.b && byId.get(q.a)!.group === byId.get(p.a)!.group) ||
          (q.a === p.b && byId.get(q.b)!.group === byId.get(p.a)!.group) ||
          (q.b === p.a && byId.get(q.a)!.group === byId.get(p.b)!.group)),
    );

  const ordered = [...cand.values()].sort((x, y) => RANK[x.confidence] - RANK[y.confidence] || y.score - x.score || x.a.localeCompare(y.a));
  const byPerson = new Map<string, LinkPair[]>();
  for (const p of ordered) for (const id of [p.a, p.b]) byPerson.set(id, [...(byPerson.get(id) ?? []), p]);
  const queue: LinkPair[] = [];
  const tryAccept = (p: LinkPair, pool: LinkPair[]) => {
    const a = byId.get(p.a)!;
    const b = byId.get(p.b)!;
    if (accepted.has(pk(p.a, p.b))) return;
    if (getMatch(a.id, b.group) || getMatch(b.id, a.group)) {
      if (getMatch(a.id, b.group)?.other !== b.id) unclear.set(pk(p.a, p.b), { ...p, confidence: "low", conflicts: [...p.conflicts, "schon einer anderen Person zugeordnet"] });
      return;
    }
    if (p.confidence === "low") {
      unclear.set(pk(p.a, p.b), p);
      return;
    }
    if (ambiguous(p, pool)) {
      unclear.set(pk(p.a, p.b), { ...p, confidence: "low", conflicts: [...p.conflicts, "mehrere ähnlich passende Kandidaten"] });
      return;
    }
    setMatch(p);
    queue.push(p);
  };
  for (const p of ordered) tryAccept(p, [...(byPerson.get(p.a) ?? []), ...(byPerson.get(p.b) ?? [])]);

  // Ausbreitung über Verwandte
  while (queue.length) {
    const base = queue.shift()!;
    const a = byId.get(base.a)!;
    const b = byId.get(base.b)!;
    const kinds: [string[], string[], string][] = [
      [a.parents, b.parents, "Kinder"],
      [a.partners, b.partners, "Partner"],
      [a.children, b.children, "Eltern"],
    ];
    for (const [xs, ys, rel] of kinds) {
      const found: LinkPair[] = [];
      for (const x of xs) {
        const px = byId.get(x);
        if (!px || !inScope(px)) continue;
        for (const y of ys) {
          const py = byId.get(y);
          if (!py || !inScope(py) || !allowed(px, py)) continue;
          const key = pk(px.id, py.id);
          if (accepted.has(key)) continue;
          const m = relaxedMatch(px, py);
          if (!m.ok) continue;
          // relaxedMatch kennt keine Verwandtschaft: Vorfahre/Nachkomme (auch
          // direkte Eltern/Kinder) hier ausdrücklich ausschließen.
          if (lineage(px.id, py.id)) continue;
          const s = scoreDuplicate(px, py, { lineage });
          if (s && s.conflicts.length) continue;
          const sure = base.confidence === "high" && m.fullGiven && m.birthBoth && !(s && s.conflicts.length);
          const [ia, ib] = px.id < py.id ? [px.id, py.id] : [py.id, px.id];
          found.push({
            a: ia,
            b: ib,
            confidence: sure ? "high" : "medium",
            score: Math.max(s?.score ?? 0, sure ? 0.9 : 0.75),
            reasons: [...(s?.reasons ?? [`Vorname ${px.givenName} / ${py.givenName}`]), `${rel} bereits zugeordnet`],
            conflicts: [],
            viaRelative: true,
          });
        }
      }
      // Eindeutigkeit unter den Geschwistern/Eltern: je Person höchstens ein Treffer
      for (const p of found) {
        const rivals = found.filter((q) => q !== p && (q.a === p.a || q.b === p.b || q.a === p.b || q.b === p.a));
        if (rivals.length) {
          unclear.set(pk(p.a, p.b), { ...p, confidence: "low", conflicts: ["mehrere Verwandte passen gleich gut (z.B. gleichnamige Geschwister)"] });
          continue;
        }
        tryAccept(p, []);
      }
    }
  }

  // 4. Cluster prüfen
  let changed = true;
  while (changed) {
    changed = false;
    const live = [...accepted.values()];
    const uf = new Map<string, string>();
    const find = (x: string): string => {
      let r = uf.get(x) ?? x;
      while ((uf.get(r) ?? r) !== r) r = uf.get(r)!;
      return r;
    };
    for (const e of live) {
      const ra = find(e.a);
      const rb = find(e.b);
      if (ra !== rb) uf.set(ra, rb);
    }
    const members = new Map<string, string[]>();
    for (const id of new Set(live.flatMap((e) => [e.a, e.b]))) members.set(find(id), [...(members.get(find(id)) ?? []), id]);
    for (const list of members.values()) {
      if (list.length <= 2) continue;
      const seenGroups = new Set<string>();
      let bad = false;
      for (const id of list) {
        const g = byId.get(id)!.group;
        if (seenGroups.has(g) && !options.withinGroup) bad = true;
        seenGroups.add(g);
      }
      for (let i = 0; i < list.length && !bad; i++) {
        for (let j = i + 1; j < list.length && !bad; j++) {
          const s2 = scoreDuplicate(byId.get(list[i])!, byId.get(list[j])!, { lineage });
          if (!s2 || s2.conflicts.length) bad = true;
        }
      }
      if (!bad) continue;
      const weakest = live
        .filter((e) => list.includes(e.a))
        .sort((x, y) => RANK[y.confidence] - RANK[x.confidence] || x.score - y.score)[0];
      accepted.delete(pk(weakest.a, weakest.b));
      unclear.set(pk(weakest.a, weakest.b), { ...weakest, confidence: "low", conflicts: [...weakest.conflicts, "widerspricht einem anderen Eintrag dieser Personengruppe"] });
      changed = true;
      break;
    }
  }

  // 5. Brücken
  const before = components(people);
  const acceptedList = [...accepted.values()];
  const between = new Map<string, LinkPair[]>();
  for (const p of acceptedList) {
    const ca = before.find(p.a);
    const cb = before.find(p.b);
    if (ca === cb) continue;
    const key = pk(ca, cb);
    between.set(key, [...(between.get(key) ?? []), p]);
  }
  for (const list of between.values()) {
    const only = list.length === 1;
    for (const p of list) {
      p.bridge = { sizeA: before.size.get(before.find(p.a)) ?? 1, sizeB: before.size.get(before.find(p.b)) ?? 1, only };
      if (only && !p.viaRelative && !p.reasons.some((r) => /Eltern|Partner|Kind/.test(r)) && p.confidence === "high") {
        p.confidence = "medium";
        p.reasons = [...p.reasons, "einzige Verbindung zweier sonst getrennter Familien — bitte prüfen"];
      }
    }
  }

  const REL = /Eltern|Partner|Kind/;
  for (const p of acceptedList) {
    if (p.confidence !== "medium" || p.bridge?.only || p.reasons.some((r) => /nur bei einer Person/.test(r))) continue;
    const rel = p.reasons.filter((r) => REL.test(r)).length;
    if (rel >= 2 || (rel >= 1 && p.reasons.some((r) => /gleiches Geburtsdatum/.test(r)))) p.veryLikely = true;
  }
  const sure = acceptedList.filter((p) => p.confidence === "high");
  const after = components(people, sure.map((p) => [p.a, p.b] as [string, string]));
  // Cluster der sicheren Paare
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = parent.get(x) ?? x;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const p of sure) {
    const ra = find(p.a);
    const rb = find(p.b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const cl = new Map<string, string[]>();
  for (const id of new Set(sure.flatMap((p) => [p.a, p.b]))) cl.set(find(id), [...(cl.get(find(id)) ?? []), id]);
  const bridgeCount = new Map<string, { groups: [string, string]; count: number }>();
  for (const p of sure) {
    if (!p.bridge) continue;
    const g = [byId.get(p.a)!.group, byId.get(p.b)!.group].sort() as [string, string];
    const key = g.join("|");
    bridgeCount.set(key, { groups: g, count: (bridgeCount.get(key)?.count ?? 0) + 1 });
  }

  const pairs = [...acceptedList, ...[...unclear.values()].filter((u) => !accepted.has(pk(u.a, u.b)))].sort(
    (x, y) => Number(Boolean(y.bridge)) - Number(Boolean(x.bridge)) || RANK[x.confidence] - RANK[y.confidence] || y.score - x.score,
  );
  return {
    pairs,
    sureClusters: [...cl.values()].map((members) => ({ members: members.sort(), confidence: "high" as const })),
    components: {
      before: before.count,
      afterSure: after.count,
      beforeGroups: before.groups,
      beforeSingles: before.singles,
      afterGroups: after.groups,
      afterSingles: after.singles,
    },
    bridgesByGroups: [...bridgeCount.values()],
    durationMs: Math.round(performance.now() - t0),
  };
}

/**
 * Begründung als Satz: „Gleicher Name, gleiches Geburtsdatum (12.03.1850),
 * Partner mit gleichem Namen; aus verschiedenen Importen.“
 */
export function evidenceSentence(reasons: string[]): string {
  const r = [...reasons];
  const gv = r.indexOf("gleicher Vorname");
  const gn = r.indexOf("gleicher Nachname");
  if (gv >= 0 && gn >= 0) {
    r.splice(Math.max(gv, gn), 1);
    r.splice(Math.min(gv, gn), 1, "gleicher Name");
  }
  const tail = r.filter((x) => x === "aus verschiedenen Importen" || x.startsWith("einzige Verbindung"));
  const main = r.filter((x) => !tail.includes(x));
  const text = [main.join(", "), tail.join("; ")].filter(Boolean).join("; ");
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : "";
}
