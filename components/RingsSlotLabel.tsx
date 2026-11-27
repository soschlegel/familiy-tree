import { isLowerHalf, labelArcPath, polar, radialRotation, type RingLabelPlan } from "@/lib/ancestor-rings";

/**
 * Beschriftung eines Platzes der Ansicht „Ringe“: im Bogen oder entlang des
 * Radius, nie auf dem Kopf. Gemeinsam für Bildschirm
 * (components/AncestorRings.tsx) und Druck (components/RingsPrintSheet.tsx);
 * `ink` ist die Schriftfarbe (am Bildschirm die Variable des Schemas, im
 * Druck eine feste Farbe, damit das Blatt immer hell ist).
 */
export function RingsSlotLabel({
  uid,
  slotId,
  plan,
  center,
  inner,
  outer,
  start,
  end,
  mid,
  lines,
  restricted,
  ink = "var(--rings-ink)",
}: {
  uid: string;
  slotId: string;
  plan: RingLabelPlan;
  center: number;
  inner: number;
  outer: number;
  start: number;
  end: number;
  mid: number;
  lines: string[];
  restricted: boolean;
  ink?: string;
}) {
  const fs = plan.fontSize;
  const two = plan.lines > 1 && Boolean(lines[1]);
  const rMid = (inner + outer) / 2;
  const textStyle = { fill: ink };
  // Versatz „nach oben“ (zur Oberkante der Schrift) je Zeile: Grundlinie so,
  // dass die Zeile(n) mittig im Ring stehen.
  const rows = two
    ? [
        { text: lines[0], up: 0.22 * fs, size: fs, weight: restricted ? 400 : 600 },
        { text: lines[1], up: -0.88 * fs, size: fs * 0.88, weight: 400 },
      ]
    : [{ text: lines[0], up: -0.35 * fs, size: fs, weight: restricted ? 400 : 600 }];

  if (plan.mode === "arc") {
    const lower = isLowerHalf(mid);
    return (
      <g>
        {rows.map((row, k) => {
          // Oben zeigt die Schrift nach außen, unten (umgekehrter Pfad) nach innen.
          const r = lower ? rMid - row.up : rMid + row.up;
          const pad = ((fs * 0.5) / r) * (180 / Math.PI);
          const id = `${uid}-t-${slotId.replace(":", "-")}-${k}`;
          return (
            <g key={k}>
              <defs>
                <path id={id} d={labelArcPath(center, r, start + pad, end - pad)} />
              </defs>
              <text fontSize={row.size} fontWeight={row.weight} style={textStyle}>
                <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
                  {row.text}
                </textPath>
              </text>
            </g>
          );
        })}
      </g>
    );
  }

  const p = polar(center, rMid, mid);
  const rot = radialRotation(mid);
  return (
    <g transform={`rotate(${rot} ${p.x} ${p.y})`}>
      {rows.map((row, k) => (
        <text key={k} x={p.x} y={p.y - row.up} fontSize={row.size} fontWeight={row.weight} textAnchor="middle" style={textStyle}>
          {row.text}
        </text>
      ))}
    </g>
  );
}
