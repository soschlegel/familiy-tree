"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type MouseEvent,
} from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
} from "reactflow";

import { useDismiss } from "./useDismiss";
import {
  FocusIcon,
  LockIcon,
  OpenIcon,
  PersonNode,
  TreeNavContext,
  type HiddenKin,
  type PersonNodeData,
  type TreeNav,
} from "./PersonNode";
import {
  MarriageNode,
  JunctionNode,
  type MarriageNodeData,
} from "./MarriageNode";
import { MarriageEdge } from "./MarriageEdge";
import { ParentEdge, PARENT_EDGE_STYLE, type ParentSubtype } from "./ParentEdge";
import {
  displayName,
  lifeSpan,
  NODE_HEIGHT,
  NODE_WIDTH,
  type LayoutNode,
  type TreeData,
  type TreePerson,
} from "@/lib/tree-layout";
import { layoutGenerations, layoutTimeline } from "@/lib/layout-generations";
import {
  FOCUS_COOKIE,
  FOCUS_DEPTH,
  layoutFocus,
  type FocusTreeData,
  type TreeView,
} from "@/lib/focus-tree";

// Außerhalb der Komponente: React Flow warnt (und rendert neu), wenn sich die
// Objekte bei jedem Render ändern.
const nodeTypes = {
  person: PersonNode,
  marriage: MarriageNode,
  junction: JunctionNode,
};

const edgeTypes = { marriage: MarriageEdge, parent: ParentEdge };

type WholeMode = "generations" | "timeline";

/** Unterhalb dieser Zoomstufe sind Namen nicht mehr lesbar. */
const READABLE_ZOOM = 0.8;
const FOCUS_ZOOM = 0.9;
/** Fokus-Ansicht: kleinste Zoomstufe, bei der der ganze Ausschnitt eingepasst wird. */
const FOCUS_MIN_FIT = 0.55;
/** Dauer des Übergangs beim Wechsel der Fokusperson. */
const TWEEN_MS = 380;
const CONNECTOR = 56;

/** Anschluss an der richtigen Kartenhälfte, sonst am Kasten selbst. */
const handleFor = (base: string, side?: "left" | "right" | "center") =>
  side === "left" || side === "right" ? `${base}-${side}` : base;

const unitWidth = (n: { partner: unknown }) => (n.partner ? NODE_WIDTH * 2 + CONNECTOR : NODE_WIDTH);

/** URL der Baumseite; Standardwerte bleiben weg, damit Links kurz bleiben. */
export function treeUrl({
  view = "focus",
  focus,
  up = FOCUS_DEPTH.up,
  down = FOCUS_DEPTH.down,
}: {
  view?: TreeView;
  focus?: string | null;
  up?: number;
  down?: number;
}): string {
  const s = new URLSearchParams();
  if (view !== "focus") s.set("view", view);
  if (focus) s.set("focus", focus);
  if (view === "focus") {
    if (up !== FOCUS_DEPTH.up) s.set("up", String(up));
    if (down !== FOCUS_DEPTH.down) s.set("down", String(down));
  }
  const query = s.toString();
  return query ? `/tree?${query}` : "/tree";
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/**
 * Zuletzt fokussierte Personen. Bewusst nur im Speicher der laufenden Sitzung
 * (Modulvariable): überlebt das Hin- und Herschalten zwischen den Ansichten,
 * landet aber in keinem dauerhaften Speicher, in dem ein späterer Benutzer
 * desselben Browsers Namen fremder Familien fände.
 */
let recentFocus: { id: string; name: string }[] = [];

/**
 * Art der Abstammung, die eine gezeichnete Linie darstellt. Eine Linie kann
 * mehrere Beziehungen bündeln (Doppelkarte, Treffpunkt): ist eine davon
 * leiblich, gilt die Linie als leiblich — nur rein soziale Elternschaft wird
 * hervorgehoben.
 */
function lineSubtype(
  parents: string[],
  children: string[],
  subtypeByPair: Map<string, string>,
): ParentSubtype {
  const found: string[] = [];
  for (const p of parents) {
    for (const c of children) {
      const s = subtypeByPair.get(`${p}>${c}`);
      if (s) found.push(s);
    }
  }
  if (found.length === 0 || found.includes("BIOLOGICAL")) return "BIOLOGICAL";
  return (found[0] as ParentSubtype) ?? "BIOLOGICAL";
}

type Layout = ReturnType<typeof layoutGenerations> & {
  timeline: ReturnType<typeof layoutTimeline> | null;
  /** Fokus-Ansicht: an der vorigen Position der Fokusperson ausgerichtet. */
  anchored?: boolean;
};

/** Weltposition jeder Person (bei Doppelkarten die jeweilige Hälfte). */
function personPositions(nodes: LayoutNode[]) {
  const m = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    m.set(n.person.id, { x: n.x, y: n.y });
    if (n.partner) m.set(n.partner.id, { x: n.x + NODE_WIDTH + CONNECTOR, y: n.y });
  }
  return m;
}

function shiftLayout(layout: Layout, dx: number, dy: number): Layout {
  if (dx === 0 && dy === 0) return { ...layout, anchored: true };
  return {
    ...layout,
    anchored: true,
    nodes: layout.nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })),
    junctions: layout.junctions.map((j) => ({ ...j, x: j.x + dx, y: j.y + dy })),
    edges: layout.edges.map((e) =>
      e.waypoints?.length
        ? { ...e, waypoints: e.waypoints.map((w) => ({ x: w.x + dx, y: w.y + dy })) }
        : e,
    ),
  };
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

type Hit = { person: TreePerson; nodeId: string | null };

export function FamilyTree(props: {
  data: TreeData | FocusTreeData;
  view: TreeView;
  families?: { id: string; name: string }[];
  focusId?: string;
}) {
  return (
    <ReactFlowProvider>
      <TreeCanvas {...props} />
    </ReactFlowProvider>
  );
}

function TreeCanvas({
  data,
  view,
  families = [],
  focusId,
}: {
  data: TreeData | FocusTreeData;
  view: TreeView;
  families?: { id: string; name: string }[];
  focusId?: string;
}) {
  const focusData = view === "focus" && "members" in data ? data : null;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<WholeMode>(view === "timeline" ? "timeline" : "generations");
  const [selectedFamilies, setSelectedFamilies] = useState<string[]>([]);
  const [showMarriages, setShowMarriages] = useState(true);
  const [familyMenuOpen, setFamilyMenuOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [focused, setFocused] = useState<string | null>(focusId ?? null);
  const dark = useMediaQuery("(prefers-color-scheme: dark)");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const flow = useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);
  const familyMenuRef = useRef<HTMLDivElement>(null);
  const familyTriggerRef = useRef<HTMLButtonElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  // Legende auf breiten Bildschirmen gleich offen, auf dem Telefon nicht —
  // dort nähme sie zu viel Fläche weg. In der Fokus-Ansicht zunächst zu: dort
  // ist der Ausschnitt eingepasst, und sie verdeckte seine linke untere Ecke.
  useEffect(() => {
    setLegendOpen(view !== "focus" && window.matchMedia("(min-width: 768px)").matches);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const up = focusData?.up ?? FOCUS_DEPTH.up;
  const down = focusData?.down ?? FOCUS_DEPTH.down;
  const currentFocus = focusData?.focusId ?? null;

  const navigate = useCallback(
    (url: string, replace = false) => {
      startTransition(() => {
        if (replace) router.replace(url, { scroll: false });
        else router.push(url, { scroll: false });
      });
    },
    [router],
  );

  const focusHref = useCallback((id: string) => treeUrl({ focus: id, up, down }), [up, down]);

  /** Fokus-Verweise selbst ausführen — mit Übergang statt harter Navigation. */
  const onFocusClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>, id: string) => {
      // Mittelklick, Strg-Klick usw. bleiben beim Browser (neuer Tab).
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      if (id === currentFocus) return;
      navigate(focusHref(id));
    },
    [navigate, focusHref, currentFocus],
  );

  const nav = useMemo<TreeNav>(
    () => ({ mode: focusData ? "focus" : "full", focusId: currentFocus, focusHref, onFocusClick }),
    [focusData, currentFocus, focusHref, onFocusClick],
  );

  // Fokus-Ansicht: Person merken (Einstieg beim nächsten Öffnen), Adresse
  // vervollständigen, wenn der Server die Person selbst gewählt hat — sonst
  // führte „Zurück“ später auf eine andere Person —, und den Verlauf führen.
  const [recent, setRecent] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!focusData) return;
    const id = focusData.focusId;
    try {
      document.cookie = `${FOCUS_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    } catch {
      // ohne Cookie beginnt die Ansicht beim nächsten Mal bei der Startperson
    }
    const url = new URL(window.location.href);
    if (url.searchParams.get("focus") !== id) {
      window.history.replaceState(null, "", treeUrl({ focus: id, up: focusData.up, down: focusData.down }));
    }
    const person = focusData.persons.find((p) => p.id === id);
    if (person) {
      recentFocus = [{ id, name: displayName(person) }, ...recentFocus.filter((r) => r.id !== id)].slice(0, 6);
    }
    setRecent(recentFocus);
  }, [focusData]);

  /**
   * Filter auf ausgewählte Familien. Beziehungen bleiben nur, wenn beide
   * Seiten übrig sind — eine Kante ins Nichts würde sonst auf eine
   * ausgeblendete Person zeigen und das Layout zerreißen.
   */
  const filtered = useMemo(() => {
    if (focusData) return data;
    const byFamily =
      selectedFamilies.length === 0
        ? data
        : (() => {
            const keep = new Set(
              data.persons
                .filter((p) =>
                  p.familyIds?.some((id) => selectedFamilies.includes(id)),
                )
                .map((p) => p.id),
            );
            return {
              persons: data.persons.filter((p) => keep.has(p.id)),
              relationships: data.relationships.filter(
                (r) => keep.has(r.fromPersonId) && keep.has(r.toPersonId),
              ),
            };
          })();

    if (showMarriages) return byFamily;

    // Ohne Ehen bleibt die reine Abstammung übrig. Das ändert auch das
    // Layout: Paare werden nicht mehr zusammengefasst, und Generationen
    // richten sich allein nach der Abstammung.
    return {
      persons: byFamily.persons,
      relationships: byFamily.relationships.filter(
        (r) => r.type !== "PARTNER_OF",
      ),
    };
  }, [data, focusData, selectedFamilies, showMarriages]);

  // Das Layout ist der teure Teil. Es hängt nur von Daten, Filter und Ansicht
  // ab — die Suche ändert lediglich die Hervorhebung und darf es nicht neu
  // berechnen lassen.
  const layout = useMemo((): Layout => {
    if (focusData) return { ...layoutFocus(focusData, { showMarriages }), timeline: null };
    if (mode === "timeline") {
      const timeline = layoutTimeline(filtered);
      return { ...timeline, timeline };
    }
    return { ...layoutGenerations(filtered), timeline: null };
  }, [focusData, filtered, mode, showMarriages]);

  /**
   * Fokus-Ansicht: den neuen Ausschnitt so verschieben, dass die neue
   * Fokusperson genau dort steht, wo sie im alten Ausschnitt stand. Ohne das
   * spränge das Bild bei jedem Klick, weil das Layout jedes Ausschnitts bei
   * null beginnt; so bleibt die angeklickte Karte stehen, die übrigen gleiten
   * an ihren neuen Platz, und erst dann rückt der Ausschnitt in die Mitte.
   */
  const lastPersonPos = useRef(new Map<string, { x: number; y: number }>());
  const lastNodePos = useRef(new Map<string, { x: number; y: number }>());
  const display = useMemo((): Layout => {
    if (!focusData) return layout;
    const before = lastPersonPos.current.get(focusData.focusId);
    const now = personPositions(layout.nodes).get(focusData.focusId);
    if (!before || !now) return layout;
    return shiftLayout(layout, before.x - now.x, before.y - now.y);
  }, [layout, focusData]);

  // Übergang: Karten, die schon zu sehen waren, gleiten von ihrer alten an
  // die neue Position; neue blenden ein.
  const tweenFrom = useMemo(() => {
    if (!display.anchored || reducedMotion || lastNodePos.current.size === 0) return null;
    return new Map(lastNodePos.current);
  }, [display, reducedMotion]);
  const [progress, setProgress] = useState(1);
  const [tweenFor, setTweenFor] = useState<Layout | null>(null);
  if (tweenFrom && tweenFor !== display) {
    setTweenFor(display);
    setProgress(0);
  }
  useEffect(() => {
    if (!tweenFrom) return;
    let raf = 0;
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / TWEEN_MS);
      setProgress(p);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      setProgress(1);
    };
  }, [tweenFrom]);

  useEffect(() => {
    lastPersonPos.current = personPositions(display.nodes);
    const nodePos = new Map<string, { x: number; y: number }>();
    for (const n of display.nodes) nodePos.set(n.person.id, { x: n.x, y: n.y });
    for (const j of display.junctions) nodePos.set(j.id, { x: j.x, y: j.y });
    lastNodePos.current = nodePos;
  }, [display]);

  /**
   * Verschieben nur bis kurz hinter den Rand des Baums — sonst ließ sich der
   * Baum beliebig weit ins Leere schieben und war dann schwer wiederzufinden.
   */
  const translateExtent = useMemo((): [[number, number], [number, number]] => {
    const MARGIN = 600;
    if (display.nodes.length === 0) return [[-Infinity, -Infinity], [Infinity, Infinity]];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of display.nodes) {
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + unitWidth(n));
      y1 = Math.max(y1, n.y + NODE_HEIGHT);
    }
    for (const p of display.timeline?.eventPositions.values() ?? []) {
      y1 = Math.max(y1, p.y + 80);
    }
    return [[x0 - MARGIN, y0 - MARGIN], [x1 + MARGIN, y1 + MARGIN]];
  }, [display]);

  /** Personen je Knoten (bei Doppelkarten zwei). */
  const membersOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const n of display.nodes) {
      m.set(n.person.id, n.partner ? [n.person.id, n.partner.id] : [n.person.id]);
    }
    return m;
  }, [display]);

  const subtypeByPair = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of filtered.relationships) {
      if (r.type === "PARENT_OF") m.set(`${r.fromPersonId}>${r.toPersonId}`, r.subtype);
    }
    return m;
  }, [filtered]);

  // Zurückgestellt: das Eingabefeld reagiert sofort, die Hervorhebung im
  // Baum folgt, sobald Zeit ist.
  const deferredQuery = useDeferredValue(query);
  const needle = deferredQuery.trim().toLowerCase();

  /** Suchtreffer im Gesamtbaum: Person und Knoten, in dem sie gezeichnet ist. */
  const localHits = useMemo(() => {
    if (!needle || focusData) return [];
    const words = needle.split(/\s+/);
    const result: Hit[] = [];
    for (const n of display.nodes) {
      for (const p of n.partner ? [n.person, n.partner] : [n.person]) {
        if (p.restricted) continue;
        const name = displayName(p).toLowerCase();
        if (words.every((w) => name.includes(w))) result.push({ person: p, nodeId: n.person.id });
      }
    }
    return result.sort((a, b) =>
      displayName(a.person).localeCompare(displayName(b.person), "de"),
    );
  }, [display, needle, focusData]);

  /**
   * Suche in der Fokus-Ansicht: der Browser kennt nur den Ausschnitt, also
   * fragt die Suche den Server (nur sichtbare Personen). Ein Treffer rückt in
   * den Fokus.
   */
  const [remote, setRemote] = useState<{ q: string; hits: Hit[] } | null>(null);
  useEffect(() => {
    if (!focusData || !needle) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/persons?q=${encodeURIComponent(needle)}&limit=8`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const items = (await res.json()) as (TreePerson & { restricted: false })[];
        setRemote({ q: needle, hits: items.map((p) => ({ person: p, nodeId: null })) });
      } catch {
        // abgebrochen oder offline — die Liste bleibt leer
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [needle, focusData]);

  const hits = useMemo(
    () => (focusData ? (remote?.q === needle ? remote.hits : []) : localHits),
    [focusData, remote, needle, localHits],
  );
  const searchLoading = Boolean(focusData && needle && remote?.q !== needle);

  useEffect(() => setCursor(0), [needle]);

  // In der Fokus-Ansicht hebt die Suche nichts im Ausschnitt hervor — sie
  // durchsucht den ganzen Bestand und springt.
  const searching = !focusData && needle.length > 0;

  /**
   * Kanten hängen nur vom Layout und davon ab, OB gesucht wird — nicht vom
   * Suchtext. Weitere Tastendrücke erzeugen deshalb keine neuen Kanten, und
   * React Flow muss sie nicht neu zeichnen.
   */
  const edges = useMemo(() => {
    const dimAll = searching;
    const members = (id: string) => membersOf.get(id) ?? [id];

    const rfEdges: Edge[] = display.edges.map((e) =>
      e.kind === "partner"
        ? {
            id: e.id,
            source: e.sourceId,
            target: e.targetId,
            sourceHandle: "marriage-source",
            targetHandle: "marriage-target",
            type: "marriage",
            data: { ...e.marriage, dimmed: dimAll },
          }
        : {
            id: e.id,
            source: e.sourceId,
            target: e.targetId,
            sourceHandle: handleFor("children-source", e.sourceSide),
            targetHandle: handleFor("parents-target", e.targetSide),
            type: "parent",
            data: {
              variant: "parent",
              lane: e.lane ?? 0,
              waypoints: e.waypoints,
              dimmed: dimAll,
              subtype: lineSubtype(members(e.sourceId), members(e.targetId), subtypeByPair),
            },
          },
    );

    // Treffpunkte: laufen beide Elternlinien dort zusammen, ersetzen sie die
    // Einzelverbindungen — sonst zöge jeder Elternteil separat zu jedem Kind.
    const junctionEdges: Edge[] = [];
    for (const j of display.junctions) {
      const allParents = j.parentUnitIds.flatMap(members);
      const allChildren = j.childUnitIds.flatMap(members);

      for (const parent of j.parentUnitIds) {
        junctionEdges.push({
          id: `${j.id}:in:${parent}`,
          source: parent,
          target: j.id,
          sourceHandle: "children-source",
          type: "parent",
          data: {
            variant: "parent",
            lane: 0,
            dimmed: dimAll,
            subtype: lineSubtype(members(parent), allChildren, subtypeByPair),
          },
        });
      }
      for (const child of j.childUnitIds) {
        junctionEdges.push({
          id: `${j.id}:out:${child}`,
          source: j.id,
          target: child,
          targetHandle: "parents-target",
          type: "parent",
          data: {
            variant: "parent",
            lane: 0,
            dimmed: dimAll,
            subtype: lineSubtype(allParents, members(child), subtypeByPair),
          },
        });
      }
    }

    const withJunctions = [...rfEdges, ...junctionEdges];
    const timeline = display.timeline;
    if (!timeline) return withJunctions;

    // Die Hochzeit liegt auf ihrem eigenen Datum, also unterhalb der Partner.
    // Deren Ehe-Kante würde sonst waagerecht daran vorbeilaufen und das
    // Ereignis stünde unverbunden im Raum. Darum hier: direkte Ehe-Kante
    // entfernen und stattdessen beide Partner mit dem Ereignis verbinden.
    const marriedPairs = new Set<string>();
    const eventEdges: Edge[] = [];
    for (const ev of timeline.events) {
      const { anchorAId: a, anchorBId: b } = ev;
      if (a !== b) {
        const [x, y] = a < b ? [a, b] : [b, a];
        marriedPairs.add(`partner:${x}-${y}`);
      }
      // Bei einem absorbierten Paar (eine Doppelkarte) genügt eine Verbindung.
      for (const anchor of a === b ? [a] : [a, b]) {
        eventEdges.push({
          id: `${ev.id}:${anchor}`,
          source: anchor,
          target: ev.id,
          // Aus der Mitte des Paares heraus, nicht seitlich an einem Partner.
          sourceHandle: "children-source",
          type: "parent",
          data: { variant: "event", dimmed: dimAll },
        });
      }
    }
    return [...withJunctions.filter((e) => !marriedPairs.has(e.id)), ...eventEdges];
  }, [display, searching, membersOf, subtypeByPair]);

  /** Fokus-Ansicht: was je Person jenseits des Ausschnitts liegt. */
  const hiddenOf = useCallback(
    (n: LayoutNode): Record<string, HiddenKin> | undefined => {
      if (!focusData) return undefined;
      const out: Record<string, HiddenKin> = {};
      for (const p of n.partner ? [n.person, n.partner] : [n.person]) {
        const m = focusData.members[p.id];
        if (m && !p.restricted && (m.hiddenParents > 0 || m.hiddenChildren > 0)) {
          out[p.id] = { parents: m.hiddenParents, children: m.hiddenChildren };
        }
      }
      return out;
    },
    [focusData],
  );

  /**
   * Knoten-Objekte wiederverwenden, solange sich ihr Zustand nicht ändert.
   * React Flow vergleicht Knoten über ihre Identität: ein neues Objekt heißt
   * neu zeichnen. Ohne diesen Zwischenspeicher wurden bei jedem Tastendruck
   * alle ~120 Karten samt Bildern neu gerendert.
   */
  const nodeCache = useRef<{ layout: unknown; byKey: Map<string, Node> }>({
    layout: null,
    byKey: new Map(),
  });

  const nodes = useMemo(() => {
    if (nodeCache.current.layout !== display) {
      nodeCache.current = { layout: display, byKey: new Map() };
    }
    const cache = nodeCache.current.byKey;
    const hitIds = new Set(hits.map((h) => h.person.id));

    // Während des Übergangs: Zwischenpositionen, kein Zwischenspeicher.
    const tweening = tweenFrom !== null && progress < 1;
    const k = ease(progress);
    const place = (id: string, x: number, y: number) => {
      const from = tweening ? tweenFrom.get(id) : undefined;
      return from ? { x: from.x + (x - from.x) * k, y: from.y + (y - from.y) * k } : { x, y };
    };
    const fadeIn = (id: string) =>
      tweening && !tweenFrom.has(id) ? { opacity: k } : undefined;

    const cached = (key: string, build: () => Node) => {
      if (tweening) return build();
      const hit = cache.get(key);
      if (hit) return hit;
      const node = build();
      cache.set(key, node);
      return node;
    };

    const personNodes = display.nodes.map((n) => {
      const hit = hitIds.has(n.person.id) || (n.partner ? hitIds.has(n.partner.id) : false);
      const isFocused =
        !focusData && (focused === n.person.id || (n.partner ? focused === n.partner.id : false));
      const highlighted = hit || isFocused;
      // Bei aktiver Suche alles Übrige zurücknehmen, statt nur den Treffer
      // hervorzuheben — in einem dichten Baum geht sonst beides unter.
      const dimmed = searching && !hit;
      return cached(
        `${n.person.id}|${highlighted ? 1 : 0}${dimmed ? 1 : 0}`,
        (): Node<PersonNodeData> => ({
          id: n.person.id,
          type: "person",
          position: place(n.person.id, n.x, n.y),
          data: {
            person: n.person,
            partner: n.partner,
            marriage: n.marriage,
            hasDescendants: n.hasDescendants,
            highlighted,
            dimmed,
            hidden: hiddenOf(n),
          },
          draggable: false,
          style: { height: NODE_HEIGHT, ...fadeIn(n.person.id) },
        }),
      );
    });

    const junctionNodes = display.junctions.map((j) =>
      cached(`${j.id}|${searching ? 1 : 0}`, () => ({
        id: j.id,
        type: "junction",
        position: place(j.id, j.x, j.y),
        data: { dimmed: searching },
        draggable: false,
        selectable: false,
        focusable: false,
        style: fadeIn(j.id),
      })),
    );

    const timeline = display.timeline;
    if (!timeline) return [...personNodes, ...junctionNodes];

    // Zeitstrahl: Hochzeiten als eigene Ereignisknoten.
    const eventNodes = timeline.events.map((ev) => {
      const dimmed = searching && !hitIds.has(ev.partnerAId) && !hitIds.has(ev.partnerBId);
      return cached(`${ev.id}|${dimmed ? 1 : 0}`, (): Node<MarriageNodeData> => ({
        id: ev.id,
        type: "marriage",
        position: timeline.eventPositions.get(ev.id)!,
        data: {
          date: ev.date,
          datePrecision: ev.datePrecision,
          dateQualifier: ev.dateQualifier,
          dateTo: ev.dateTo ?? null,
          dateToPrecision: ev.dateToPrecision,
          subtype: ev.subtype,
          primaryMediaId: ev.primaryMediaId,
          partnerNames: ev.partnerNames,
          dimmed,
        },
        draggable: false,
        selectable: false,
        focusable: false,
      }));
    });

    return [...personNodes, ...junctionNodes, ...eventNodes];
  }, [display, hits, searching, focused, focusData, hiddenOf, tweenFrom, progress]);

  /**
   * Ausschnitte werden aus den Layoutdaten berechnet, nicht aus den von React
   * Flow vermessenen Knoten: direkt nach einem Filter- oder Ansichtswechsel
   * sind die neuen Knoten noch nicht vermessen, und fitView täte dann gar
   * nichts — der Ausschnitt blieb auf leerer Fläche stehen.
   */

  /** Mitte einer Person; bei Doppelkarten die richtige Hälfte. */
  const centerOf = useCallback(
    (personId: string) => {
      const node = display.nodes.find((n) => n.person.id === personId || n.partner?.id === personId);
      if (!node) return null;
      const share = !node.partner ? 0.5 : node.partner.id === personId ? 0.78 : 0.22;
      return { x: node.x + unitWidth(node) * share, y: node.y + NODE_HEIGHT / 2 };
    },
    [display],
  );

  /** Auf eine Person zentrieren. */
  const centerOn = useCallback(
    (personId: string, zoom = FOCUS_ZOOM, duration = 400) => {
      const c = centerOf(personId);
      if (!c) return false;
      flow.setCenter(c.x, c.y, { zoom, duration });
      return true;
    },
    [flow, centerOf],
  );

  /** Ganzen Inhalt einpassen (Weltkoordinaten), höchstens Zoomstufe 1. */
  const fitBox = useCallback(
    (duration = 0) => {
      const el = containerRef.current;
      if (!el) return null;
      const [[x0, y0], [x1, y1]] = translateExtent;
      const MARGIN = 600; // siehe translateExtent
      const bw = x1 - x0 - 2 * MARGIN;
      const bh = y1 - y0 - 2 * MARGIN;
      const W = el.clientWidth;
      const H = el.clientHeight;
      const fit = Math.min(1, (W * 0.92) / bw, (H * 0.88) / bh);
      return {
        fit,
        box: { x: x0 + MARGIN, y: y0 + MARGIN, w: bw, h: bh, W, H },
        apply: () =>
          flow.setViewport(
            {
              x: W / 2 - (x0 + MARGIN + bw / 2) * fit,
              y: H / 2 - (y0 + MARGIN + bh / 2) * fit,
              zoom: fit,
            },
            { duration },
          ),
      };
    },
    [translateExtent, flow],
  );

  /**
   * Fokus-Ansicht: passt der ganze Ausschnitt lesbar ins Bild, wird er
   * eingepasst. Sonst (Telefon, große Familie) bleibt die Zoomstufe lesbar,
   * und je Richtung gilt: passt der Ausschnitt in dieser Richtung hinein, wird
   * er mittig gesetzt, sonst steht die Fokusperson in der Mitte — so bleibt
   * über einem Stammvater ohne Vorfahren keine leere Fläche stehen.
   */
  const focusView = useCallback(
    (duration = 0) => {
      if (!focusData) return;
      const fitted = fitBox(duration);
      const c = centerOf(focusData.focusId);
      if (!fitted || !c) return;
      // Platz für die Verlaufsleiste oben.
      const TOP = 44;
      const { box } = fitted;
      const zoom = fitted.fit >= FOCUS_MIN_FIT ? fitted.fit : Math.max(fitted.fit, 0.72);

      // Kernfamilie: Fokus, Eltern, Kinder. Passt der ganze Ausschnitt nicht,
      // rückt der Blick so weit wie möglich auf ihre Mitte — die Fokuskarte
      // bleibt dabei ganz sichtbar. Sonst stünde auf dem Telefon die
      // Fokusperson allein in der Mitte, und die Eltern lägen daneben.
      const core = display.nodes.filter((n) =>
        [n.person, n.partner].some((p) => {
          const g = p ? focusData.members[p.id]?.generation : undefined;
          return g !== undefined && Math.abs(g) <= 1 && focusData.members[p!.id].role !== "sibling";
        }),
      );
      const coreX0 = Math.min(...core.map((n) => n.x));
      const coreX1 = Math.max(...core.map((n) => n.x + unitWidth(n)));
      const half = box.W / 2 / zoom;
      const margin = 16 / zoom;
      const focusLeft = c.x - NODE_WIDTH / 2;
      const coreCenter = Number.isFinite(coreX0) ? (coreX0 + coreX1) / 2 : c.x;
      const centerX = Math.min(
        Math.max(coreCenter, focusLeft + NODE_WIDTH + margin - half),
        focusLeft - margin + half,
      );

      const axis = (start: number, size: number, focus: number, view: number, offset: number) =>
        size * zoom <= view * 0.94
          ? offset + view / 2 - (start + size / 2) * zoom
          : offset + view / 2 - focus * zoom;
      flow.setViewport(
        {
          x: axis(box.x, box.w, centerX, box.W, 0),
          y: axis(box.y, box.h, c.y, box.H - TOP, TOP),
          zoom,
        },
        { duration },
      );
    },
    [focusData, display, fitBox, centerOf, flow],
  );

  /**
   * Anfangsausschnitt. Der ganze Baum passt bei vielen Personen nur in einer
   * Zoomstufe ins Bild, in der niemand mehr lesbar ist — dann lieber lesbar
   * oben beginnen; die Übersichtskarte und „Alles zeigen" bleiben für den
   * Gesamtüberblick.
   */
  const initialView = useCallback(() => {
    const el = containerRef.current;
    if (!el || display.nodes.length === 0) return;
    if (focusData) {
      focusView();
      return;
    }
    if (focused && centerOn(focused, FOCUS_ZOOM, 0)) return;

    const box = fitBox();
    if (!box) return;
    if (box.fit >= READABLE_ZOOM) {
      box.apply();
      return;
    }

    // Einstieg bei der obersten Generation, in der der Benutzer selbst
    // jemanden sehen darf — sonst begänne ein Betrachter mit lauter
    // Platzhaltern fremder Familien. Bei mehreren Kandidaten der mittlere.
    const visibleNodes = display.nodes.filter(
      (n) => !n.person.restricted || (n.partner && !n.partner.restricted),
    );
    const candidates = visibleNodes.length > 0 ? visibleNodes : display.nodes;
    const topY = Math.min(...candidates.map((n) => n.y));
    const topRow = candidates.filter((n) => n.y === topY).sort((a, b) => a.x - b.x);
    const home = topRow[Math.floor((topRow.length - 1) / 2)];
    flow.setViewport({
      x: el.clientWidth / 2 - (home.x + unitWidth(home) / 2) * READABLE_ZOOM,
      y: 32 - home.y * READABLE_ZOOM,
      zoom: READABLE_ZOOM,
    });
  }, [focused, display, focusData, focusView, centerOn, fitBox, flow]);

  // Beim ersten Anzeigen und nach jedem Wechsel von Ansicht oder Filter neu
  // einpassen — nicht bei jedem Fokuswechsel. In der Fokus-Ansicht gleitet
  // der Ausschnitt nach einem Klick auf die neue Fokusperson, statt zu
  // springen (siehe display).
  useEffect(() => {
    if (focusData && display.anchored) {
      focusView(reducedMotion ? 0 : 450);
      return;
    }
    initialView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display]);

  function goToHit(index: number) {
    const hit = hits[index];
    if (!hit) return;
    setSearchOpen(false);
    if (focusData) {
      setQuery("");
      if (hit.person.id !== focusData.focusId) navigate(focusHref(hit.person.id));
      return;
    }
    setFocused(hit.person.id);
    centerOn(hit.person.id);
  }

  /** Ansicht wechseln. Zwischen Fokus und Gesamtbaum wechseln die Daten. */
  function switchView(next: TreeView) {
    if (focusData) {
      if (next === "focus") return;
      navigate(treeUrl({ view: next, focus: focusData.focusId }));
      return;
    }
    if (next === "focus") {
      navigate(treeUrl({ focus: focused }));
      return;
    }
    setMode(next);
    // Nur die Adresse nachführen (Neuladen, Teilen) — die Daten sind dieselben.
    window.history.replaceState(null, "", treeUrl({ view: next, focus: focused }));
  }

  // Menüs schließen bei Klick daneben (auch auf der Baumfläche), Escape und
  // wenn der Fokus sie per Tab verlässt. Das Familienmenü bleibt beim
  // Ankreuzen offen, damit sich mehrere Familien in einem Zug wählen lassen.
  const closeFamilyMenu = useCallback(() => setFamilyMenuOpen(false), []);
  useDismiss(familyMenuOpen, closeFamilyMenu, [familyMenuRef], familyTriggerRef);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  useDismiss(searchOpen, closeSearch, [searchBoxRef], searchInputRef);

  /**
   * Tastaturbedienung: Tab springt von Karte zu Karte (die Karten sind Links).
   * Der Browser würde die Fläche dafür selbst verschieben und damit die
   * Darstellung von React Flow verfälschen — stattdessen hier zurücksetzen und
   * den Ausschnitt auf die fokussierte Karte legen.
   */
  function onFocusCapture(e: React.FocusEvent) {
    const target = e.target as HTMLElement;
    const nodeEl = target.closest<HTMLElement>(".react-flow__node");
    if (!nodeEl || !target.matches("a")) return;
    const flowEl = containerRef.current?.querySelector<HTMLElement>(".react-flow");
    if (flowEl) {
      flowEl.scrollTop = 0;
      flowEl.scrollLeft = 0;
    }
    const nodeId = nodeEl.dataset.id;
    const personId = target.dataset.personId;
    if (nodeId && personId) {
      const { zoom } = flow.getViewport();
      centerOn(personId, Math.max(zoom, 0.7));
    }
  }

  const familyLabel =
    focusData || selectedFamilies.length === 0
      ? "Alle Familien"
      : selectedFamilies.length === 1
        ? (families.find((f) => f.id === selectedFamilies[0])?.name ?? "1 Familie")
        : `${selectedFamilies.length} Familien`;

  const selectedNames = selectedFamilies
    .map((id) => families.find((f) => f.id === id)?.name)
    .filter(Boolean)
    .join(", ");

  const toolbarBox =
    "rounded-lg border border-stone-300 bg-surface text-sm dark:border-stone-700";

  const activeView: TreeView = focusData ? "focus" : mode;
  const trail = recent.filter((r) => r.id !== currentFocus).slice(0, 4);
  const focusPerson = focusData?.persons.find((p) => p.id === focusData.focusId);

  return (
    <TreeNavContext.Provider value={nav}>
    <div className="flex flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-start gap-2" role="toolbar" aria-label="Baumansicht">
        <div className="relative w-full sm:w-64" ref={searchBoxRef}>
          <label htmlFor="tree-search" className="sr-only">
            {focusData ? "Person suchen und in den Mittelpunkt stellen" : "Person im Baum suchen"}
          </label>
          <input
            id="tree-search"
            type="search"
            ref={searchInputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, Math.min(hits.length, 8) - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                goToHit(cursor);
              } else if (e.key === "Escape") {
                // Erst schließt Escape die Trefferliste, beim zweiten Mal leert es die Suche.
                if (!searchOpen) setQuery("");
              }
            }}
            placeholder="Person suchen…"
            autoComplete="off"
            role="combobox"
            aria-expanded={searchOpen && hits.length > 0}
            aria-controls="tree-search-results"
            aria-activedescendant={hits.length > 0 ? `tree-hit-${cursor}` : undefined}
            className="field w-full"
          />
          {needle && searchOpen && (
            <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-stone-300 bg-surface shadow-lift dark:border-stone-700">
              <p className="border-b border-stone-200 px-3 py-1.5 text-xs muted dark:border-stone-800" aria-live="polite">
                {searchLoading
                  ? "Suche …"
                  : hits.length === 0
                    ? "Kein Treffer"
                    : focusData
                      ? hits.length === 1
                        ? "1 Treffer — Enter stellt ihn in den Mittelpunkt"
                        : `${hits.length >= 8 ? "Mehr als 8" : hits.length} Treffer — auswählen stellt in den Mittelpunkt`
                      : hits.length === 1
                        ? "1 Treffer — Enter zeigt ihn"
                        : `${hits.length} Treffer — auswählen zum Hinspringen`}
              </p>
              {hits.length > 0 && (
                <ul id="tree-search-results" role="listbox" aria-label="Suchtreffer">
                  {hits.slice(0, 8).map((h, i) => (
                    <li
                      key={h.person.id}
                      id={`tree-hit-${i}`}
                      role="option"
                      aria-selected={i === cursor}
                      onMouseEnter={() => setCursor(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => goToHit(i)}
                      className={`flex cursor-pointer items-baseline gap-2 px-3 py-1.5 text-sm max-md:py-3 ${
                        i === cursor ? "bg-stone-100 dark:bg-stone-800" : ""
                      }`}
                    >
                      <span className="truncate font-medium">{displayName(h.person)}</span>
                      <span className="ml-auto shrink-0 text-xs muted">{lifeSpan(h.person)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {families.length > 0 && (
          // In der Fokus-Ansicht ist der Filter abgeschaltet — auf dem Telefon
          // dann gar nicht erst zeigen, die Werkzeugleiste ist dort knapp.
          <div className={`relative ${focusData ? "max-sm:hidden" : ""}`} ref={familyMenuRef}>
            <button
              ref={familyTriggerRef}
              type="button"
              aria-haspopup="menu"
              disabled={Boolean(focusData)}
              title={
                focusData
                  ? "In der Fokus-Ansicht ohne Wirkung — sie zeigt ohnehin nur die nächsten Verwandten"
                  : selectedFamilies.length > 1
                    ? selectedNames
                    : undefined
              }
              aria-label={`Familienfilter: ${focusData || selectedFamilies.length === 0 ? "Alle Familien" : selectedNames}`}
              data-testid="tree-family-filter"
              aria-expanded={familyMenuOpen}
              aria-controls="tree-family-menu"
              onClick={() => setFamilyMenuOpen((open) => !open)}
              className="btn-secondary font-normal disabled:cursor-not-allowed disabled:opacity-50"
            >
              {familyLabel}
              <span aria-hidden className="text-xs muted">▾</span>
            </button>

            {familyMenuOpen && !focusData && (
              <div
                id="tree-family-menu"
                role="menu"
                aria-label="Familien filtern"
                className="absolute z-30 mt-1 w-60 overflow-hidden rounded-lg border border-stone-300 bg-surface shadow-lift dark:border-stone-700"
              >
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={selectedFamilies.length === 0}
                  onClick={() => {
                    // „Alle" hebt die Auswahl auf und schließt das Menü.
                    setSelectedFamilies([]);
                    setFamilyMenuOpen(false);
                    familyTriggerRef.current?.focus();
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-stone-100 max-md:min-h-11 dark:hover:bg-stone-800 ${
                    selectedFamilies.length === 0 ? "font-medium" : ""
                  }`}
                >
                  <span aria-hidden className="w-4">
                    {selectedFamilies.length === 0 ? "✓" : ""}
                  </span>
                  Alle Familien
                </button>

                <div className="border-t border-stone-200 dark:border-stone-700" />

                {families.map((f) => {
                  const active = selectedFamilies.includes(f.id);
                  return (
                    <button
                      type="button"
                      key={f.id}
                      role="menuitemcheckbox"
                      aria-checked={active}
                      onClick={() =>
                        setSelectedFamilies((prev) =>
                          active ? prev.filter((id) => id !== f.id) : [...prev, f.id],
                        )
                      }
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-stone-100 max-md:min-h-11 dark:hover:bg-stone-800"
                    >
                      <span
                        aria-hidden
                        className={`inline-flex h-4 w-4 items-center justify-center rounded border text-[10px] ${
                          active
                            ? "border-accent-700 bg-accent-700 text-white dark:border-accent-300 dark:bg-accent-300 dark:text-stone-950"
                            : "border-stone-400 dark:border-stone-600"
                        }`}
                      >
                        {active ? "✓" : ""}
                      </span>
                      {f.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <label
          title={
            focusData
              ? "Ehepartner ohne gemeinsames Kind im Ausschnitt ausblenden — es bleibt die reine Abstammung"
              : "Ehen aus der Darstellung nehmen — es bleibt die reine Abstammung"
          }
          className={`${toolbarBox} flex cursor-pointer items-center gap-2 px-3 py-1.5 max-md:min-h-11 ${focusData ? "max-sm:order-2" : ""}`}
        >
          <input
            type="checkbox"
            checked={showMarriages}
            onChange={(e) => setShowMarriages(e.target.checked)}
            className="accent-rose-500"
          />
          Ehen zeigen
        </label>

        {/* Fokus-Ansicht auf dem Telefon: Ansicht zuerst, „Ehen zeigen“ und die
            Tiefe teilen sich die nächste Zeile — sonst vier Zeilen bei 360 px. */}
        <div className={`${toolbarBox} flex overflow-hidden ${focusData ? "max-sm:order-1" : ""}`} role="group" aria-label="Ansicht">
          {(
            [
              ["focus", "Fokus", "Eine Person im Mittelpunkt mit Vorfahren und Nachkommen"],
              ["generations", "Generationen", "Ganzer Baum nach Generationen"],
              ["timeline", "Zeitstrahl", "Ganzer Baum auf einer Jahresachse"],
            ] as const
          ).map(([value, label, title]) => (
            <button
              type="button"
              key={value}
              title={title}
              aria-pressed={activeView === value}
              data-testid={`tree-view-${value}`}
              onClick={() => switchView(value)}
              className={`px-2.5 py-1.5 max-md:min-h-11 sm:px-3 transition ${
                activeView === value
                  ? "bg-accent-700 text-white dark:bg-accent-300 dark:text-stone-950"
                  : "hover:bg-stone-100 dark:hover:bg-stone-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {focusData ? (
          <>
            <div
              className={`${toolbarBox} flex items-center gap-1 py-1 pl-2 pr-0.5 max-md:py-0 max-sm:order-3 sm:pl-3 sm:pr-1`}
              role="group"
              aria-label="Generationen im Ausschnitt"
            >
              <label htmlFor="tree-depth-up" className="muted" title="Vorfahren">
                <span className="max-sm:sr-only">Vorfahren</span>
                <span aria-hidden className="sm:hidden">▲</span>
              </label>
              <select
                id="tree-depth-up"
                data-testid="tree-depth-up"
                value={up}
                onChange={(e) => navigate(treeUrl({ focus: currentFocus, up: Number(e.target.value), down }), true)}
                className="rounded-md bg-transparent py-0.5 pl-1 pr-1 font-medium tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 max-md:min-h-[2.625rem] max-md:min-w-11 max-md:text-base"
              >
                {Array.from({ length: FOCUS_DEPTH.max - FOCUS_DEPTH.min + 1 }, (_, i) => FOCUS_DEPTH.min + i).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <span aria-hidden className="mx-1 h-4 w-px bg-stone-300 dark:bg-stone-700" />
              <label htmlFor="tree-depth-down" className="muted" title="Nachkommen">
                <span className="max-sm:sr-only">Nachkommen</span>
                <span aria-hidden className="sm:hidden">▼</span>
              </label>
              <select
                id="tree-depth-down"
                data-testid="tree-depth-down"
                value={down}
                onChange={(e) => navigate(treeUrl({ focus: currentFocus, up, down: Number(e.target.value) }), true)}
                className="rounded-md bg-transparent py-0.5 pl-1 pr-1 font-medium tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 max-md:min-h-[2.625rem] max-md:min-w-11 max-md:text-base"
              >
                {Array.from({ length: FOCUS_DEPTH.max - FOCUS_DEPTH.min + 1 }, (_, i) => FOCUS_DEPTH.min + i).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <Link
              href={treeUrl({ view: "generations", focus: currentFocus })}
              onClick={(e) => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                switchView("generations");
              }}
              data-testid="tree-whole"
              className="btn-secondary font-normal max-sm:hidden"
            >
              Ganzer Baum
            </Link>
          </>
        ) : (
          <button
            type="button"
            className="btn-secondary font-normal"
            onClick={() => {
              setFocused(null);
              flow.fitView({ padding: 0.1, duration: 400 });
            }}
          >
            Alles zeigen
          </button>
        )}
      </div>

      <div
        ref={containerRef}
        onFocusCapture={onFocusCapture}
        data-testid="family-tree"
        data-view={activeView}
        data-focus-id={currentFocus ?? undefined}
        aria-busy={pending}
        className="relative min-h-[320px] w-full flex-1 md:min-h-[420px] overflow-hidden rounded-2xl border border-stone-200 bg-[radial-gradient(ellipse_at_top,rgb(var(--surface)),rgb(var(--paper))_70%)] shadow-card dark:border-stone-800"
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onInit={() => initialView()}
          minZoom={0.05}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          // Im kleinen Fokus-Ausschnitt alle Karten zeichnen: so erreicht die
          // Tab-Taste auch Karten außerhalb des Bildes (z.B. auf dem Telefon).
          onlyRenderVisibleElements={!focusData}
          translateExtent={translateExtent}
        >
          <Background gap={28} size={1} color={dark ? "#292524" : "#e7e5e4"} />
          <Controls
            showInteractive={false}
            position="bottom-right"
            className="!shadow-sm"
          />
          {!focusData && (
            <MiniMap
              pannable
              zoomable
              position="top-right"
              ariaLabel="Übersichtskarte des Stammbaums"
              nodeColor={(n) =>
                n.type === "marriage" ? "#fda4af" : dark ? "#57534e" : "#d6d3d1"
              }
              maskColor={dark ? "rgba(12,10,9,0.6)" : "rgba(245,245,244,0.6)"}
              style={{ width: 168, height: 112 }}
              className="!hidden !overflow-hidden !rounded-lg !border !border-stone-200 !shadow-card sm:!block dark:!border-stone-700"
            />
          )}
        </ReactFlow>

        {display.timeline && <TimelineAxis ticks={display.timeline.axis.ticks} />}

        {focusData && focusPerson && (
          <nav
            aria-label="Fokus-Verlauf"
            data-testid="tree-focus-trail"
            className="absolute left-3 right-3 top-3 z-10 flex items-center gap-1.5 overflow-x-auto text-xs sm:right-auto sm:max-w-[70%]"
          >
            <span className="shrink-0 rounded-full bg-white/95 px-2.5 py-1 shadow-sm ring-1 ring-stone-200 backdrop-blur dark:bg-stone-900/95 dark:ring-stone-800">
              <span className="muted">Im Fokus: </span>
              <span aria-current="page" className="font-semibold">{displayName(focusPerson)}</span>
            </span>
            {trail.length > 0 && <span className="shrink-0 muted">zuletzt:</span>}
            {trail.map((r) => (
              <Link
                key={r.id}
                href={focusHref(r.id)}
                onClick={(e) => onFocusClick(e, r.id)}
                className="shrink-0 rounded-full bg-white/80 px-2.5 py-1 text-stone-700 max-md:px-3 max-md:py-2.5 max-md:text-sm ring-1 ring-stone-200 backdrop-blur transition hover:bg-white hover:ring-accent-300 dark:bg-stone-900/80 dark:text-stone-300 dark:ring-stone-800 dark:hover:ring-accent-600"
              >
                {r.name}
              </Link>
            ))}
          </nav>
        )}

        {pending && (
          <div
            role="status"
            className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-white/95 px-3 py-1 text-xs shadow-sm ring-1 ring-stone-200 dark:bg-stone-900/95 dark:ring-stone-800"
          >
            Lädt …
          </div>
        )}

        {!focusData && filtered.persons.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
            <p className="rounded-lg bg-white/95 px-4 py-3 text-sm muted shadow-sm dark:bg-stone-900/95">
              Keine Person in dieser Familie.
            </p>
          </div>
        )}

        <Legend open={legendOpen} onToggle={() => setLegendOpen((o) => !o)} timeline={activeView === "timeline"} focus={Boolean(focusData)} />
      </div>
    </div>
    </TreeNavContext.Provider>
  );
}

/**
 * Jahresachse getrennt vom Graphen: sie wird als festes Overlay gezeichnet,
 * damit sie beim seitlichen Verschieben stehen bleibt. Liest die Verschiebung
 * direkt aus React Flow — so muss nicht der ganze Baum bei jeder Bewegung neu
 * gerendert werden.
 */
function TimelineAxis({ ticks }: { ticks: { year: number; y: number }[] }) {
  const [, ty, zoom] = useStore((s) => s.transform);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 left-0 z-[6] w-14 overflow-hidden border-r border-stone-200 bg-white/85 backdrop-blur dark:border-stone-800 dark:bg-stone-900/85"
    >
      {ticks.map((tick) => {
        // Weltkoordinate in Bildschirmkoordinate umrechnen.
        const top = tick.y * zoom + ty;
        if (top < -20 || top > 4000) return null;
        return (
          <div
            key={tick.year}
            style={{ top }}
            className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-stone-500 dark:text-stone-400"
          >
            {tick.year}
          </div>
        );
      })}
    </div>
  );
}

function LegendLine({ subtype, label }: { subtype: ParentSubtype; label: string }) {
  const s = PARENT_EDGE_STYLE[subtype];
  return (
    <li className="flex items-center gap-2">
      <svg width="28" height="6" aria-hidden className="shrink-0">
        <line
          x1="1"
          y1="3"
          x2="27"
          y2="3"
          strokeWidth="2"
          strokeDasharray={s.dash}
          className={s.className}
        />
      </svg>
      {label}
    </li>
  );
}

function Legend({
  open,
  onToggle,
  timeline,
  focus,
}: {
  open: boolean;
  onToggle: () => void;
  timeline: boolean;
  focus: boolean;
}) {
  return (
    <div
      // Auf dem Telefon liegen die Zoom-Knöpfe als Zeile am unteren Rand;
      // die aufgeklappte Legende rückt dort darüber, statt sie zu verdecken.
      className={`absolute bottom-3 z-10 rounded-lg bg-white/95 text-xs text-stone-600 shadow-sm ring-1 ring-stone-200 backdrop-blur dark:bg-stone-900/95 dark:text-stone-300 dark:ring-stone-800 ${
        timeline ? "left-16" : "left-3"
      } ${open ? "max-md:bottom-[4.25rem]" : ""}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="tree-legend"
        className="flex w-full items-center gap-2 px-3 py-1.5 font-medium max-md:min-h-11"
      >
        Legende
        <span aria-hidden className="text-[10px]">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ul id="tree-legend" className="space-y-1 px-3 pb-2">
          <LegendLine subtype="BIOLOGICAL" label="leibliche Abstammung" />
          <LegendLine subtype="ADOPTIVE" label="Adoption" />
          <LegendLine subtype="STEP" label="Stiefkind" />
          <LegendLine subtype="FOSTER" label="Pflegekind" />
          <li className="flex items-center gap-2">
            <svg width="28" height="6" aria-hidden className="shrink-0">
              <line x1="1" y1="3" x2="27" y2="3" strokeWidth="2" className="stroke-rose-400" />
            </svg>
            Ehe / Partnerschaft <span aria-hidden className="text-rose-400">♥</span>
          </li>
          <li className="flex items-center gap-2">
            <svg width="28" height="6" aria-hidden className="shrink-0">
              <line x1="1" y1="3" x2="27" y2="3" strokeWidth="2" strokeDasharray="5 4" className="stroke-stone-400" />
            </svg>
            geschieden <span aria-hidden>⚯</span>
          </li>
          <li className="flex items-center gap-2" data-testid="legend-partner-unknown">
            <svg width="28" height="6" aria-hidden className="shrink-0">
              <line x1="1" y1="3" x2="27" y2="3" strokeWidth="2" strokeDasharray="1 4" strokeLinecap="round" stroke="#c9a3aa" />
            </svg>
            Ehestand unbekannt <span aria-hidden>?</span>
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden className="inline-flex w-7 justify-center"><LockIcon className="h-3.5 w-3.5" /></span>
            nicht freigegeben
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden className="inline-flex w-7 justify-center gap-0.5">
              <span className="inline-block h-2.5 w-1 rounded-sm bg-sky-400" />
              <span className="inline-block h-2.5 w-1 rounded-sm bg-rose-400" />
            </span>
            männlich / weiblich
          </li>
          {focus ? (
            <>
              <li className="flex items-center gap-2">
                <span aria-hidden className="inline-flex w-7 justify-center text-[10px]">▲ ▼</span>
                mehr außerhalb des Ausschnitts
              </li>
              <li className="max-w-[13rem] pt-1 text-[11px] muted">
                Karte anklicken: Person in den Mittelpunkt.{" "}
                <span className="inline-flex translate-y-0.5"><OpenIcon className="h-3 w-3" /></span> öffnet die Personenseite.
              </li>
            </>
          ) : (
            <li className="max-w-[13rem] pt-1 text-[11px] muted">
              Karte anklicken: Personenseite.{" "}
              <span className="inline-flex translate-y-0.5"><FocusIcon className="h-3 w-3" /></span> zeigt die Person in der Fokus-Ansicht.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
