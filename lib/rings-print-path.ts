/**
 * Adresse der Druckansicht der Ringe (app/tree/print). Eigene, winzige
 * Datei, damit Kopfzeile und Seitenrahmen (components/NavBar.tsx) sie
 * kennen, ohne die ganze Drucklogik (lib/rings-print.ts) in jede Seite zu
 * laden.
 */
export const RINGS_PRINT_PATH = "/tree/print";
