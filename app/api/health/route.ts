import { prisma } from "@/lib/prisma";

/**
 * Lebenszeichen für Container-Healthchecks und den Reverse-Proxy.
 *
 * Bewusst ohne Anmeldung und ohne Inhalt: Antwort ist nur "ok" (200) oder
 * "error" (503). Keine Versionen, keine Fehlermeldungen, keine Zählungen —
 * Details landen ausschließlich im Server-Log.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIMEOUT_MS = 3000;

const HEADERS = { "Cache-Control": "no-store" };

export async function GET() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Zeitüberschreitung")), TIMEOUT_MS);
      }),
    ]);
    return Response.json({ status: "ok" }, { headers: HEADERS });
  } catch (err) {
    console.error("[health] Datenbank nicht erreichbar:", err);
    return Response.json({ status: "error" }, { status: 503, headers: HEADERS });
  } finally {
    clearTimeout(timer);
  }
}
