"use client";

import { useEffect, type RefObject } from "react";

/**
 * Gemeinsames Schließverhalten für Menüs und Aufklapplisten:
 *
 * - Zeigerdruck außerhalb (pointerdown in der CAPTURE-Phase — die
 *   Stammbaum-Fläche von React Flow stoppt die Weitergabe ihrer
 *   Zeigerereignisse, ein normaler Listener am document bekäme dort nichts mit),
 * - Escape (Fokus geht zurück auf den Auslöser),
 * - Fokus verlässt den Bereich per Tab.
 *
 * `inside` sind alle Elemente, die als „innen" gelten (Menü und Auslöser).
 */
export function useDismiss(
  open: boolean,
  close: () => void,
  inside: RefObject<HTMLElement | null>[],
  trigger?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const isInside = (node: EventTarget | null) =>
      node instanceof Node && inside.some((r) => r.current?.contains(node));

    function onPointerDown(e: PointerEvent) {
      if (!isInside(e.target)) close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      close();
      trigger?.current?.focus();
    }
    function onFocusIn(e: FocusEvent) {
      if (!isInside(e.target)) close();
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
    };
    // `inside` ist bei jedem Render ein neues Array aus stabilen Refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close]);
}
