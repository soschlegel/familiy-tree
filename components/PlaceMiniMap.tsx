"use client";

import { useEffect, useState } from "react";

import { project } from "@/lib/map/projection";

/**
 * Kleine Lagekarte für die Ortsseite: Ländergrenzen aus
 * public/geo/countries.json (wie die große Karte, kein fremder Server) und ein
 * Punkt an den Koordinaten. Nur Anzeige — die Koordinaten stehen daneben
 * als Text.
 */
type Country = { id: string; name: string; d: string };
let cache: Promise<Country[]> | null = null;
const loadCountries = () =>
  (cache ??= fetch("/geo/countries.json")
    .then((r) => (r.ok ? r.json() : { countries: [] }))
    .then((j: { countries: Country[] }) => j.countries)
    .catch(() => {
      cache = null;
      return [];
    }));

export function PlaceMiniMap({ latitude, longitude, label }: { latitude: number; longitude: number; label: string }) {
  const [countries, setCountries] = useState<Country[] | null>(null);
  useEffect(() => {
    let alive = true;
    void loadCountries().then((c) => alive && setCountries(c));
    return () => {
      alive = false;
    };
  }, []);
  const [x, y] = project(longitude, latitude);
  const w = 60;
  const h = 40;
  return (
    <svg
      viewBox={`${x - w / 2} ${y - h / 2} ${w} ${h}`}
      className="h-48 w-full rounded-lg border border-stone-200 bg-sky-50 dark:border-stone-700 dark:bg-sky-950/40"
      role="img"
      aria-label={`Lage von ${label}`}
      data-testid="place-minimap"
    >
      {(countries ?? []).map((c) => (
        <path
          key={c.id}
          d={c.d}
          className="fill-stone-100 stroke-stone-400 dark:fill-stone-800 dark:stroke-stone-500"
          strokeWidth={0.15}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <circle cx={x} cy={y} r={1.1} className="fill-accent-600 stroke-white" strokeWidth={0.4} />
    </svg>
  );
}
