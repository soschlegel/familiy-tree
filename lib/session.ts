import { redirect } from "next/navigation";

import { auth } from "./auth";
import { can, type Action } from "./authz";

/**
 * Für Server-Components. Bewusst kein middleware.ts: Auth.js bräuchte dort
 * eine edge-taugliche Config ohne Prisma, und die Prüfung an der echten
 * Datenquelle (hier und in lib/api.ts) ist ohnehin die verbindliche.
 */
export async function requirePage(action?: Action) {
  const session = await auth();

  if (!session?.user?.id) redirect("/login");
  if (action && !can(session.user.role, action)) redirect("/tree?denied=1");

  return session;
}
