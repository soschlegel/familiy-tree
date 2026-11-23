import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Korrektur für den Hydration-Fehler (React #418) im React, das Next.js 15.5
// mitbringt — siehe lib/next-patches/react-hydration-replay-fix.cjs.
const hydrationFix = require("./lib/next-patches/react-hydration-replay-fix.cjs");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Eigener Build-Ordner für den Mock-Server (scripts/mock.mjs), damit er
  // parallel zum normalen Dev-Server laufen kann.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Erzeugt .next/standalone — der Docker-Image bleibt dadurch klein.
  output: "standalone",
  // Keine Versionsangabe „X-Powered-By: Next.js“ nach außen.
  poweredByHeader: false,
  // Kopfzeilen für jede Antwort (docs/sicherheit.md): nicht in fremde Seiten
  // einbetten (Clickjacking), beim Klick auf externe Links (z.B. Adressen in
  // Quellen) keine Adresse der App samt Personen-Kennung mitschicken, keine
  // Inhaltsart erraten. Bewusst ohne Content-Security-Policy hier — die
  // Bildroute setzt ihre eigene, strengere.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
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
    // Ortsseite (Namen, Region, Land aus dem Verzeichnis).
    "/places/**": ["./geo/gazetteer.tsv.gz"],
    // Anwender-Hilfe: Markdown wird zur Laufzeit gelesen (lib/help/content.ts).
    "/hilfe": ["./docs/anwender/*.md"],
    "/hilfe/**": ["./docs/anwender/*.md"],
  },
  // `import text from "…?raw"` liefert den Dateiinhalt als Text, eingebaut
  // zur Build-Zeit — für CHANGELOG.md (lib/release-notes-data.ts). Kein
  // Dateizugriff zur Laufzeit, nichts für das Standalone-Image nachzutragen.
  webpack(config) {
    config.module.rules.push({ resourceQuery: /raw/, type: "asset/source" });
    // Rückportierung einer React-Korrektur in das von Next mitgebrachte
    // react-dom (nur dessen Client-Dateien; bricht den Build ab, wenn die
    // Stelle nicht mehr passt). Entfällt mit Next.js 16 / React 19.3.
    config.module.rules.push({
      test: hydrationFix.TARGET,
      enforce: "pre",
      loader: require.resolve("./lib/next-patches/react-hydration-replay-fix.cjs"),
    });
    return config;
  },
};

export default nextConfig;
