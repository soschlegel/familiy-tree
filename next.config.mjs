/** @type {import('next').NextConfig} */
const nextConfig = {
  // Eigener Build-Ordner für den Mock-Server (scripts/mock.mjs), damit er
  // parallel zum normalen Dev-Server laufen kann.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Erzeugt .next/standalone — der Docker-Image bleibt dadurch klein.
  output: "standalone",
  // sharp läuft im Route-Handler und darf nicht mitgebundelt werden.
  serverExternalPackages: ["sharp"],
  // Das Ortsverzeichnis wird zur Laufzeit von der Platte gelesen
  // (lib/places/gazetteer-file.ts) und muss deshalb ins Standalone-Image —
  // für alle API-Routen: neben /api/places/** (Admin-Seite, Vorschlag am
  // Eingabefeld /api/places/suggest) ordnen auch Speichern, Importe und der
  // MCP-Server neue Ortstexte automatisch zu.
  outputFileTracingIncludes: {
    "/api/**": ["./geo/gazetteer.tsv.gz"],
    "/admin/places": ["./geo/gazetteer.tsv.gz"],
  },
};

export default nextConfig;
