/**
 * Kartenprojektion (Mercator) — dieselbe Rechnung wie beim Erzeugen der
 * Ländergrenzen in scripts/build-geodata.mjs (public/geo/countries.json).
 * Die ganze Welt ist WORLD Einheiten breit; y wächst nach Süden.
 */
export const WORLD = 1000;
export const MAX_LAT = 84;

export function project(lon: number, lat: number): [number, number] {
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return [((lon + 180) / 360) * WORLD, ((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2) * WORLD];
}

export type ViewBox = { x: number; y: number; w: number; h: number };

function boxOf(lonMin: number, lonMax: number, latMin: number, latMax: number): ViewBox {
  const [x0, y0] = project(lonMin, latMax);
  const [x1, y1] = project(lonMax, latMin);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Voreingestellte Ausschnitte. */
export const VIEWS = {
  europe: boxOf(-12, 42, 34, 71),
  world: boxOf(-170, 190, -56, 80),
} as const;
export type ViewName = keyof typeof VIEWS;

/**
 * Ausschnitt auf das Seitenverhältnis der Fläche bringen, ohne etwas vom
 * gewünschten Ausschnitt abzuschneiden (wie preserveAspectRatio „meet“).
 */
export function fitViewBox(box: ViewBox, width: number, height: number): ViewBox {
  if (width <= 0 || height <= 0) return box;
  const target = width / height;
  const current = box.w / box.h;
  if (current > target) {
    const h = box.w / target;
    return { x: box.x, y: box.y - (h - box.h) / 2, w: box.w, h };
  }
  const w = box.h * target;
  return { x: box.x - (w - box.w) / 2, y: box.y, w, h: box.h };
}

/** Zoom um einen Punkt (in Karteneinheiten); factor > 1 vergrößert. */
export function zoomAt(box: ViewBox, factor: number, cx: number, cy: number): ViewBox {
  const w = Math.min(WORLD * 1.5, Math.max(4, box.w / factor));
  const f = box.w / w;
  const h = box.h / f;
  return { x: cx - (cx - box.x) * (w / box.w), y: cy - (cy - box.y) * (h / box.h), w, h };
}
