import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { EMAIL_LINK_MINUTES, callbackActionPath, emailLoginMode, plausibleLinkParams } from "@/lib/email-login";

export const metadata = { title: "Mit E-Mail-Link anmelden" };

/**
 * Ziel des Links aus der Anmelde-Mail. Löst den Link NICHT beim Aufruf ein:
 * Mail-Programme und Virenscanner rufen Links oft vorab ab und würden ihn
 * sonst verbrauchen. Erst der Knopf „Jetzt anmelden“ schickt Token und
 * Adresse per POST an Auth.js (/api/auth/callback/nodemailer); das prüft das
 * gehashte Token, löscht es und meldet an. Abgelaufen/verbraucht → /login
 * mit Fehler „Verification“.
 */
export default async function EmailLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[]; email?: string | string[] }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/tree");

  const { token, email } = await searchParams;
  const enabled = emailLoginMode() !== null;
  const ok = enabled && plausibleLinkParams(token, email);

  return (
    <div className="mx-auto mt-6 max-w-md space-y-5 rounded-3xl border border-stone-200 bg-surface p-8 shadow-lift sm:mt-12 sm:p-10 dark:border-stone-800">
      <h1 className="font-serif text-2xl font-semibold">Mit E-Mail-Link anmelden</h1>

      {ok ? (
        <>
          <p className="text-sm">
            Du meldest dich an als <strong className="break-all">{email as string}</strong>.
          </p>
          <form method="post" action={callbackActionPath(token as string, email as string)}>
            <button className="btn-primary w-full py-2.5">Jetzt anmelden</button>
          </form>
          <p className="text-xs muted">
            Der Link gilt {EMAIL_LINK_MINUTES} Minuten nach dem Anfordern und
            nur einmal. Warst du das nicht, schließ diese Seite einfach.
          </p>
        </>
      ) : (
        <>
          <p role="alert" className="alert-error">
            {enabled
              ? "Dieser Anmeldelink ist unvollständig. Kopiere ihn ganz aus der E-Mail oder fordere einen neuen an."
              : "Die Anmeldung per E-Mail-Link ist hier nicht eingerichtet."}
          </p>
          <Link href={enabled ? "/login#link-email" : "/login"} className="btn-secondary w-full py-2.5">
            {enabled ? "Neuen Link anfordern" : "Zur Anmeldung"}
          </Link>
        </>
      )}
    </div>
  );
}
