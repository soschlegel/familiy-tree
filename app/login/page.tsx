import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

import { auth, signIn } from "@/lib/auth";
import { BrandMark } from "@/components/NavBar";

export const metadata = { title: "Anmelden" };

/**
 * signIn wirft bei abgelehnter Anmeldung einen AuthError. Ohne dieses Handling
 * schlägt der als Runtime-Fehler durch, statt den Nutzer mit einer Meldung auf
 * der Login-Seite zu lassen. Der Erfolgsfall wirft NEXT_REDIRECT — dieser
 * Fehler MUSS unverändert weiterfliegen, sonst gibt es keine Weiterleitung.
 */
async function attemptSignIn(
  provider: string,
  options: Record<string, unknown>,
) {
  try {
    await signIn(provider, { redirectTo: "/tree", ...options });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/login?error=${error.type}`);
    }
    throw error;
  }
}

/** Dekorative Zweige im Hintergrund — reine Zierde, für Screenreader verborgen. */
function Branches() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 400 400"
      className="pointer-events-none absolute -right-24 -top-24 h-[28rem] w-[28rem] opacity-[0.18] dark:opacity-[0.12]"
    >
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M200 390V250M200 250l-70-60M200 250l70-60M130 190v-60M270 190v-60M130 130l-40-40M130 130l40-40M270 130l-40-40M270 130l40-40" />
      </g>
      <g fill="currentColor">
        {[
          [200, 390], [130, 190], [270, 190], [90, 90], [170, 90], [230, 90], [310, 90],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="9" />
        ))}
      </g>
    </svg>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/tree");

  const { error } = await searchParams;
  const devLogin = process.env.ENABLE_DEV_LOGIN === "true";
  const hasGitHub = Boolean(process.env.AUTH_GITHUB_ID);
  const hasGoogle = Boolean(process.env.AUTH_GOOGLE_ID);

  return (
    <div className="mx-auto mt-6 grid max-w-4xl overflow-hidden rounded-3xl border border-stone-200 bg-surface shadow-lift sm:mt-12 md:grid-cols-2 dark:border-stone-800">
      <div className="relative overflow-hidden bg-accent-800 p-8 text-accent-50 sm:p-10 dark:bg-accent-900">
        <Branches />
        <div className="relative flex h-full flex-col justify-between gap-10">
          <div className="flex items-center gap-3">
            <BrandMark className="h-10 w-10" />
            <span className="font-serif text-xl font-semibold">Stammbaum</span>
          </div>
          <div>
            <p className="font-serif text-3xl font-semibold leading-tight sm:text-4xl">
              Unsere Familie,
              <br />
              <span className="italic text-brass-300">Generation für Generation.</span>
            </p>
            <p className="mt-4 max-w-xs text-sm text-accent-100/90">
              Ein privates Archiv mit Lebensdaten, Verbindungen und Bildern —
              nur für eingeladene Familienmitglieder.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-8 sm:p-10">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Anmelden</h1>
          <p className="mt-1 text-sm muted">
            Zugang nur für eingeladene Familienmitglieder.
          </p>
        </div>

        {error && (
          <p role="alert" className="alert-error">
            Anmeldung fehlgeschlagen. Diese E-Mail-Adresse ist nicht
            freigeschaltet — bitte beim Administrator melden.
          </p>
        )}

        <div className="space-y-2">
          {hasGitHub && (
            <form
              action={async () => {
                "use server";
                await attemptSignIn("github", {});
              }}
            >
              <button className="btn-primary w-full py-2.5">Mit GitHub anmelden</button>
            </form>
          )}

          {hasGoogle && (
            <form
              action={async () => {
                "use server";
                await attemptSignIn("google", {});
              }}
            >
              <button className="btn-secondary w-full py-2.5">Mit Google anmelden</button>
            </form>
          )}

          {!hasGitHub && !hasGoogle && !devLogin && (
            <p className="alert-warning">
              Kein Anmeldeverfahren konfiguriert. Setze AUTH_GITHUB_ID /
              AUTH_GOOGLE_ID oder ENABLE_DEV_LOGIN=true in der .env.
            </p>
          )}
        </div>

        {devLogin && (
          <form
            action={async (formData: FormData) => {
              "use server";
              await attemptSignIn("dev-login", {
                email: String(formData.get("email") ?? ""),
              });
            }}
            className="space-y-2 rounded-xl border border-dashed border-brass-400 bg-brass-100/60 p-4 dark:border-brass-600 dark:bg-brass-700/10"
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-brass-700 dark:text-brass-300">
              Dev-Login — nur lokal, ohne Passwort
            </p>
            <label htmlFor="dev-email" className="field-label">
              E-Mail-Adresse
            </label>
            <input
              id="dev-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="admin@example.com"
              className="field w-full"
            />
            <button className="btn w-full border-brass-600 bg-brass-600 text-white hover:bg-brass-700">
              Anmelden
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
