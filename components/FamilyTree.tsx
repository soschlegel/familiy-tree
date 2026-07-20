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
  YearNode,
  type MarriageNodeData,
} from "./MarriageNode";
import { MarriageEdge } from "./MarriageEdge";
import { ParentEdge } from "./ParentEdge";
import {
  displayName,
  layoutForest,
  layoutTimeline,
  NODE_HEIGHT,
  type TreeData,
} from "@/lib/tree-layout";

const nodeTypes = {
  person: PersonNode,
  marriage: MarriageNode,
  year: YearNode,
};

const edgeTypes = { marriage: MarriageEdge, parent: ParentEdge };

type ViewMode = "generations" | "timeline";

export function FamilyTree({ data }: { data: TreeData }) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ViewMode>("generations");

  const { nodes, edges } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (name: string) =>
      needle.length > 0 && name.toLowerCase().includes(needle);

    const timeline = mode === "timeline" ? layoutTimeline(data) : null;
    const layout = timeline ?? layoutForest(data);

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
            sourceHandle: "children-source",
            targetHandle: "parents-target",
            type: "parent",
            data: { variant: "parent", dimmed: dimAll },
          },
    );

    if (!timeline) {
      return { nodes: personNodes, edges: rfEdges };
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
    const replaced = new Set<string>();
    const eventEdges: Edge[] = [];

    for (const ev of timeline.events) {
      const { anchorAId: a, anchorBId: b } = ev;

      if (a !== b) {
        const [x, y] = a < b ? [a, b] : [b, a];
        replaced.add(`partner:${x}-${y}`);
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
      ...rfEdges.filter((e) => !replaced.has(e.id)),
      ...eventEdges,
    ];

    const leftEdge = Math.min(...personNodes.map((n) => n.position.x), 0);
    const yearNodes: Node[] = timeline.axis.ticks.map((tick) => ({
      id: `year:${tick.year}`,
      type: "year",
      position: { x: leftEdge - 130, y: tick.y },
      data: { year: tick.year },
      draggable: false,
      selectable: false,
    }));

    return {
      nodes: [...yearNodes, ...personNodes, ...eventNodes],
      edges: timelineEdges,
    };
  }, [data, query, mode]);

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
