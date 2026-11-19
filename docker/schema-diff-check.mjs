// Prüft ein SQL-Skript aus `prisma migrate diff --script` (über stdin) darauf,
// ob es rein ergänzend ist. Werkzeug für die Entwicklung, nicht im Image:
// eine neue Migration vor dem Commit prüfen (README, "Schema und Migrationen"):
//   node docker/schema-diff-check.mjs < prisma/migrations/<name>/migration.sql
//
// Ergänzend:  CREATE TABLE/TYPE/INDEX, ADD COLUMN, ADD CONSTRAINT,
//             ALTER TYPE … ADD VALUE, Standardwerte setzen,
//             NOT NULL aufheben.
// Alles andere (DROP TABLE/COLUMN/TYPE, Typänderungen, Umbenennungen,
// DELETE/UPDATE/TRUNCATE, NOT NULL erzwingen, …) gilt als nicht ergänzend.
//
// Exit-Code 0 = rein ergänzend (oder leer), 3 = nicht ergänzend. Die
// beanstandeten Anweisungen gehen auf stdout.

const SAFE = [
  /^CREATE\s+(TABLE|TYPE|SEQUENCE|EXTENSION|SCHEMA)\b/i,
  /^CREATE\s+(UNIQUE\s+)?INDEX\b/i,
  /^ALTER\s+TYPE\s+\S+\s+ADD\s+VALUE\b/i,
];

// Erlaubte Teilschritte einer ALTER TABLE-Anweisung (durch Kommas getrennt).
const SAFE_ALTER_TABLE_ACTION = [
  /^ADD\b/i, // ADD COLUMN, ADD CONSTRAINT (Fremdschlüssel, Primärschlüssel)
  /^ALTER\s+(COLUMN\s+)?\S+\s+SET\s+DEFAULT\b/i,
  /^ALTER\s+(COLUMN\s+)?\S+\s+DROP\s+NOT\s+NULL\b/i,
];

const input = await new Promise((resolve) => {
  let data = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (data += c));
  process.stdin.on("end", () => resolve(data));
});

/** Entfernt Kommentare und teilt in Anweisungen (Prisma erzeugt keine $$-Blöcke). */
function statements(sql) {
  const withoutComments = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
  return withoutComments
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Teilt die Aktionen einer ALTER TABLE-Anweisung auf, Klammern beachtend. */
function alterTableActions(stmt) {
  const m = stmt.match(/^ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?("[^"]+"|\S+)(?:\."[^"]+"|\.\S+)?\s+(.*)$/i);
  if (!m) return null;
  const body = m[2];
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function isSafe(stmt) {
  if (SAFE.some((re) => re.test(stmt))) return true;
  if (/^ALTER\s+TABLE\b/i.test(stmt)) {
    const actions = alterTableActions(stmt);
    if (!actions || actions.length === 0) return false;
    return actions.every((a) => SAFE_ALTER_TABLE_ACTION.some((re) => re.test(a)));
  }
  return false;
}

const unsafe = statements(input).filter((s) => !isSafe(s));
if (unsafe.length > 0) {
  for (const s of unsafe) console.log(`  ${s};`);
  process.exit(3);
}
