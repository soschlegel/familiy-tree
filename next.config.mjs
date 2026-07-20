/** @type {import('next').NextConfig} */
const nextConfig = {
  // Erzeugt .next/standalone — der Docker-Image bleibt dadurch klein.
  output: "standalone",
  // sharp läuft im Route-Handler und darf nicht mitgebundelt werden.
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
