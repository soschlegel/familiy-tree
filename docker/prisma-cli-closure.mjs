// Nur für den Image-Build (Dockerfile, Stufe prisma-cli): gibt die Ordner
// unter node_modules aus, die der Prisma-CLI zur Laufzeit braucht — das Paket
// `prisma` und alle seine (transitiven) Abhängigkeiten, aufgelöst genau so,
// wie `npm ci` sie aus package-lock.json installiert hat.
//
// Das Dockerfile kopiert diese Ordner aus der deps-Stufe nach
// /opt/prisma-cli/node_modules. Dadurch gelten die Versionen und Prüfsummen
// des Lockfiles, die Engines (schema-engine für `migrate deploy`) hat der
// postinstall von @prisma/engines dort bereits für linux-musl geladen, und
// beim Build wird nichts zusätzlich aus dem Netz geholt.
//
//   node docker/prisma-cli-closure.mjs package-lock.json
//   -> eine Zeile je Ordner, z.B. "node_modules/prisma", "node_modules/@prisma/engines"
import { readFileSync } from "node:fs";
import { posix } from "node:path";

const lock = JSON.parse(readFileSync(process.argv[2] ?? "package-lock.json", "utf8"));
const packages = lock.packages ?? {};

/** Node-Auflösung im Lockfile: erst verschachtelt, dann zur Wurzel hin. */
function resolve(fromPath, name) {
  let dir = fromPath;
  for (;;) {
    const candidate = dir ? `${dir}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!dir) return null;
    const idx = dir.lastIndexOf("/node_modules/");
    dir = idx === -1 ? "" : dir.slice(0, idx);
  }
}

const seen = new Set();
const stack = ["node_modules/prisma"];
while (stack.length > 0) {
  const path = stack.pop();
  if (seen.has(path)) continue;
  const pkg = packages[path];
  if (!pkg) throw new Error(`Nicht im Lockfile: ${path}`);
  seen.add(path);
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) };
  for (const name of Object.keys(deps)) {
    const target = resolve(path, name);
    if (target) stack.push(target);
    else if (!(pkg.optionalDependencies ?? {})[name]) {
      throw new Error(`Abhängigkeit ${name} von ${path} nicht im Lockfile`);
    }
  }
}

// Nur Ordner der obersten Ebene ausgeben; verschachtelte node_modules
// kommen mit ihrem Elternordner mit.
const top = new Set();
for (const path of seen) {
  const rest = path.slice("node_modules/".length);
  const parts = rest.split("/");
  const name = rest.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  top.add(posix.join("node_modules", name));
}
console.log([...top].sort().join("\n"));
