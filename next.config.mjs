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
  // (lib/places/gazetteer-file.ts) und muss deshalb ins Standalone-Image.
  outputFileTracingIncludes: {
    "/api/places/**": ["./geo/gazetteer.tsv.gz"],
    "/admin/places": ["./geo/gazetteer.tsv.gz"],
  },
  // `import text from "…?raw"` liefert den Dateiinhalt als Text, eingebaut
  // zur Build-Zeit — für CHANGELOG.md (lib/release-notes-data.ts). Kein
  // Dateizugriff zur Laufzeit, nichts für das Standalone-Image nachzutragen.
  webpack(config) {
    config.module.rules.push({ resourceQuery: /raw/, type: "asset/source" });
    return config;
  },
};

export default nextConfig;
