import NextAuth, { type DefaultSession } from "next-auth";
import type { Provider } from "next-auth/providers";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Role } from "@prisma/client";

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
// NIEMALS in Produktion aktivieren.
if (process.env.ENABLE_DEV_LOGIN === "true") {
  providers.push(
    Credentials({
      id: "dev-login",
      name: "Dev-Login (nur lokal)",
      credentials: { email: { label: "E-Mail", type: "email" } },
      async authorize(credentials) {
        if (process.env.NODE_ENV === "production") return null;
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

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // JWT statt DB-Session, weil der Credentials-Provider (Dev-Login) keine
  // Datenbank-Sessions unterstützt. Rolle wird trotzdem bei jedem Request
  // frisch aus der DB gelesen — siehe jwt-Callback.
  session: { strategy: "jwt" },
  providers,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    /**
     * Das Allowlist-Gate. Ein gültiges Google-/GitHub-Konto allein genügt
     * nicht — die E-Mail muss vom Admin vorher angelegt worden sein.
     */
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;

      const known = await prisma.user.findUnique({ where: { email } });
      if (!known) return false;
      if (known.status === "BLOCKED") return false;

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
        return { ...session, expires: new Date(0).toISOString() };
      }
      session.user.id = token.sub!;
      session.user.role = (token.role as Role) ?? "VIEWER";
      return session;
    },
  },
});

/** Session holen oder Fehler werfen. Für Route-Handler und Server-Actions. */
export async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("UNAUTHENTICATED");
  return session;
}
