/**
 * Zeitpunkt einer Änderung in deutscher Zeit. Fest auf Europe/Berlin, damit
 * Server (Übersicht) und Browser (nachgeladene Einträge) dasselbe zeigen.
 */
export const formatChangeTime = (iso: string) =>
  new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });
