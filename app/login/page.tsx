import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

import { auth, signIn } from "@/lib/auth";

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
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="mb-2 text-2xl font-semibold">Stammbaum</h1>
      <p className="mb-6 text-sm text-stone-500">
        Zugang nur für eingeladene Familienmitglieder.
      </p>

      {error && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          Anmeldung fehlgeschlagen. Diese E-Mail-Adresse ist nicht freigeschaltet
          — bitte beim Administrator melden.
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
            <button className="w-full rounded bg-stone-900 px-4 py-2 text-white hover:bg-stone-700">
              Mit GitHub anmelden
            </button>
          </form>
        )}

        {hasGoogle && (
          <form
            action={async () => {
              "use server";
              await attemptSignIn("google", {});
            }}
          >
            <button className="w-full rounded border border-stone-300 px-4 py-2 hover:bg-stone-100">
              Mit Google anmelden
            </button>
          </form>
        )}

        {!hasGitHub && !hasGoogle && !devLogin && (
          <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
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
          className="mt-6 rounded border border-dashed border-amber-400 bg-amber-50 p-3"
        >
          <p className="mb-2 text-xs font-medium text-amber-900">
            Dev-Login — nur lokal, ohne Passwort
          </p>
          <input
            name="email"
            type="email"
            required
            placeholder="admin@example.com"
            className="mb-2 w-full rounded border border-amber-300 px-2 py-1 text-sm"
          />
          <button className="w-full rounded bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-700">
            Anmelden
          </button>
        </form>
      )}
    </div>
  );
}
