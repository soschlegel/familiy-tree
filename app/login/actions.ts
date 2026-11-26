"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { signIn } from "@/lib/auth";
import {
  EMAIL_LOGIN_REDIRECT,
  EMAIL_PROVIDER_ID,
  clientAddressFromHeaders,
  emailLoginMode,
  requestEmailLink,
} from "@/lib/email-login";
import { prisma } from "@/lib/prisma";

/**
 * „Link zusenden“ auf der Anmeldeseite. Antwortet IMMER gleich (Weiterleitung
 * auf die neutrale Bestätigung) — Regeln in requestEmailLink
 * (lib/email-login.ts).
 */
export async function requestLoginLink(formData: FormData): Promise<void> {
  if (!emailLoginMode()) redirect("/login");
  const ip = clientAddressFromHeaders(await headers());
  const outcome = await requestEmailLink(formData.get("email"), ip, {
    findUser: (email) => prisma.user.findUnique({ where: { email }, select: { status: true } }),
    async sendLink(email) {
      // Ruft Auth.js direkt auf (nicht über die HTTP-Route, die das Anfordern
      // von außen sperrt). Auth.js prüft im signIn-Callback erneut die
      // Benutzerliste, legt das gehashte Token an und stellt die Mail zu.
      await signIn(EMAIL_PROVIDER_ID, { email, redirect: false, redirectTo: EMAIL_LOGIN_REDIRECT });
    },
    log: (message) => console.error(message),
  });
  if (outcome === "throttled") console.warn("[email-login] Anforderung gedrosselt.");
  redirect("/login?link=gesendet");
}
