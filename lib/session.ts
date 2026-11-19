import { redirect } from "next/navigation";

import { auth } from "./auth";
import { can, type Action } from "./authz";
import { loadScope } from "./scope";

/**
 * Für Server-Components. Bewusst kein middleware.ts: Auth.js bräuchte dort
 * eine edge-taugliche Config ohne Prisma, und die Prüfung an der echten
 * Datenquelle (hier und in lib/api.ts) ist ohnehin die verbindliche.
 *
 * `action` prüft nur globale Verwaltungsrechte. Ob eine bestimmte Person
 * sichtbar ist, hängt von deren Familien ab und wird über den Scope geprüft.
 */
export async function requirePage(action?: Action) {
  const session = await auth();

  if (!session?.user?.id) redirect("/login");
  if (action && !can(session.user.role, action)) redirect("/tree?denied=1");

  return session;
}

/** Session samt Familienrechten — für alle inhaltlichen Seiten. */
export async function requireScope() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const scope = await loadScope(session.user.id, session.user.role);
  return { session, scope };
}
