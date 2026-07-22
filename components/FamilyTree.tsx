"use client";

import { useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node,
} from "reactflow";

import { PersonNode, type PersonNodeData } from "./PersonNode";
import {
  MarriageNode,
  JunctionNode,
  type MarriageNodeData,
} from "./MarriageNode";
import { MarriageEdge } from "./MarriageEdge";
import { ParentEdge } from "./ParentEdge";
import { displayName, NODE_HEIGHT, type TreeData } from "@/lib/tree-layout";
import { layoutGenerations, layoutTimeline } from "@/lib/layout-generations";

const nodeTypes = {
  person: PersonNode,
  marriage: MarriageNode,
  junction: JunctionNode,
};

const edgeTypes = { marriage: MarriageEdge, parent: ParentEdge };

type ViewMode = "generations" | "timeline";

/** Anschluss an der richtigen Kartenhälfte, sonst am Kasten selbst. */
const handleFor = (base: string, side?: "left" | "right" | "center") =>
  side === "left" || side === "right" ? `${base}-${side}` : base;

export function FamilyTree({
  data,
  families = [],
}: {
  data: TreeData;
  families?: { id: string; name: string }[];
}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ViewMode>("generations");
  const [selectedFamilies, setSelectedFamilies] = useState<string[]>([]);
  const [showMarriages, setShowMarriages] = useState(true);
  const [familyMenuOpen, setFamilyMenuOpen] = useState(false);

  /**
   * Filter auf ausgewählte Familien. Beziehungen bleiben nur, wenn beide
   * Seiten übrig sind — eine Kante ins Nichts würde sonst auf eine
   * ausgeblendete Person zeigen und das Layout zerreißen.
   */
  const filtered = useMemo(() => {
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
  }, [data, selectedFamilies, showMarriages]);

  const { nodes, edges } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (name: string) =>
      needle.length > 0 && name.toLowerCase().includes(needle);

    const timeline = mode === "timeline" ? layoutTimeline(filtered) : null;
    const layout = timeline ?? layoutGenerations(filtered);

    const personNodes: Node<PersonNodeData>[] = layout.nodes.map((n) => {
      const hit =
        matches(displayName(n.person)) ||
        (n.partner ? matches(displayName(n.partner)) : false);

      return {
        id: n.person.id,
        type: "person",
        position: { x: n.x, y: n.y },
        data: {
          person: n.person,
          partner: n.partner,
          marriage: n.marriage,
          hasDescendants: n.hasDescendants,
          highlighted: hit,
          // Bei aktiver Suche alles Übrige zurücknehmen, statt nur den Treffer
          // hervorzuheben — in einem dichten Baum geht sonst beides unter.
          dimmed: needle.length > 0 && !hit,
        },
        draggable: false,
        style: { height: NODE_HEIGHT },
      };
    });

    const dimAll = needle.length > 0;

    const rfEdges: Edge[] = layout.edges.map((e) =>
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
            },
          },
    );

    // Treffpunkte: laufen beide Elternlinien dort zusammen, ersetzen sie die
    // Einzelverbindungen — sonst zöge jeder Elternteil separat zu jedem Kind.
    const junctionNodes: Node[] = [];
    const junctionEdges: Edge[] = [];


    for (const j of layout.junctions) {
      junctionNodes.push({
        id: j.id,
        type: "junction",
        position: { x: j.x, y: j.y },
        data: { dimmed: dimAll },
        draggable: false,
        selectable: false,
      });

      for (const parent of j.parentUnitIds) {
        junctionEdges.push({
          id: `${j.id}:in:${parent}`,
          source: parent,
          target: j.id,
          sourceHandle: "children-source",
          type: "parent",
          data: { variant: "parent", lane: 0, dimmed: dimAll },
        });
      }

      for (const child of j.childUnitIds) {
        junctionEdges.push({
          id: `${j.id}:out:${child}`,
          source: j.id,
          target: child,
          targetHandle: "parents-target",
          type: "parent",
          data: { variant: "parent", lane: 0, dimmed: dimAll },
        });
      }
    }

    const withJunctions = [
      ...rfEdges,
      ...junctionEdges,
    ];

    if (!timeline) {
      return {
        nodes: [...personNodes, ...junctionNodes],
        edges: withJunctions,
      };
    }

    // Zeitstrahl: Hochzeiten als eigene Ereignisknoten und Jahreszahlen als
    // Achse — beide als echte Knoten, damit sie beim Zoomen mitwandern.
    const eventNodes: Node<MarriageNodeData>[] = timeline.events.map((ev) => ({
      id: ev.id,
      type: "marriage",
      position: timeline.eventPositions.get(ev.id)!,
      data: {
        date: ev.date,
        subtype: ev.subtype,
        primaryMediaId: ev.primaryMediaId,
        partnerNames: ev.partnerNames,
        dimmed: needle.length > 0 && !matches(ev.partnerNames),
      },
      draggable: false,
      selectable: false,
    }));

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

    const timelineEdges = [
      ...withJunctions.filter((e) => !marriedPairs.has(e.id)),
      ...eventEdges,
    ];


    return {
      nodes: [...personNodes, ...junctionNodes, ...eventNodes],
      edges: timelineEdges,
    };
  }, [filtered, query, mode]);

  // Jahresachse getrennt vom Graphen: sie wird als festes Overlay gezeichnet,
  // damit sie beim seitlichen Verschieben stehen bleibt. Als Knoten im Graphen
  // wanderte sie mit und war bei breiten Bäumen schnell aus dem Bild.
  const axis = useMemo(
    () => (mode === "timeline" ? layoutTimeline(filtered).axis : null),
    [filtered, mode],
  );

  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });

  if (data.persons.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-stone-300 p-12 text-center text-stone-500">
        Noch keine Personen erfasst.
      </div>
    );
  }

  return (
    <div className="relative h-[calc(100vh-12rem)] w-full overflow-hidden rounded-xl border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-950">
      <div className="absolute left-3 top-3 z-10 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Person suchen…"
          className="w-56 rounded-lg border border-stone-300 bg-white/95 px-3 py-1.5 text-sm shadow-sm backdrop-blur transition focus:border-stone-400 focus:outline-none dark:border-stone-700 dark:bg-stone-900/95"
        />

        {families.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setFamilyMenuOpen((open) => !open)}
              className="flex items-center gap-2 rounded-lg border border-stone-300 bg-white/95 px-3 py-1.5 text-sm shadow-sm backdrop-blur transition hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900/95 dark:hover:bg-stone-800"
            >
              {selectedFamilies.length === 0
                ? "Alle Familien"
                : selectedFamilies.length === 1
                  ? (families.find((f) => f.id === selectedFamilies[0])?.name ??
                    "1 Familie")
                  : `${selectedFamilies.length} Familien`}
              <span className="text-xs text-stone-400">▾</span>
            </button>

            {familyMenuOpen && (
              <div className="absolute z-30 mt-1 w-56 overflow-hidden rounded-lg border border-stone-300 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-900">
                <button
                  onClick={() => setSelectedFamilies([])}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-800 ${
                    selectedFamilies.length === 0 ? "font-medium" : ""
                  }`}
                >
                  <span className="w-4">
                    {selectedFamilies.length === 0 ? "✓" : ""}
                  </span>
                  Alle Familien
                </button>

                <div className="border-t border-stone-200 dark:border-stone-700" />

                {families.map((f) => {
                  const active = selectedFamilies.includes(f.id);
                  return (
                    <button
                      key={f.id}
                      onClick={() =>
                        setSelectedFamilies((prev) =>
                          active
                            ? prev.filter((id) => id !== f.id)
                            : [...prev, f.id],
                        )
                      }
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-800"
                    >
                      <span className="w-4">{active ? "✓" : ""}</span>
                      {f.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <label
          title="Ehen aus der Darstellung nehmen — es bleibt die reine Abstammung"
          className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white/95 px-3 py-1.5 text-sm shadow-sm backdrop-blur dark:border-stone-700 dark:bg-stone-900/95"
        >
          <input
            type="checkbox"
            checked={showMarriages}
            onChange={(e) => setShowMarriages(e.target.checked)}
            className="accent-rose-400"
          />
          Ehen
        </label>

        <div className="flex overflow-hidden rounded-lg border border-stone-300 bg-white/95 text-sm shadow-sm backdrop-blur dark:border-stone-700 dark:bg-stone-900/95">
          {(
            [
              ["generations", "Generationen"],
              ["timeline", "Zeitstrahl"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              className={`px-3 py-1.5 transition ${
                mode === value
                  ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                  : "hover:bg-stone-100 dark:hover:bg-stone-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}

        minZoom={0.05}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        onMove={(_, vp) => setViewport(vp)}
        onInit={(instance) => setViewport(instance.getViewport())}
      >
        <Background gap={28} size={1} color="#e7e5e4" />
        <Controls showInteractive={false} className="!shadow-sm" />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => (n.type === "marriage" ? "#fda4af" : "#d6d3d1")}
          className="!rounded-lg !border !border-stone-200 !bg-white/80"
        />
      </ReactFlow>

      {axis && (
        <div className="pointer-events-none absolute inset-y-0 left-0 z-[6] w-16 overflow-hidden border-r border-stone-200 bg-white/85 backdrop-blur dark:border-stone-800 dark:bg-stone-900/85">
          {axis.ticks.map((tick) => {
            // Weltkoordinate in Bildschirmkoordinate: das Verschieben und
            // Zoomen von React Flow nachrechnen, damit die Achse synchron zu
            // den Karten läuft, ohne selbst mitzuwandern.
            const top = tick.y * viewport.zoom + viewport.y;
            if (top < -20 || top > 4000) return null;
            return (
              <div
                key={tick.year}
                style={{ top }}
                className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-stone-400"
              >
                {tick.year}
              </div>
            );
          })}
        </div>
      )}

      {filtered.persons.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
          <p className="rounded-lg bg-white/95 px-4 py-3 text-sm text-stone-500 shadow-sm backdrop-blur dark:bg-stone-900/95">
            Keine Person in dieser Familie.
          </p>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex gap-3 rounded-lg bg-white/90 px-3 py-1.5 text-[11px] text-stone-500 shadow-sm backdrop-blur dark:bg-stone-900/90">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-stone-300" />
          Abstammung
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 border-t border-dashed border-rose-300" />
          Ehe
        </span>
        {mode === "timeline" && (
          <span className="flex items-center gap-1.5">
            <span className="text-rose-400">♥</span>
            Hochzeit
          </span>
        )}
      </div>
    </div>
  );
}
