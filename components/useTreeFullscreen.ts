"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

/** Adressparameter des Vollbilds im Stammbaum (`/tree?vollbild=1`). */
export const FULLSCREEN_PARAM = "vollbild";

/** Aktuelle Adresse mit bzw. ohne `vollbild=1` (Pfad + Suche + Anker). */
function addressWith(on: boolean): string {
  const url = new URL(window.location.href);
  if (on) url.searchParams.set(FULLSCREEN_PARAM, "1");
  else url.searchParams.delete(FULLSCREEN_PARAM);
  return url.pathname + url.search + url.hash;
}

const paramOn = () => new URL(window.location.href).searchParams.get(FULLSCREEN_PARAM) === "1";

/**
 * Vollbild der Baumfläche. Der Zustand steht in der Adresse (`?vollbild=1`),
 * wie schon `?herkunft=1`: Einschalten legt mit `history.pushState` einen
 * eigenen Verlaufseintrag an (ohne Server-Anfrage — Next.js gleicht
 * `useSearchParams` damit ab), deshalb beendet die Zurück-Taste bzw.
 * -Geste des Telefons das Vollbild, ohne die Seite zu verlassen. „Vollbild
 * beenden“ und Escape gehen denselben Schritt zurück, wenn der Eintrag von
 * hier stammt; sonst (Seite mit `?vollbild=1` geladen oder im Vollbild
 * weiternavigiert) wird nur der Parameter aus der Adresse genommen.
 *
 * Dargestellt wird das Vollbild als CSS-Überlagerung (FamilyTree). Auf
 * Touch-Geräten wird zusätzlich die Fullscreen-API des Browsers versucht
 * (blendet dort Adress- und Statusleiste aus); wo sie fehlt oder scheitert
 * (iOS-Safari), bleibt es bei der Überlagerung. Verlässt der Browser sein
 * Vollbild selbst (Zurück-Taste unter Android, Escape), endet auch das
 * Vollbild der Seite.
 *
 * Solange es an ist, sind alle Teile der Seite außerhalb von `overlay`
 * `inert` (weder per Tab noch für Screenreader erreichbar) und die Seite
 * scrollt nicht.
 */
export function useTreeFullscreen(overlay: React.RefObject<HTMLElement | null>) {
  const params = useSearchParams();
  const on = params.get(FULLSCREEN_PARAM) === "1";
  /** Adresse des Eintrags, den `enter` angelegt hat. */
  const pushed = useRef<string | null>(null);
  /** `exit` ist unterwegs (history.back läuft asynchron). */
  const leaving = useRef(false);
  /** Die Fullscreen-API wurde von hier aus angefordert. */
  const requested = useRef(false);

  const enter = useCallback(() => {
    if (paramOn()) return;
    const url = addressWith(true);
    window.history.pushState(null, "", url);
    pushed.current = url;
    leaving.current = false;
    const root = document.documentElement;
    if (
      window.matchMedia("(pointer: coarse)").matches &&
      document.fullscreenEnabled &&
      typeof root.requestFullscreen === "function" &&
      !document.fullscreenElement
    ) {
      requested.current = true;
      root.requestFullscreen({ navigationUI: "hide" }).catch(() => {
        requested.current = false;
      });
    }
  }, []);

  const exit = useCallback(() => {
    if (leaving.current || !paramOn()) return;
    leaving.current = true;
    const here = window.location.pathname + window.location.search + window.location.hash;
    if (pushed.current === here) {
      pushed.current = null;
      window.history.back();
    } else {
      pushed.current = null;
      window.history.replaceState(null, "", addressWith(false));
    }
  }, []);

  // Escape beendet das Vollbild (sofern nichts anderes die Taste schon
  // verbraucht hat, etwa ein offenes Menü).
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) exit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on, exit]);

  // Browser-Vollbild verlassen (z.B. Zurück-Taste unter Android) → auch hier beenden.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && requested.current) {
        requested.current = false;
        exit();
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [exit]);

  // Zustand angekommen: Rest der Seite stilllegen bzw. wieder freigeben.
  useEffect(() => {
    if (!on) {
      leaving.current = false;
      if (requested.current && document.fullscreenElement) {
        requested.current = false;
        document.exitFullscreen().catch(() => {});
      }
      return;
    }
    const el = overlay.current;
    if (!el) return;
    const silenced: Element[] = [];
    for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
      const parent: Element | null = node.parentElement;
      if (!parent) break;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === node || sibling.hasAttribute("inert")) continue;
        if (["SCRIPT", "STYLE", "TEMPLATE", "NEXT-ROUTE-ANNOUNCER"].includes(sibling.tagName)) continue;
        sibling.setAttribute("inert", "");
        silenced.push(sibling);
      }
    }
    document.documentElement.classList.add("tree-fullscreen");
    return () => {
      for (const s of silenced) s.removeAttribute("inert");
      document.documentElement.classList.remove("tree-fullscreen");
    };
  }, [on, overlay]);

  return { on, enter, exit, toggle: on ? exit : enter };
}
