import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createTransport, type Transporter } from "nodemailer";

import { emailLoginMode, loginMail, smtpSettings, type SmtpSettings } from "./email-login";
import { mediaDir } from "./storage";

/**
 * Zustellung der Anmeldelinks (lib/email-login.ts). Zwei Wege:
 *
 * - **SMTP** über das eigene Postfach (`SMTP_*`). Der Versand läuft im
 *   Hintergrund: Die Anmeldeseite wartet nicht auf den Mailserver, damit die
 *   Antwortzeit nichts darüber verrät, ob eine Mail hinausging. Fehler landen
 *   nur im Server-Protokoll (ohne Adresse).
 * - **Test-Briefkasten** (nur Mock-Umgebung, `mailTestOutboxAllowed`): Die
 *   Mail wird als JSON-Datei in `MEDIA_DIR/mail-outbox/` abgelegt, damit
 *   Playwright den Link lesen kann. Nie ein echter Versand.
 */

/** Unterordner des Test-Briefkastens im (Mock-)Medienordner. */
export const OUTBOX_SUBDIR = "mail-outbox";

export type OutboxMail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  url: string;
  createdAt: string;
};

let cached: { key: string; transport: Transporter } | null = null;

function smtpTransport(s: SmtpSettings): Transporter {
  const key = JSON.stringify([s.host, s.port, s.secure, s.user, s.password]);
  if (cached?.key !== key) {
    cached = {
      key,
      transport: createTransport({
        host: s.host,
        port: s.port,
        secure: s.secure,
        auth: { user: s.user, pass: s.password },
        // Kein Klartext-Passwort über eine unverschlüsselte Verbindung.
        requireTLS: !s.secure,
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
      }),
    };
  }
  return cached.transport;
}

/** Stellt einen Anmeldelink zu (Aufruf aus `sendVerificationRequest`, lib/auth.ts). */
export async function deliverLoginMail(to: string, url: string): Promise<void> {
  const mode = emailLoginMode();
  const mail = loginMail(url);

  if (mode === "outbox") {
    const dir = path.join(mediaDir(), OUTBOX_SUBDIR);
    await mkdir(dir, { recursive: true });
    const entry: OutboxMail = { to, ...mail, url, createdAt: new Date().toISOString() };
    await writeFile(path.join(dir, `${Date.now()}-${randomUUID()}.json`), JSON.stringify(entry, null, 2), "utf8");
    return;
  }

  const settings = mode === "smtp" ? smtpSettings() : null;
  if (!settings) throw new Error("E-Mail-Anmeldung ist nicht eingerichtet.");

  void smtpTransport(settings)
    .sendMail({ from: settings.from, to, subject: mail.subject, text: mail.text, html: mail.html })
    .then((info) => {
      const failed = [...(info.rejected ?? []), ...(info.pending ?? [])];
      if (failed.length) console.error("[email-login] Mailserver hat den Anmeldelink nicht angenommen.");
    })
    .catch((error: unknown) => {
      console.error(`[email-login] Versand fehlgeschlagen: ${(error as Error)?.message ?? String(error)}`);
    });
}
