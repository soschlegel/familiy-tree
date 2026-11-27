import {
  RINGS_COLORING_PARAM,
  RINGS_DEFAULT_COLORING,
  RINGS_DEFAULT_DIRECTION,
  RINGS_DIRECTION_PARAM,
  RINGS_GENERATION_PARAM,
  ringsDefaultGeneration,
  type RingsColoring,
  type RingsDirection,
} from "@/lib/ancestor-rings";
import { FOCUS_DEPTH, type TreeView } from "@/lib/focus-tree";
import { ORIGIN_PARAM } from "@/lib/origin";

/** Adressparameter des Vollbilds (`?vollbild=1`, components/useTreeFullscreen.ts). */
export const FULLSCREEN_PARAM = "vollbild";

/**
 * URL der Baumseite; Standardwerte bleiben weg, damit Links kurz bleiben.
 * Reines Modul (ohne React Flow), damit es auch die Ansicht „Ringe“
 * (components/AncestorRings.tsx) nutzen kann; `FamilyTree` exportiert es
 * weiter.
 */
export function treeUrl({
  view = "focus",
  focus,
  up = FOCUS_DEPTH.up,
  down = FOCUS_DEPTH.down,
  direction = RINGS_DEFAULT_DIRECTION,
  generations,
  coloring = RINGS_DEFAULT_COLORING,
  herkunft = false,
  vollbild = false,
}: {
  view?: TreeView;
  focus?: string | null;
  up?: number;
  down?: number;
  /** Ansicht „Ringe“: Richtung (`?richtung=nachfahren`, Standard „vorfahren“ bleibt weg). */
  direction?: RingsDirection;
  /** Ansicht „Ringe“: Tiefe (`?generationen=…`; der Standard der Richtung — 5 bzw. 4 — bleibt weg). */
  generations?: number;
  /** Ansicht „Ringe“: Färbung (`?farbe=wurzeln`, Standard „linie“ bleibt weg). */
  coloring?: RingsColoring;
  /** Schalter „Herkunft“ (`?herkunft=1`); aus bleibt weg. */
  herkunft?: boolean;
  /** Vollbild (`?vollbild=1`, components/useTreeFullscreen.ts); aus bleibt weg. */
  vollbild?: boolean;
}): string {
  const s = new URLSearchParams();
  if (view !== "focus") s.set("view", view);
  if (focus) s.set("focus", focus);
  if (view === "focus") {
    if (up !== FOCUS_DEPTH.up) s.set("up", String(up));
    if (down !== FOCUS_DEPTH.down) s.set("down", String(down));
  }
  if (view === "rings") {
    if (direction !== RINGS_DEFAULT_DIRECTION) s.set(RINGS_DIRECTION_PARAM, direction);
    if (generations !== undefined && generations !== ringsDefaultGeneration(direction)) {
      s.set(RINGS_GENERATION_PARAM, String(generations));
    }
    if (coloring !== RINGS_DEFAULT_COLORING) s.set(RINGS_COLORING_PARAM, coloring);
  }
  if (herkunft) s.set(ORIGIN_PARAM, "1");
  if (vollbild) s.set(FULLSCREEN_PARAM, "1");
  const query = s.toString();
  return query ? `/tree?${query}` : "/tree";
}
