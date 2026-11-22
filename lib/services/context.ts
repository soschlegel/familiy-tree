import { prisma } from "../prisma";
import { loadScope, type Scope } from "../scope";

/**
 * Scope für Aufrufer außerhalb von Next.js (Skripte, MCP-Server), die einen
 * Benutzer über seine E-Mail-Adresse identifizieren. Liefert null für
 * unbekannte und gesperrte Benutzer — dieselbe Regel wie bei der Anmeldung
 * (lib/auth.ts).
 */
export async function scopeForEmail(email: string): Promise<Scope | null> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, role: true, status: true },
  });
  if (!user || user.status === "BLOCKED") return null;
  return loadScope(user.id, user.role);
}
