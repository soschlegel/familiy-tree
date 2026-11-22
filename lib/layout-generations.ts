import {
  indexTree,
  NODE_HEIGHT,
  NODE_WIDTH,
  type LayoutEdge,
  type LayoutNode,
  type MarriageEvent,
  type ParentJunction,
  type TreeData,
  type TreePerson,
} from "./tree-layout";

/**
 * Generationen-Layout.
 *
 * Ersetzt die frühere Strang-Zerlegung, die von jeder elternlosen Person aus
 * nach unten lief. Die hatte zwei Schwächen, die sich nicht durch Umsortieren
 * beheben ließen:
 *
 * 1. Ein Ehepaar wurde getrennt, sobald BEIDE Partner eigene Eltern haben —
 *    einer landete im Strang seiner Eltern, der andere weit entfernt.
 * 2. Zusammengehörige Teile derselben Familie kamen in verschiedene Stränge
 *    und wurden von fremden Strängen auseinandergeschoben.
 *
 * Stattdessen wird jetzt jeder Person eine Generation zugewiesen (längster
 * Weg von einer elternlosen Person), Ehepaare werden auf dieselbe Generation
 * gezogen und innerhalb einer Generation so angeordnet, dass möglichst wenige
 * Linien kreuzen.
 */

const H_GAP = 40;
/**
 * Abstand zwischen zwei Kartenreihen. Er trägt: die Sammelschienen der
 * Abstammungslinien (34px unter der Karte, bis zu vier Spuren — siehe
 * ParentEdge), die unter der Reihe geführten Ehe-Kanten samt Marker (54px)
 * und die Treffpunkte auf halber Höhe. 112 reicht dafür mit Luft; vorher 130
 * plus 26px ungenutzte Knotenhöhe.
 */
const V_GAP = 112;
const CONNECTOR = 56;

/**
 * Platzbedarf einer Hochzeit auf dem Zeitstrahl (components/MarriageNode:
 * Bild bis 56px, darunter das Datum), gemessen ab ihrer linken oberen Ecke.
 */
export const EVENT_BOX = { width: 88, height: 84 } as const;
const EVENT_GAP = 6;

/**
 * Ein Kasten im Layout: eine Person, ein Ehepaar auf einer Doppelkarte — oder
 * ein Platzhalter.
 *
 * Platzhalter werden für Linien eingefügt, die mehr als eine Generation
 * überspannen. Das kommt vor, sobald jemand durch Heirat eine Ebene nach unten
 * gezogen wird: dann liegt ein Elternteil zwei Ebenen höher, und die Linie
 * müsste quer durch die Zeile dazwischen. Der Platzhalter belegt dort
 * Breite und hält so einen freien Korridor frei, durch den die Linie läuft,
 * ohne fremde Karten zu schneiden.
 */
type Unit = {
  id: string;
  person: TreePerson | null;
  partner: TreePerson | null;
  generation: number;
  order: number;
  x: number;
  dummy: boolean;
};

/** Breite des Korridors, den eine durchlaufende Linie beansprucht. */
const DUMMY_WIDTH = 24;

const unitWidth = (u: Unit) =>
  u.dummy ? DUMMY_WIDTH : u.partner ? NODE_WIDTH * 2 + CONNECTOR : NODE_WIDTH;

/** Ein Stück Linie zwischen zwei benachbarten Ebenen. */
type Segment = { upper: Unit; lower: Unit };

/**
 * Generation = längster Weg von einer elternlosen Person. Der längste (nicht
 * der kürzeste) Weg ist entscheidend: sonst rutschte ein Kind, das über einen
 * kurzen Zweig erreichbar ist, neben seine eigenen Großeltern.
 */
function computeGenerations(data: TreeData): Map<string, number> {
  const idx = indexTree(data);
  const gen = new Map<string, number>();
  const visiting = new Set<string>();

  const depth = (id: string): number => {
    const cached = gen.get(id);
    if (cached !== undefined) return cached;

    // Ringschluss-Absicherung. Zyklen werden beim Anlegen verhindert, aber ein
    // Layout darf daran nicht endlos laufen.
    if (visiting.has(id)) return 0;
    visiting.add(id);

    const parents = idx.parentsOf.get(id) ?? [];
    const value =
      parents.length === 0 ? 0 : Math.max(...parents.map(depth)) + 1;

    visiting.delete(id);
    gen.set(id, value);
    return value;
  };

  for (const p of data.persons) depth(p.id);

  /**
   * Geburtsjahre schlagen die Ahnenzahl.
   *
   * Die reine Abstammungstiefe verschiebt Zweige gegeneinander, sobald in
   * einem die Vorfahren tiefer erfasst sind als im anderen — wer viele
   * Generationen kennt, rutscht nach unten, obwohl er gleich alt ist. Wo
   * Geburtsjahre vorliegen, geben sie das ehrlichere Bild: Menschen ähnlichen
   * Jahrgangs gehören auf eine Ebene, unabhängig davon, wie weit die Ahnen
   * erforscht sind.
   */
  const yearOfBirth = (id: string): number | null => {
    const person = idx.byId.get(id);
    if (!person?.birthDate) return null;
    const y = new Date(person.birthDate).getFullYear();
    return Number.isFinite(y) ? y : null;
  };

  const known = data.persons
    .map((p) => yearOfBirth(p.id))
    .filter((y): y is number => y !== null);

  if (known.length >= 2) {
    const reference = Math.min(...known);
    // Abstand zweier Generationen. 28 Jahre ist ein üblicher Mittelwert; die
    // Regeln unten korrigieren Ausreißer ohnehin.
    const SPAN = 28;

    for (const p of data.persons) {
      const year = yearOfBirth(p.id);
      if (year !== null) {
        gen.set(p.id, Math.round((year - reference) / SPAN));
      }
    }

    // Personen ohne Geburtsjahr aus ihren Nachbarn ableiten, statt sie auf
    // der alten Ahnentiefe stehen zu lassen — die passt nicht mehr zur neuen
    // Skala und risse sie aus ihrer Familie heraus.
    for (let round = 0; round < 10; round++) {
      let changed = false;
      for (const p of data.persons) {
        if (yearOfBirth(p.id) !== null) continue;

        const hints: number[] = [];
        for (const parent of idx.parentsOf.get(p.id) ?? []) {
          const g = gen.get(parent);
          if (g !== undefined && yearOfBirth(parent) !== null) hints.push(g + 1);
        }
        for (const child of idx.childrenOf.get(p.id) ?? []) {
          const g = gen.get(child);
          if (g !== undefined && yearOfBirth(child) !== null) hints.push(g - 1);
        }
        for (const partner of idx.partnersOf.get(p.id) ?? []) {
          const g = gen.get(partner);
          if (g !== undefined && yearOfBirth(partner) !== null) hints.push(g);
        }

        if (hints.length === 0) continue;
        const value = Math.round(
          hints.reduce((a, b) => a + b, 0) / hints.length,
        );
        if (gen.get(p.id) !== value) {
          gen.set(p.id, value);
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  // Geschwisterpaare vorbereiten: wer einen Elternteil teilt, gehört
  // derselben Generation an.
  const siblings: [string, string][] = [];
  for (const kids of idx.childrenOf.values()) {
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        siblings.push([kids[i], kids[j]]);
      }
    }
  }

  /**
   * Drei Regeln gegeneinander ausgleichen, bis sich nichts mehr ändert:
   *
   * 1. Ehepartner stehen auf derselben Ebene.
   * 2. Geschwister stehen auf derselben Ebene.
   * 3. Ein Kind steht mindestens eine Ebene unter jedem Elternteil.
   *
   * Regel 2 ist der Grund für diese Schleife. Die reine Abstammungstiefe
   * verschiebt Zweige gegeneinander, sobald in einem die Vorfahren tiefer
   * erfasst sind als im anderen. Eine Ehe über diese Verschiebung hinweg zieht
   * dann einen Partner auf die Ebene des anderen — ohne Regel 2 bliebe dessen
   * Geschwister allein zurück, obwohl beide dieselben Eltern haben.
   *
   * Werte wachsen nur (Maximum), deshalb terminiert das normalerweise. Die
   * Obergrenze fängt widersprüchliche Daten ab, etwa wenn jemand mit einem
   * eigenen Nachfahren verheiratet ist — dann sind die Regeln nicht alle
   * gleichzeitig erfüllbar.
   */
  for (let round = 0; round < 20; round++) {
    let changed = false;

    const align = (a: string, b: string) => {
      const x = gen.get(a);
      const y = gen.get(b);
      if (x === undefined || y === undefined || x === y) return;
      const target = Math.max(x, y);
      gen.set(a, target);
      gen.set(b, target);
      changed = true;
    };

    for (const r of data.relationships) {
      if (r.type !== "PARTNER_OF") continue;
      align(r.fromPersonId, r.toPersonId);
    }

    for (const [a, b] of siblings) align(a, b);

    // Abstammung zuletzt: sie darf durch die Angleichung nicht verletzt werden.
    for (const p of data.persons) {
      const parents = idx.parentsOf.get(p.id) ?? [];
      if (parents.length === 0) continue;
      const lowest = Math.max(...parents.map((id) => gen.get(id) ?? 0));
      if ((gen.get(p.id) ?? 0) < lowest + 1) {
        gen.set(p.id, lowest + 1);
        changed = true;
      }
    }

    if (!changed) break;
  }

  // Leere Ebenen herausnehmen. Die Jahrgangsschätzung erzeugt Lücken, sobald
  // zwischen zwei Generationen mehr als ein Generationenabstand liegt — sonst
  // klaffte im Baum eine leere Zeile.
  const used = [...new Set(gen.values())].sort((a, b) => a - b);
  const compact = new Map(used.map((value, index) => [value, index]));
  for (const [id, value] of gen) gen.set(id, compact.get(value) ?? 0);

  return gen;
}

/** Vorgegebene Ebenen auf 0 … n verschieben; fehlende Personen auf Ebene 0. */
function normalizeGenerations(
  data: TreeData,
  given: Map<string, number>,
): Map<string, number> {
  const gen = new Map<string, number>();
  for (const p of data.persons) gen.set(p.id, given.get(p.id) ?? 0);
  const min = Math.min(0, ...gen.values());
  for (const [id, g] of gen) gen.set(id, g - min);
  return gen;
}

/**
 * Fasst Ehepaare zu einer Doppelkarte zusammen. Anders als früher wird dabei
 * NICHT verlangt, dass ein Partner elternlos ist: die Kanten werden ohnehin
 * aus den Beziehungsdaten abgeleitet und am Kasten verankert, also geht durch
 * das Zusammenfassen keine Verbindung zu den jeweiligen Eltern verloren.
 */
function buildUnits(
  data: TreeData,
  gen: Map<string, number>,
  mergeCouples = true,
): Unit[] {
  const idx = indexTree(data);
  const used = new Set<string>();
  const units: Unit[] = [];

  // Feste Reihenfolge, damit dasselbe Datenbild immer gleich aussieht.
  const ordered = [...data.persons].sort(
    (a, b) =>
      (gen.get(a.id) ?? 0) - (gen.get(b.id) ?? 0) ||
      (a.familyName ?? "").localeCompare(b.familyName ?? "") ||
      a.givenName.localeCompare(b.givenName),
  );

  for (const person of ordered) {
    if (used.has(person.id)) continue;
    used.add(person.id);

    const generation = gen.get(person.id) ?? 0;
    // Im Zeitstrahl wird nicht zusammengefasst: dort ergibt sich die Höhe aus
    // dem Geburtsjahr, und eine gemeinsame Karte zwänge beide Partner auf
    // dieselbe Höhe — auch bei Jahrzehnten Altersunterschied.
    const partnerId = mergeCouples
      ? (idx.partnersOf.get(person.id) ?? []).find(
          (pid) => !used.has(pid) && (gen.get(pid) ?? 0) === generation,
        )
      : undefined;
    if (partnerId) used.add(partnerId);

    units.push({
      id: person.id,
      person,
      partner: partnerId ? (idx.byId.get(partnerId) ?? null) : null,
      generation,
      order: 0,
      x: 0,
      dummy: false,
    });
  }

  return units;
}

/**
 * Ordnet die Kästen innerhalb jeder Generation. Verwendet das übliche
 * Baryzentrum-Verfahren: jeder Kasten rückt an die mittlere Position seiner
 * Nachbarn in der angrenzenden Generation. Abwechselnd von oben nach unten und
 * zurück, bis sich die Zahl der Kreuzungen nicht mehr verbessert.
 */
function orderUnits(units: Unit[], segments: Segment[]): void {
  const layers = new Map<number, Unit[]>();
  for (const u of units) {
    const list = layers.get(u.generation);
    if (list) list.push(u);
    else layers.set(u.generation, [u]);
  }

  const generations = [...layers.keys()].sort((a, b) => a - b);
  for (const g of generations) {
    layers.get(g)!.forEach((u, i) => (u.order = i));
  }

  // Nachbarn je Kasten, getrennt nach Richtung.
  const up = new Map<string, Set<string>>();
  const down = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, v: string) => {
    const s = m.get(k);
    if (s) s.add(v);
    else m.set(k, new Set([v]));
  };

  for (const { upper, lower } of segments) {
    add(down, upper.id, lower.id);
    add(up, lower.id, upper.id);
  }

  const orderOf = new Map<string, number>();
  const sync = () => {
    orderOf.clear();
    for (const u of units) orderOf.set(u.id, u.order);
  };
  sync();

  const barycenter = (id: string, m: Map<string, Set<string>>) => {
    const neighbours = m.get(id);
    if (!neighbours || neighbours.size === 0) return null;
    let sum = 0;
    for (const n of neighbours) sum += orderOf.get(n) ?? 0;
    return sum / neighbours.size;
  };

  // Kanten nach Generationenpaar vorsortieren. Kreuzen können sich nur Kanten
  // zwischen denselben beiden Ebenen — ohne diese Gruppierung wäre das Zählen
  // quadratisch in der Gesamtzahl aller Kanten und bei größeren Beständen zu
  // langsam, weil es bei jedem Tauschversuch neu läuft.
  const linkGroups = new Map<string, { a: Unit; b: Unit }[]>();
  for (const { upper, lower } of segments) {
    const key = `${upper.generation}-${lower.generation}`;
    const group = linkGroups.get(key);
    if (group) group.push({ a: upper, b: lower });
    else linkGroups.set(key, [{ a: upper, b: lower }]);
  }

  const crossingsIn = (group: { a: Unit; b: Unit }[]) => {
    let total = 0;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const p = group[i];
        const q = group[j];
        if ((p.a.order - q.a.order) * (p.b.order - q.b.order) < 0) total++;
      }
    }
    return total;
  };

  const countCrossings = () => {
    let total = 0;
    for (const group of linkGroups.values()) total += crossingsIn(group);
    return total;
  };

  // Ein Tausch innerhalb einer Generation ändert nur die Kreuzungen der
  // Gruppen, die diese Generation berühren. Beim Nachbessern genügt es daher,
  // diese neu zu zählen — das Ergebnis ist dasselbe, aber um ein Vielfaches
  // schneller (spürbar beim Umschalten auf den Zeitstrahl).
  const groupsByGeneration = new Map<number, { a: Unit; b: Unit }[][]>();
  for (const group of linkGroups.values()) {
    const gens = new Set([group[0].a.generation, group[0].b.generation]);
    for (const g of gens) {
      const list = groupsByGeneration.get(g);
      if (list) list.push(group);
      else groupsByGeneration.set(g, [group]);
    }
  }
  const crossingsAround = (g: number) => {
    let total = 0;
    for (const group of groupsByGeneration.get(g) ?? []) total += crossingsIn(group);
    return total;
  };

  /**
   * Noch gezielter: Tauschen zwei NACHBARN a und b, ändert sich nur, ob sich
   * Linien von a mit Linien von b kreuzen — und zwar kippt genau jedes
   * solche Paar mit verschiedenen anderen Enden. Das ist O(Grad(a)·Grad(b))
   * statt quadratisch in der Kantenzahl. Für die seltenen Linien innerhalb
   * einer Ebene greift weiter die vollständige Zählung (crossingsAround).
   */
  type Incidence = { key: string; other: Unit; upperSide: boolean };
  const incidences = new Map<string, Incidence[]>();
  const flatUnits = new Set<string>();
  for (const { upper, lower } of segments) {
    const key = `${upper.generation}-${lower.generation}`;
    if (upper.generation === lower.generation) {
      flatUnits.add(upper.id);
      flatUnits.add(lower.id);
    }
    const push = (u: Unit, inc: Incidence) => {
      const list = incidences.get(u.id);
      if (list) list.push(inc);
      else incidences.set(u.id, [inc]);
    };
    push(upper, { key, other: lower, upperSide: true });
    push(lower, { key, other: upper, upperSide: false });
  }
  /** Änderung der Kreuzungszahl, wenn a (links) und b (rechts) tauschen; null = unbekannt. */
  const swapDelta = (a: Unit, b: Unit): number | null => {
    if (flatUnits.has(a.id) || flatUnits.has(b.id)) return null;
    let delta = 0;
    for (const e of incidences.get(a.id) ?? []) {
      for (const f of incidences.get(b.id) ?? []) {
        if (e.key !== f.key || e.upperSide !== f.upperSide) continue;
        const diff = e.other.order - f.other.order;
        if (diff === 0) continue;
        const crossingBefore = (a.order - b.order) * diff < 0;
        delta += crossingBefore ? -1 : 1;
      }
    }
    return delta;
  };

  let best = countCrossings();
  let bestOrder = new Map(units.map((u) => [u.id, u.order]));

  for (let sweep = 0; sweep < 12; sweep++) {
    const forward = sweep % 2 === 0;
    const sequence = forward ? generations : [...generations].reverse();

    for (const g of sequence) {
      const layer = layers.get(g)!;
      const source = forward ? up : down;

      const scored = layer.map((u) => ({
        unit: u,
        key: barycenter(u.id, source) ?? u.order,
      }));
      scored.sort((a, b) => a.key - b.key || a.unit.order - b.unit.order);
      scored.forEach((s, i) => (s.unit.order = i));
      layers.set(
        g,
        scored.map((s) => s.unit),
      );
      sync();
    }

    const crossings = countCrossings();
    if (crossings < best) {
      best = crossings;
      bestOrder = new Map(units.map((u) => [u.id, u.order]));
    }
  }

  const snapshot = () => new Map(units.map((u) => [u.id, u.order]));
  const restore = (snap: Map<string, number>) => {
    for (const u of units) u.order = snap.get(u.id) ?? u.order;
    for (const g of generations) {
      layers.get(g)!.sort((a, b) => a.order - b.order);
    }
    sync();
  };

  restore(bestOrder);

  /**
   * Nachbesserung durch Tausch benachbarter Kästen.
   *
   * Gleichwertige Tausche werden dabei ZUGELASSEN, nicht nur verbessernde.
   * Grund: manche Kreuzung löst sich erst auf, wenn zwei Generationen
   * gemeinsam umsortiert werden — der erste Schritt dorthin bringt für sich
   * genommen noch keinen Gewinn. Ohne diese Seitwärtsbewegung bleibt das
   * Verfahren davor stecken. Der beste je erreichte Stand wird mitgeführt und
   * am Ende wiederhergestellt, sodass die Lockerung nichts verschlechtern kann.
   */
  // Bei sehr großen Beständen kostet die Nachbesserung mehr, als sie bringt —
  // dann bleibt es beim Baryzentrum-Ergebnis.
  const refine = units.length <= 400;

  // Laufende Gesamtzahl; je Tausch wird nur der betroffene Ausschnitt neu
  // gezählt. (orderOf/sync braucht hier niemand — nur das Baryzentrum oben.)
  let current = refine ? countCrossings() : 0;

  for (let pass = 0; refine && pass < 12; pass++) {
    let improvedStrictly = false;
    let moved = false;

    for (const g of generations) {
      const layer = layers.get(g)!;
      for (let i = 0; i + 1 < layer.length; i++) {
        const before = current;
        const a = layer[i];
        const b = layer[i + 1];
        const delta = swapDelta(a, b);
        const localBefore = delta === null ? crossingsAround(g) : 0;

        [a.order, b.order] = [b.order, a.order];
        layer[i] = b;
        layer[i + 1] = a;

        const after =
          delta === null ? before - localBefore + crossingsAround(g) : before + delta;
        // Gleichwertige Tausche in jedem zweiten Durchlauf zulassen.
        const acceptTie = after === before && pass % 2 === 1;

        if (after < before || acceptTie) {
          current = after;
          moved = true;
          if (after < before) improvedStrictly = true;
          if (after < best) {
            best = after;
            bestOrder = snapshot();
          }
        } else {
          [a.order, b.order] = [b.order, a.order];
          layer[i] = a;
          layer[i + 1] = b;
        }
      }
    }

    // Erst abbrechen, wenn auch ein Durchlauf MIT erlaubten Seitwärtsschritten
    // nichts mehr bewegt hat. Sonst endet das Verfahren schon nach dem ersten,
    // strengen Durchlauf — und genau der Seitwärtsschritt, der die letzte
    // Kreuzung auflöst, käme nie zustande.
    if (!moved && !improvedStrictly && pass % 2 === 1) break;
  }

  restore(bestOrder);
}

/**
 * Weist die waagerechten Positionen zu — der Schritt, der Eltern über ihren
 * Kindern ausrichtet.
 *
 * Ohne ihn werden die Kästen je Generation nur von links nach rechts gepackt.
 * Dann trifft die senkrechte Linie ins Kind irgendwo auf, und weil sie
 * womöglich unter einem ganz anderen Kasten der Elterngeneration ankommt,
 * scheint das Kind zu diesem zu gehören — genau die irreführende Darstellung,
 * bei der Anne unter Norbert+Petra hing, obwohl sie Evas Tochter ist.
 *
 * Verfahren: abwechselnd von oben nach unten und zurück jeden Kasten an die
 * mittlere Position seiner Nachbarn ziehen, anschließend Überlappungen in
 * beiden Richtungen auflösen. Die Reihenfolge innerhalb einer Generation —
 * und damit die zuvor minimierte Zahl der Kreuzungen — bleibt dabei erhalten.
 */
function placeHorizontally(
  byGeneration: Map<number, Unit[]>,
  units: Unit[],
  segments: Segment[],
): void {
  const parentsOfUnit = new Map<string, Set<Unit>>();
  const childrenOfUnit = new Map<string, Set<Unit>>();
  const add = (m: Map<string, Set<Unit>>, k: string, v: Unit) => {
    const s = m.get(k);
    if (s) s.add(v);
    else m.set(k, new Set([v]));
  };

  for (const { upper, lower } of segments) {
    add(childrenOfUnit, upper.id, lower);
    add(parentsOfUnit, lower.id, upper);
  }

  const generations = [...byGeneration.keys()].sort((a, b) => a - b);
  const center = (u: Unit) => u.x + unitWidth(u) / 2;

  // Ausgangsverteilung: dicht gepackt.
  for (const g of generations) {
    let x = 0;
    for (const u of byGeneration.get(g)!) {
      u.x = x;
      x += unitWidth(u) + H_GAP;
    }
  }

  /**
   * Überlappungen auflösen, ohne die Reihenfolge zu ändern — und dabei jeden
   * Kasten so nah wie möglich an seiner Wunschposition lassen.
   *
   * Früher wurde erst nach rechts geschoben, dann nach links. Das ließ ganze
   * Gruppen bei jedem Durchlauf nach außen wandern, und der Baum wurde fast
   * doppelt so breit wie nötig. Jetzt: kleinste Quadrate unter der
   * Abstandsbedingung (Pool-Adjacent-Violators). Kästen, die sich ins Gehege
   * kommen, bilden einen Block, der mittig auf dem Durchschnitt ihrer Wünsche
   * sitzt — statt einseitig verdrängt zu werden.
   */
  const separate = (layer: Unit[]) => {
    if (layer.length < 2) return;
    // Mit dem Versatz durch die Breiten wird die Bedingung zu "monoton
    // steigend" — dafür ist PAV exakt und linear.
    const offset: number[] = [];
    let acc = 0;
    for (const u of layer) {
      offset.push(acc);
      acc += unitWidth(u) + H_GAP;
    }
    const blocks: { sum: number; count: number }[] = [];
    for (let i = 0; i < layer.length; i++) {
      blocks.push({ sum: layer[i].x - offset[i], count: 1 });
      while (blocks.length > 1) {
        const last = blocks[blocks.length - 1];
        const prev = blocks[blocks.length - 2];
        if (prev.sum / prev.count <= last.sum / last.count) break;
        prev.sum += last.sum;
        prev.count += last.count;
        blocks.pop();
      }
    }
    let i = 0;
    for (const b of blocks) {
      const value = b.sum / b.count;
      for (let k = 0; k < b.count; k++, i++) layer[i].x = value + offset[i];
    }
  };

  for (let sweep = 0; sweep < 16; sweep++) {
    const downward = sweep % 2 === 0;
    const sequence = downward ? generations : [...generations].reverse();

    for (const g of sequence) {
      const layer = byGeneration.get(g)!;
      const reference = downward ? parentsOfUnit : childrenOfUnit;

      for (const u of layer) {
        const neighbours = reference.get(u.id);
        if (!neighbours || neighbours.size === 0) continue;
        let sum = 0;
        for (const n of neighbours) sum += center(n);
        const desired = sum / neighbours.size;
        u.x = desired - unitWidth(u) / 2;
      }

      separate(layer);
    }
  }

  // Früher wurde hier zusätzlich jede Generation für sich mittig
  // ausgerichtet. Das verschob die Ebenen gegeneinander und machte die eben
  // hergestellte Ausrichtung Eltern-über-Kindern wieder zunichte; zugleich
  // entstanden so die breiten Leerräume am Rand jeder Ebene. Stattdessen nur
  // leere Spalten zusammenziehen.
  compactColumns(units);

  const minX = Math.min(...units.map((u) => u.x));
  for (const u of units) u.x -= minX;
}

/** Größte erlaubte Lücke zwischen zwei Spalten, die keine Ebene belegt. */
export const MAX_COLUMN_GAP = H_GAP * 3;

/**
 * Zieht senkrechte Streifen zusammen, in denen auf KEINER Ebene ein Kasten
 * steht. Alles rechts eines solchen Streifens rückt geschlossen nach links —
 * Reihenfolge, Ausrichtung zwischen den Ebenen und Abstände bleiben dadurch
 * erhalten, es entfällt nur leere Fläche (typisch zwischen nicht verbundenen
 * Familienzweigen oder neben einem einzelnen, weit ausgreifenden Zweig).
 */
function compactColumns(units: Unit[]): void {
  if (units.length === 0) return;
  const spans = units
    .map((u) => [u.x, u.x + unitWidth(u)] as const)
    .sort((a, b) => a[0] - b[0]);

  const shifts: { at: number; by: number }[] = [];
  let end = spans[0][1];
  for (const [start, stop] of spans) {
    if (start - end > MAX_COLUMN_GAP) {
      shifts.push({ at: start, by: start - end - MAX_COLUMN_GAP });
    }
    end = Math.max(end, stop);
  }
  if (shifts.length === 0) return;

  for (const u of units) {
    let by = 0;
    for (const s of shifts) if (u.x >= s.at) by += s.by;
    u.x -= by;
  }
}

export type GenerationsOptions = {
  mergeCouples?: boolean;
  /**
   * Fest vorgegebene Ebene je Person statt der Schätzung aus Abstammung und
   * Geburtsjahren — für die Fokus-Ansicht, deren Ebenen sich aus dem Abstand
   * zur Fokusperson ergeben. Personen ohne Eintrag landen auf Ebene 0.
   */
  generations?: Map<string, number>;
  /** Senkrechter Abstand zwischen zwei Kartenreihen (Standard: V_GAP). */
  rowGap?: number;
};

export function layoutGenerations(
  data: TreeData,
  options: GenerationsOptions = {},
): {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  junctions: ParentJunction[];
} {
  const idx = indexTree(data);
  const gen = options.generations
    ? normalizeGenerations(data, options.generations)
    : computeGenerations(data);
  const pitch = NODE_HEIGHT + (options.rowGap ?? V_GAP);
  const realUnits = buildUnits(data, gen, options.mergeCouples ?? true);

  const anchorOf = new Map<string, string>();
  const unitById = new Map<string, Unit>();
  for (const u of realUnits) {
    unitById.set(u.id, u);
    anchorOf.set(u.person!.id, u.id);
    if (u.partner) anchorOf.set(u.partner.id, u.id);
  }

  /**
   * Eltern-Kind-Beziehungen je Kastenpaar bündeln: erst wenn alle beteiligten
   * Personen bekannt sind, lässt sich bestimmen, an welcher Kartenhälfte die
   * Linie ansetzen muss.
   */
  type Pair = {
    source: Unit;
    target: Unit;
    from: Set<string>;
    to: Set<string>;
    via: Unit[];
  };
  const pairs = new Map<string, Pair>();

  for (const r of data.relationships) {
    if (r.type !== "PARENT_OF") continue;
    const source = unitById.get(anchorOf.get(r.fromPersonId) ?? "");
    const target = unitById.get(anchorOf.get(r.toPersonId) ?? "");
    if (!source || !target || source.id === target.id) continue;

    const key = `${source.id}->${target.id}`;
    let pair = pairs.get(key);
    if (!pair) {
      pair = { source, target, from: new Set(), to: new Set(), via: [] };
      pairs.set(key, pair);
    }
    pair.from.add(r.fromPersonId);
    pair.to.add(r.toPersonId);
  }

  // Platzhalter für Linien über mehrere Ebenen. Sie nehmen am Sortieren und
  // Positionieren teil wie echte Kästen und halten so einen freien Korridor.
  const units: Unit[] = [...realUnits];
  const segments: Segment[] = [];

  for (const pair of pairs.values()) {
    const from = pair.source.generation;
    const to = pair.target.generation;

    if (to - from <= 1) {
      segments.push({ upper: pair.source, lower: pair.target });
      continue;
    }

    let previous = pair.source;
    for (let g = from + 1; g < to; g++) {
      const dummy: Unit = {
        id: `via:${pair.source.id}->${pair.target.id}@${g}`,
        person: null,
        partner: null,
        generation: g,
        order: 0,
        x: 0,
        dummy: true,
      };
      units.push(dummy);
      pair.via.push(dummy);
      segments.push({ upper: previous, lower: dummy });
      previous = dummy;
    }
    segments.push({ upper: previous, lower: pair.target });
  }

  orderUnits(units, segments);

  const byGeneration = new Map<number, Unit[]>();
  for (const u of units) {
    const list = byGeneration.get(u.generation);
    if (list) list.push(u);
    else byGeneration.set(u.generation, [u]);
  }
  for (const layer of byGeneration.values()) {
    layer.sort((a, b) => a.order - b.order);
  }

  placeHorizontally(byGeneration, units, segments);

  // Spuren so vergeben, dass in derselben Generation benachbarte Eltern nie
  // dieselbe erwischen. Vier reichen: mehr Spuren als nebeneinanderliegende
  // Elternteile bringt nichts, und der Zwischenraum ist begrenzt.
  const laneOf = new Map<string, number>();
  for (const layer of byGeneration.values()) {
    layer.forEach((u, i) => laneOf.set(u.id, i % 4));
  }

  const marriageByPair = new Map<string, (typeof data.relationships)[number]>();
  for (const r of data.relationships) {
    if (r.type !== "PARTNER_OF") continue;
    const [a, b] =
      r.fromPersonId < r.toPersonId
        ? [r.fromPersonId, r.toPersonId]
        : [r.toPersonId, r.fromPersonId];
    marriageByPair.set(`${a}|${b}`, r);
  }

  // Platzhalter sind reine Layout-Hilfen und werden nicht gezeichnet.
  const nodes: LayoutNode[] = realUnits.map((u) => {
    const person = u.person!;
    let marriage: LayoutNode["marriage"] = null;
    if (u.partner) {
      const [a, b] =
        person.id < u.partner.id
          ? [person.id, u.partner.id]
          : [u.partner.id, person.id];
      const rel = marriageByPair.get(`${a}|${b}`);
      if (rel) {
        marriage = {
          relationshipId: rel.id,
          personId: rel.fromPersonId,
          date: rel.startDate,
          endDate: rel.endDate,
          datePrecision: rel.startDatePrecision,
          dateQualifier: rel.startDateQualifier,
          dateTo: rel.startDateTo ?? null,
          dateToPrecision: rel.startDateToPrecision,
          subtype: rel.subtype,
          primaryMediaId: rel.primaryMediaId,
        };
      }
    }

    return {
      person,
      partner: u.partner,
      x: u.x,
      y: u.generation * pitch,
      marriage,
      hasDescendants:
        (idx.childrenOf.get(person.id)?.length ?? 0) > 0 ||
        (u.partner ? (idx.childrenOf.get(u.partner.id)?.length ?? 0) > 0 : false),
    };
  });

  const edges: LayoutEdge[] = [];
  const seen = new Set<string>();

  /**
   * Auf welcher Karte des Kastens sitzen die beteiligten Personen? Bei einer
   * Doppelkarte muss die Linie an der richtigen Hälfte ansetzen — die Mitte
   * ist dort das Ehe-Verbindungsstück. Sind beide Partner beteiligt (ein Paar
   * als Eltern desselben Kindes), ist die Mitte dagegen genau richtig.
   */
  const sideIn = (unit: Unit, people: Set<string>) => {
    if (!unit.partner || !unit.person) return "center" as const;
    const self = people.has(unit.person.id);
    const other = people.has(unit.partner.id);
    if (self && other) return "center" as const;
    if (other) return "right" as const;
    return "left" as const;
  };

  for (const pair of pairs.values()) {
    edges.push({
      id: `parent:${pair.source.id}->${pair.target.id}`,
      sourceId: pair.source.id,
      targetId: pair.target.id,
      kind: "parent",
      // Spur aus der Position des Elternteils in seiner Generation: alle
      // Kinder eines Elternteils teilen sie, benachbarte Eltern nicht.
      lane: laneOf.get(pair.source.id) ?? 0,
      sourceSide: sideIn(pair.source, pair.from),
      targetSide: sideIn(pair.target, pair.to),
      // Korridor durch die übersprungenen Ebenen.
      waypoints: pair.via.map((v) => ({
        x: v.x + DUMMY_WIDTH / 2,
        y: v.generation * pitch + NODE_HEIGHT / 2,
      })),
    });
  }

  for (const r of data.relationships) {
    if (r.type === "PARENT_OF") continue;
    const source = anchorOf.get(r.fromPersonId);
    const target = anchorOf.get(r.toPersonId);
    if (!source || !target || source === target) continue;

    {
      const [a, b] = source < target ? [source, target] : [target, source];
      const id = `partner:${a}-${b}`;
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push({
        id,
        sourceId: a,
        targetId: b,
        kind: "partner",
        marriage: {
          relationshipId: r.id,
          personId: r.fromPersonId,
          date: r.startDate,
          endDate: r.endDate,
          datePrecision: r.startDatePrecision,
          dateQualifier: r.startDateQualifier,
          dateTo: r.startDateTo ?? null,
          dateToPrecision: r.startDateToPrecision,
          subtype: r.subtype,
          primaryMediaId: r.primaryMediaId,
        },
      });
    }
  }

  const junctions = buildJunctions(data, realUnits, anchorOf, pitch);

  // Kanten entfernen, die ein Treffpunkt ersetzt: sonst liefe zusätzlich zur
  // Gabelung noch je eine Einzellinie von jedem Elternteil zu jedem Kind.
  const superseded = new Set<string>();
  for (const j of junctions) {
    for (const parent of j.parentUnitIds) {
      for (const child of j.childUnitIds) {
        superseded.add(`parent:${parent}->${child}`);
      }
    }
  }

  return {
    nodes,
    edges: edges.filter((e) => !superseded.has(e.id)),
    junctions,
  };
}

/**
 * Elternpaare, die auf zwei getrennten Karten sitzen (im Zeitstrahl immer,
 * sonst bei Wiederheirat), bekommen einen Treffpunkt. Ohne ihn zöge jeder
 * Elternteil einzeln zu jedem Kind — bei zwei Eltern und zwei Kindern also
 * vier Linien statt einer Gabelung.
 */
function buildJunctions(
  data: TreeData,
  units: Unit[],
  anchorOf: Map<string, string>,
  pitch: number,
): ParentJunction[] {
  const unitById = new Map(units.map((u) => [u.id, u]));
  const unitX = (u: Unit) => u.x + unitWidth(u) / 2;

  // Kinder nach ihrem Elternpaar gruppieren.
  const parentsOf = new Map<string, string[]>();
  for (const r of data.relationships) {
    if (r.type !== "PARENT_OF") continue;
    const list = parentsOf.get(r.toPersonId);
    if (list) list.push(r.fromPersonId);
    else parentsOf.set(r.toPersonId, [r.fromPersonId]);
  }

  const groups = new Map<string, { parents: string[]; children: string[] }>();
  for (const [child, parents] of parentsOf) {
    if (parents.length < 2) continue;

    const unitIds = [...new Set(parents.map((p) => anchorOf.get(p)!))];
    // Sitzen beide Eltern auf derselben Doppelkarte, ist der Ehe-Marker
    // bereits der Treffpunkt — dann braucht es keinen zusätzlichen.
    if (unitIds.length < 2) continue;

    const key = [...parents].sort().join("|");
    const group = groups.get(key);
    if (group) group.children.push(child);
    else groups.set(key, { parents, children: [child] });
  }

  const junctions: ParentJunction[] = [];

  for (const [key, group] of groups) {
    const parentUnits = [
      ...new Set(group.parents.map((p) => anchorOf.get(p)!)),
    ]
      .map((id) => unitById.get(id))
      .filter((u): u is Unit => Boolean(u));
    const childUnits = [
      ...new Set(group.children.map((c) => anchorOf.get(c)!)),
    ]
      .map((id) => unitById.get(id))
      .filter((u): u is Unit => Boolean(u));

    if (parentUnits.length < 2 || childUnits.length === 0) continue;

    const lowestParent = Math.max(...parentUnits.map((u) => u.generation));
    const highestChild = Math.min(...childUnits.map((u) => u.generation));

    junctions.push({
      id: `junction:${key}`,
      x:
        parentUnits.reduce((sum, u) => sum + unitX(u), 0) / parentUnits.length,
      // Mittig zwischen der unteren Elternebene und der oberen Kindebene.
      y:
        (lowestParent * pitch + NODE_HEIGHT + highestChild * pitch) /
        2,
      parentUnitIds: parentUnits.map((u) => u.id),
      childUnitIds: childUnits.map((u) => u.id),
    });
  }

  return junctions;
}

// --- Zeitstrahl-Ansicht -----------------------------------------------------

// Höhe je Jahr. Großzügig, damit Personen ähnlichen Jahrgangs nicht auf
// derselben Höhe landen und sich in die Breite ausweichen müssen — der
// Zeitstrahl wird dadurch höher statt breiter, was beim Blättern angenehmer
// ist als ein weit auseinandergezogenes Bild.
const PX_PER_YEAR = 30;
const TIMELINE_TOP = 60;

const yearOf = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const y = new Date(iso).getFullYear();
  return Number.isFinite(y) ? y : null;
};

/**
 * Zeitliche Ansicht: die Höhe ergibt sich aus dem Jahr, nicht aus der
 * Generation. Die waagerechte Position wird aus der Generationenansicht
 * übernommen — so bleiben Familienstränge als Spalten beieinander, statt dass
 * Verwandte quer über die Fläche verstreut werden.
 *
 * Personen ohne Geburtsdatum haben auf einer Zeitachse keinen Platz; sie
 * kommen in ein eigenes Band unterhalb der Achse, statt stillschweigend bei
 * Jahr 0 zu landen.
 */
export function layoutTimeline(data: TreeData) {
  // Ohne Zusammenfassen der Ehepaare: auf einer Zeitachse bestimmt das
  // Geburtsjahr die Höhe, und eine gemeinsame Karte zwänge beide Partner auf
  // dieselbe — bei Norbert (*1962) und Petra (*1967) sichtbar falsch. Die Ehe
  // erscheint hier ohnehin als eigener Knoten an ihrem Datum.
  const base = layoutGenerations(data, { mergeCouples: false });
  const idx = indexTree(data);

  const years = data.persons
    .map((p) => yearOf(p.birthDate))
    .filter((y): y is number => y !== null);

  const marriageYears = data.relationships
    .filter((r) => r.type === "PARTNER_OF")
    .map((r) => yearOf(r.startDate))
    .filter((y): y is number => y !== null);

  const allYears = [...years, ...marriageYears];
  const minYear = allYears.length ? Math.min(...allYears) : 1900;
  const maxYear = allYears.length ? Math.max(...allYears) : 2000;

  /**
   * Jahre ohne Einträge zusammenstauchen.
   *
   * Eine gleichmäßige Skala verschwendet den Platz dort, wo nichts passiert:
   * zwischen einer Urgroßmutter und ihren Enkeln liegen leicht vierzig leere
   * Jahre, die den Zeitstrahl in die Länge ziehen, ohne etwas zu zeigen.
   * Belegte Jahre behalten ihre volle Höhe, leere schrumpfen auf einen
   * Bruchteil — die zeitliche Reihenfolge bleibt dabei erhalten, nur die
   * Abstände sind nicht mehr streng maßstabsgetreu.
   */
  const occupied = new Set([...years, ...marriageYears]);
  const EMPTY_YEAR = 3;
  // Ein Jahr gilt als belegt, wenn in seiner Nähe etwas liegt: sonst würde
  // ein Eintrag hart an der Grenze zwischen zwei gestauchten Bereichen kleben.
  const isNear = (year: number) => {
    for (let d = -2; d <= 2; d++) if (occupied.has(year + d)) return true;
    return false;
  };

  const offsets = new Map<number, number>();
  let cursor = TIMELINE_TOP;
  for (let year = minYear; year <= maxYear; year++) {
    offsets.set(year, cursor);
    cursor += isNear(year) ? PX_PER_YEAR : EMPTY_YEAR;
  }

  const toY = (year: number) =>
    offsets.get(year) ??
    (year < minYear ? TIMELINE_TOP : cursor);

  const undatedBandY = toY(maxYear) + NODE_HEIGHT + 140;

  const nodes: LayoutNode[] = [];
  const undated: LayoutNode[] = [];

  for (const node of base.nodes) {
    // Bei einer Doppelkarte bestimmt der frühere der beiden Geburtsjahrgänge
    // die Höhe — sonst säße das Paar willkürlich beim Erstgenannten.
    const own = yearOf(node.person.birthDate);
    const partner = node.partner ? yearOf(node.partner.birthDate) : null;
    const year =
      own !== null && partner !== null
        ? Math.min(own, partner)
        : (own ?? partner);

    if (year === null) {
      undated.push({ ...node, y: undatedBandY });
      continue;
    }
    nodes.push({ ...node, y: toY(year) });
  }

  // Undatierte nebeneinander in ihr Band legen.
  undated.forEach((node, i) => {
    nodes.push({ ...node, x: i * (NODE_WIDTH * 2 + H_GAP) });
  });

  /**
   * Waagerechte Anordnung für die Zeitachse neu bestimmen.
   *
   * Die Ausgangspositionen stammen aus der Generationenansicht, wo die Höhen
   * gleichmäßig verteilt sind. Hier bestimmt das Geburtsjahr die Höhe, und
   * dieselben x-Werte passen dann nicht mehr: Eltern und Kinder driften
   * auseinander (in einem Fall 440px), sodass sich der Baum diagonal über die
   * Fläche zieht.
   *
   * Deshalb abwechselnd: jeden Knoten zur Mitte seiner Verwandten ziehen, dann
   * Überschneidungen auflösen. Anders als in der Generationenansicht gibt es
   * hier keine Zeilen — überschneiden können sich alle Knoten, deren Höhen
   * nah beieinander liegen.
   */
  const boxWidth = (n: LayoutNode) =>
    NODE_WIDTH * (n.partner ? 2 : 1) + (n.partner ? CONNECTOR : 0);
  const centerOf = (n: LayoutNode) => n.x + boxWidth(n) / 2;

  const relatives = new Map<string, LayoutNode[]>();
  const addRelative = (a: string, b: LayoutNode) => {
    const list = relatives.get(a);
    if (list) list.push(b);
    else relatives.set(a, [b]);
  };
  const nodeOf = new Map(nodes.map((n) => [n.person.id, n]));

  for (const r of data.relationships) {
    const a = nodeOf.get(r.fromPersonId);
    const b = nodeOf.get(r.toPersonId);
    if (!a || !b || a === b) continue;
    addRelative(a.person.id, b);
    addRelative(b.person.id, a);
  }

  const overlaps = (a: LayoutNode, b: LayoutNode) =>
    Math.abs(a.y - b.y) < NODE_HEIGHT + 12;

  // Geschwistergruppen: Kinder mit derselben Elternmenge, nach Höhe sortiert
  // (auf der Zeitachse also nach Geburtsjahr).
  const groupsByParents = new Map<
    string,
    { parents: LayoutNode[]; children: LayoutNode[] }
  >();

  // Nach einzelnen Elternteilen gruppieren, nicht nach der exakten Elternmenge:
  // ist bei einem Kind nur ein Elternteil erfasst und beim Geschwister beides,
  // wären es sonst zwei Gruppen — und die beiden landeten übereinander.
  for (const r of data.relationships) {
    if (r.type !== "PARENT_OF") continue;
    const parent = nodeOf.get(r.fromPersonId);
    const child = nodeOf.get(r.toPersonId);
    if (!parent || !child) continue;

    const group = groupsByParents.get(r.fromPersonId);
    if (group) {
      if (!group.children.includes(child)) group.children.push(child);
    } else {
      groupsByParents.set(r.fromPersonId, {
        parents: [parent],
        children: [child],
      });
    }
  }

  const siblingGroups = [...groupsByParents.values()]
    .filter((g) => g.parents.length > 0)
    .map((g) => ({
      parents: g.parents,
      children: [...g.children].sort((a, b) => a.y - b.y),
    }));

  for (let pass = 0; pass < 24; pass++) {
    // Anziehen.
    for (const node of nodes) {
      const kin = relatives.get(node.person.id);
      if (!kin || kin.length === 0) continue;
      const target =
        kin.reduce((sum, other) => sum + centerOf(other), 0) / kin.length;
      // Nur zur Hälfte nachgeben, sonst schaukelt sich die Anordnung auf.
      node.x += (target - boxWidth(node) / 2 - node.x) * 0.5;
    }

    /**
     * Geschwister seitlich verteilen.
     *
     * Ohne das ziehen alle Kinder eines Elternpaares auf dieselbe Zielmitte
     * und stapeln sich in einer Spalte — sichtbar bei zwei Geschwistern, die
     * 8 Jahre trennen und die deshalb nicht kollidieren, aber exakt
     * untereinander landeten. Geschwister werden daher symmetrisch um
     * die Elternmitte gelegt, nach Geburtsjahr sortiert.
     */
    for (const group of siblingGroups) {
      if (group.children.length < 2) continue;

      const anchor =
        group.parents.reduce((sum, p) => sum + centerOf(p), 0) /
        group.parents.length;

      const widths = group.children.map(boxWidth);
      const total =
        widths.reduce((a, b) => a + b, 0) + H_GAP * (widths.length - 1);

      let cursor = anchor - total / 2;
      for (let i = 0; i < group.children.length; i++) {
        const child = group.children[i];
        const desired = cursor;
        cursor += widths[i] + H_GAP;
        child.x += (desired - child.x) * 0.5;
      }
    }

    // Auseinanderschieben.
    const byX = [...nodes].sort((a, b) => a.x - b.x);
    for (let i = 0; i < byX.length; i++) {
      for (let j = i + 1; j < byX.length; j++) {
        const left = byX[i];
        const right = byX[j];
        if (!overlaps(left, right)) continue;
        const min = left.x + boxWidth(left) + H_GAP;
        if (right.x < min) right.x = min;
      }
    }
  }

  /**
   * Unabhängige Familiengruppen zusammenschieben.
   *
   * Zwischen Gruppen, die keine gemeinsame Beziehung haben, wirkt keine
   * Anziehung — sie behalten die Abstände aus der Generationenansicht und
   * werden vom Auseinanderschieben zusätzlich getrennt. Beim Filtern auf
   * mehrere Familien klafft dadurch eine Lücke, die nichts aussagt. Die
   * Gruppen werden deshalb in ihrer bisherigen Reihenfolge dicht gepackt.
   */
  const componentOf = new Map<string, number>();
  {
    const neighbours = new Map<string, string[]>();
    for (const r of data.relationships) {
      (neighbours.get(r.fromPersonId) ??
        neighbours.set(r.fromPersonId, []).get(r.fromPersonId)!).push(
        r.toPersonId,
      );
      (neighbours.get(r.toPersonId) ??
        neighbours.set(r.toPersonId, []).get(r.toPersonId)!).push(
        r.fromPersonId,
      );
    }

    let current = 0;
    for (const node of nodes) {
      if (componentOf.has(node.person.id)) continue;
      const queue = [node.person.id];
      componentOf.set(node.person.id, current);
      while (queue.length > 0) {
        const id = queue.pop()!;
        for (const next of neighbours.get(id) ?? []) {
          if (componentOf.has(next)) continue;
          componentOf.set(next, current);
          queue.push(next);
        }
      }
      current++;
    }
  }

  const groups = new Map<number, LayoutNode[]>();
  for (const node of nodes) {
    const key = componentOf.get(node.person.id) ?? 0;
    const list = groups.get(key);
    if (list) list.push(node);
    else groups.set(key, [node]);
  }

  if (groups.size > 1) {
    const ordered = [...groups.values()].sort(
      (a, b) =>
        Math.min(...a.map((n) => n.x)) - Math.min(...b.map((n) => n.x)),
    );

    let offset = 0;
    for (const group of ordered) {
      const from = Math.min(...group.map((n) => n.x));
      const to = Math.max(...group.map((n) => n.x + boxWidth(n)));
      const shift = offset - from;
      for (const node of group) node.x += shift;
      offset += to - from + H_GAP * 2;
    }
  }

  // Hochzeiten als eigene Ereignisse einsortieren.
  const anchorX = new Map<string, number>();
  const anchorNode = new Map<string, string>();
  for (const node of nodes) {
    anchorX.set(node.person.id, node.x);
    anchorNode.set(node.person.id, node.person.id);
    if (node.partner) {
      anchorX.set(node.partner.id, node.x + NODE_WIDTH);
      anchorNode.set(node.partner.id, node.person.id);
    }
  }

  const events: MarriageEvent[] = [];
  for (const r of data.relationships) {
    if (r.type !== "PARTNER_OF" || !r.startDate) continue;
    const year = yearOf(r.startDate);
    if (year === null) continue;

    const ax = anchorX.get(r.fromPersonId);
    const bx = anchorX.get(r.toPersonId);
    if (ax === undefined || bx === undefined) continue;

    const a = idx.byId.get(r.fromPersonId);
    const b = idx.byId.get(r.toPersonId);

    events.push({
      id: `event:${r.id}`,
      relationshipId: r.id,
      date: r.startDate,
      datePrecision: r.startDatePrecision,
      dateQualifier: r.startDateQualifier,
      dateTo: r.startDateTo ?? null,
      dateToPrecision: r.startDateToPrecision,
      subtype: r.subtype,
      primaryMediaId: r.primaryMediaId,
      partnerAId: r.fromPersonId,
      partnerBId: r.toPersonId,
      anchorAId: anchorNode.get(r.fromPersonId)!,
      anchorBId: anchorNode.get(r.toPersonId)!,
      partnerNames: [a, b]
        .filter((p): p is TreePerson => Boolean(p))
        .map((p) => p.givenName)
        .join(" ♥ "),
    });
  }

  /**
   * Die Hochzeit steht auf ihrem Jahr zwischen den Partnern. Liegt dort schon
   * eine Personenkarte (oder eine andere Hochzeit), weicht sie auf die
   * nächste freie Stelle aus — sonst verdeckte der Marker die Karte (in den
   * Mock-Daten an rund 26 Stellen). Seitlich ausweichen ist billiger als
   * senkrecht: eine senkrechte Verschiebung verfälscht die Zeitachse.
   */
  const blockers = nodes.map((n) => ({ x: n.x, y: n.y, w: boxWidth(n), h: NODE_HEIGHT }));
  const eventBlocked = (x: number, y: number) =>
    blockers.some(
      (b) =>
        x < b.x + b.w + EVENT_GAP &&
        b.x < x + EVENT_BOX.width + EVENT_GAP &&
        y < b.y + b.h + EVENT_GAP &&
        b.y < y + EVENT_BOX.height + EVENT_GAP,
    );
  /** Kosten je Pixel Abweichung: senkrecht (Zeit) viermal so teuer wie seitlich. */
  const VERTICAL_COST = 4;
  const eventPositions = new Map<string, { x: number; y: number }>();
  for (const ev of events) {
    const ax = anchorX.get(ev.partnerAId)!;
    const bx = anchorX.get(ev.partnerBId)!;
    const wantedX = (ax + bx) / 2;
    const wantedY = toY(yearOf(ev.date)!);
    let best = { x: wantedX, y: wantedY };
    if (eventBlocked(wantedX, wantedY)) {
      const xs = [wantedX];
      const ys = [wantedY];
      for (const b of blockers) {
        xs.push(b.x + b.w + EVENT_GAP, b.x - EVENT_BOX.width - EVENT_GAP);
        ys.push(b.y + b.h + EVENT_GAP, b.y - EVENT_BOX.height - EVENT_GAP);
      }
      let bestCost = Infinity;
      for (const x of xs) {
        for (const y of x === wantedX ? ys : [wantedY]) {
          const cost = Math.abs(x - wantedX) + VERTICAL_COST * Math.abs(y - wantedY);
          // Gleichstand: der Reihe nach (deterministisch) der erste.
          if (cost < bestCost && !eventBlocked(x, y)) {
            bestCost = cost;
            best = { x, y };
          }
        }
      }
    }
    eventPositions.set(ev.id, best);
    blockers.push({ x: best.x, y: best.y, w: EVENT_BOX.width, h: EVENT_BOX.height });
  }

  const axis = {
    minYear,
    maxYear,
    toY,
    ticks: [] as { year: number; y: number }[],
    undatedY: undated.length > 0 ? undatedBandY : null,
  };

  // Beschriftung alle 10 Jahre, auf glatte Jahrzehnte gerundet.
  for (let y = Math.floor(minYear / 10) * 10; y <= maxYear + 10; y += 10) {
    if (y < minYear - 10) continue;
    axis.ticks.push({ year: y, y: toY(y) });
  }

  /**
   * Korridore auf die Zeitachse umrechnen. Ihre Höhen stammen aus der
   * Generationenansicht; hier bestimmt aber das Geburtsjahr die Position, und
   * eine unveränderte Höhe zeigt ins Leere — die Linie liefe quer durch fremde
   * Karten statt zwischen ihnen hindurch. Die waagerechte Lage des Korridors
   * bleibt, die Höhe wird zwischen Quelle und Ziel verteilt.
   */
  const nodeY = new Map<string, number>();
  const nodeX = new Map<string, number>();
  for (const n of nodes) {
    nodeY.set(n.person.id, n.y);
    nodeX.set(n.person.id, n.x + NODE_WIDTH / 2);
  }

  const edges = base.edges.map((e) => {
    if (!e.waypoints?.length) return e;

    const sy = nodeY.get(e.sourceId);
    const ty = nodeY.get(e.targetId);
    if (sy === undefined || ty === undefined) return { ...e, waypoints: [] };

    const from = sy + NODE_HEIGHT;
    const span = ty - from;
    const count = e.waypoints.length;

    return {
      ...e,
      waypoints: e.waypoints.map((w, i) => ({
        x: w.x,
        y: from + (span * (i + 1)) / (count + 1),
      })),
    };
  });

  // Treffpunkte auf die Zeitachse umrechnen: mittig zwischen dem unteren
  // Elternteil und dem oberen Kind, in echten Zeitkoordinaten.
  const junctions = base.junctions
    .map((j) => {
      const parentY = j.parentUnitIds
        .map((id) => nodeY.get(id))
        .filter((y): y is number => y !== undefined);
      const childY = j.childUnitIds
        .map((id) => nodeY.get(id))
        .filter((y): y is number => y !== undefined);
      if (parentY.length === 0 || childY.length === 0) return null;

      const parentX = j.parentUnitIds
        .map((id) => nodeX.get(id))
        .filter((x): x is number => x !== undefined);

      return {
        ...j,
        x: parentX.length
          ? parentX.reduce((a, b) => a + b, 0) / parentX.length
          : j.x,
        y: (Math.max(...parentY) + NODE_HEIGHT + Math.min(...childY)) / 2,
      };
    })
    .filter((j): j is ParentJunction => j !== null);

  return { nodes, edges, events, eventPositions, axis, junctions };
}

