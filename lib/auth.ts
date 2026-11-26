import NextAuth, { type DefaultSession } from "next-auth";
import type { Provider } from "next-auth/providers";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import Nodemailer from "next-auth/providers/nodemailer";
import type { Adapter } from "next-auth/adapters";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Role } from "@prisma/client";

import { devLoginAllowed } from "./dev-login";
import {
  EMAIL_LINK_MAX_AGE_SECONDS,
  EMAIL_PROVIDER_ID,
  confirmationUrl,
  emailLoginMode,
  normalizeEmail,
  publicBaseUrl,
  smtpSettings,
  withTokenCleanup,
} from "./email-login";
import { deliverLoginMail } from "./email-login-mail";
import { prisma } from "./prisma";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession["user"];
  }
}

const providers: Provider[] = [];

if (process.env.AUTH_GITHUB_ID) {
  providers.push(
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
  );
}

if (process.env.AUTH_GOOGLE_ID) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
  );
}

// Dev-Login: erlaubt Anmeldung per E-Mail ohne Passwort, damit die App ohne
// Internetverbindung und ohne OAuth-App testbar ist. Greift ebenfalls nur für
// E-Mails, die in der User-Tabelle stehen (siehe signIn-Callback).
// NIEMALS in Produktion aktivieren. In NODE_ENV=production lehnt er jede
// Anmeldung ab — einzige, eng begrenzte Ausnahme ist der Produktions-Build
// der Mock-Umgebung für die E2E-Tests (devLoginAllowed, lib/dev-login.ts).
if (process.env.ENABLE_DEV_LOGIN === "true") {
  providers.push(
    Credentials({
      id: "dev-login",
      name: "Dev-Login (nur lokal)",
      credentials: { email: { label: "E-Mail", type: "email" } },
      async authorize(credentials) {
        if (!devLoginAllowed()) return null;
        const email = String(credentials?.email ?? "")
          .trim()
          .toLowerCase();
        if (!email) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || user.status === "BLOCKED") return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  );
}

// Anmeldung per E-Mail-Link (lib/email-login.ts). Nur, wenn SMTP vollständig
// eingerichtet ist (bzw. in der Mock-Umgebung der Test-Briefkasten erlaubt ist)
// und AUTH_URL gesetzt ist. Das Token speichert Auth.js nur gehasht
// (SHA-256 über Token + AUTH_SECRET) in VerificationToken; das Einlösen
// löscht es. Ein Konto legt dieser Weg nie an: Der signIn-Callback lässt nur
// Adressen aus der Benutzerliste durch, bevor Auth.js einen Benutzer suchen
// oder anlegen würde, und eine Account-Zeile entsteht beim E-Mail-Anbieter nicht.
const emailMode = emailLoginMode();
if (emailMode) {
  const smtp = emailMode === "smtp" ? smtpSettings() : null;
  const base = publicBaseUrl()!;
  providers.push(
    Nodemailer({
      id: EMAIL_PROVIDER_ID,
      // Pflichtangabe des Anbieters; versendet wird in deliverLoginMail.
      server: smtp ? { host: smtp.host, port: smtp.port, secure: smtp.secure } : { jsonTransport: true },
      from: smtp?.from ?? "test-briefkasten@localhost",
      maxAge: EMAIL_LINK_MAX_AGE_SECONDS,
      normalizeIdentifier(identifier) {
        const email = normalizeEmail(identifier);
        if (!email) throw new Error("Ungültige E-Mail-Adresse");
        return email;
      },
      async sendVerificationRequest({ identifier, url }) {
        await deliverLoginMail(identifier, confirmationUrl(url, base));
      },
    }),
  );
}

// Prisma-Adapter mit Aufräumen der Anmeldelinks (withTokenCleanup).
const adapter: Adapter = withTokenCleanup(PrismaAdapter(prisma), async (identifier, now) => {
  await prisma.verificationToken.deleteMany({
    where: { OR: [{ identifier }, { expires: { lt: now } }] },
  });
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  // JWT statt DB-Session, weil der Credentials-Provider (Dev-Login) keine
  // Datenbank-Sessions unterstützt. Rolle wird trotzdem bei jedem Request
  // frisch aus der DB gelesen — siehe jwt-Callback.
  session: { strategy: "jwt" },
  providers,
  pages: {
    signIn: "/login",
    error: "/login",
    // Nur zur Sicherheit: Die Anmeldeseite fordert Links mit redirect:false an
    // und leitet selbst auf die neutrale Bestätigung. Die eingebaute Seite
    // unter /api/auth wäre wegen der strengen CSP der API unbrauchbar.
    verifyRequest: "/login?link=gesendet",
  },
  callbacks: {
    /**
     * Das Allowlist-Gate. Ein gültiges Google-/GitHub-Konto allein genügt
     * nicht — die E-Mail muss vom Admin vorher angelegt worden sein.
     */
    async signIn({ user, email: emailFlow }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;

      const known = await prisma.user.findUnique({ where: { email } });
      if (!known) return false;
      if (known.status === "BLOCKED") return false;

      // E-Mail-Link: Hier wird erst der Link angefordert, angemeldet ist
      // noch niemand. Beim Einlösen läuft der Callback erneut (dann ohne
      // verificationRequest) — wer inzwischen gesperrt ist, kommt nicht hinein.
      if (emailFlow?.verificationRequest) return true;

      await prisma.user.update({
        where: { id: known.id },
        data: {
          status: "ACTIVE",
          lastLoginAt: new Date(),
          name: known.name ?? user.name,
          image: known.image ?? user.image,
        },
      });

      return true;
    },

    async jwt({ token }) {
      if (!token.email) return token;

      // Bei jedem Request neu laden: so wirken Rollenwechsel und Sperrungen
      // sofort, ohne dass sich der Nutzer neu anmelden muss. Bei <10 Nutzern
      // ist der Query-Overhead irrelevant.
      const user = await prisma.user.findUnique({
        where: { email: token.email.toLowerCase() },
        select: { id: true, role: true, status: true, name: true, image: true },
      });

      if (!user || user.status === "BLOCKED") {
        token.blocked = true;
        return token;
      }

      token.blocked = false;
      token.sub = user.id;
      token.role = user.role;
      token.name = user.name;
      token.picture = user.image;
      return token;
    },

    async session({ session, token }) {
      if (token.blocked) {
        // Erzwingt einen ungültigen Zustand -> Nutzer landet auf /login.
        // `user` ausdrücklich leeren: auth() in Server-Components ergänzt
        // sonst den Token als `user` (next-auth: `{ user, ...session }`). Die
        // Login-Seite hielt die Sitzung dann für gültig und schickte zurück
        // zum Baum, der wieder zur Anmeldung — eine Weiterleitungsschleife.
        return { user: undefined, expires: new Date(0).toISOString() } as unknown as typeof session;
      }
      session.user.id = token.sub!;
      session.user.role = (token.role as Role) ?? "VIEWER";
      return session;
    },
  },
});
