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
    // Anwender-Hilfe: Markdown wird zur Laufzeit gelesen (lib/help/content.ts).
    "/hilfe": ["./docs/anwender/*.md"],
    "/hilfe/**": ["./docs/anwender/*.md"],
  },
};

export default nextConfig;
