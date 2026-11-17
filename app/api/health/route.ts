import { prisma } from "@/lib/prisma";
import { checkMediaDir } from "@/lib/storage";

/**
 * Lebenszeichen für Container-Healthchecks und den Reverse-Proxy.
 *
 * Bewusst ohne Anmeldung und ohne Inhalt: Antwort ist nur "ok" (200) oder
 * "error" (503). Keine Versionen, keine Fehlermeldungen, keine Zählungen —
 * Details landen ausschließlich im Server-Log.
 *
 * Geprüft wird die Datenbank und, ob der Medienordner (MEDIA_DIR) samt
 * originals/ und thumbs/ beschreibbar ist — falsche Ordnerrechte auf der NAS
 * fallen sonst erst beim ersten Bild-Upload auf.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIMEOUT_MS = 3000;

const HEADERS = { "Cache-Control": "no-store" };

/** Erste Zeile der Fehlermeldung, ergänzt um den Fehlercode (z.B. EACCES), falls nicht schon enthalten. */
function oneLine(err: unknown): string {
  const message = (err instanceof Error ? err.message : String(err)).split("\n")[0].trim();
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && !message.includes(code) ? `${message} (${code})` : message;
}

async function check(name: string, task: () => Promise<unknown>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      task(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Zeitüberschreitung")), TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch (err) {
    // Eine Zeile je Fehlschlag: der Healthcheck läuft alle 30 s, ein
    // mehrzeiliger Stack samt cause würde das Log fluten. MediaDirError nennt
    // Ordner und Fehlercode bereits in der Meldung.
    console.error(`[health] ${name}: ${oneLine(err)}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const results = await Promise.all([
    check("Datenbank nicht erreichbar", () => prisma.$queryRaw`SELECT 1`),
    // Der Fehler nennt den betroffenen Ordner (Wurzel, originals/, thumbs/).
    check("Medienordner", checkMediaDir),
  ]);
  if (results.every(Boolean)) {
    return Response.json({ status: "ok" }, { headers: HEADERS });
  }
  return Response.json({ status: "error" }, { status: 503, headers: HEADERS });
}
