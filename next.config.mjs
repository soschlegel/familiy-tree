/** @type {import('next').NextConfig} */
const nextConfig = {
  // Eigener Build-Ordner für den Mock-Server (scripts/mock.mjs), damit er
  // parallel zum normalen Dev-Server laufen kann.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Erzeugt .next/standalone — der Docker-Image bleibt dadurch klein.
  output: "standalone",
  // sharp läuft im Route-Handler und darf nicht mitgebundelt werden.
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
