/**
 * Abwehr gegen SSRF: Bilder von Adressen aus einer hochgeladenen Datei
 * serverseitig holen, ohne dass die Datei den Server ins eigene Netz
 * (NAS-Oberfläche, Router, Cloud-Metadaten …) schicken kann.
 *
 * - nur https, nur Port 443, keine Zugangsdaten in der Adresse;
 * - der Name wird EINMAL aufgelöst, ALLE Adressen müssen öffentlich sein
 *   (kein Loopback, privat, link-local inkl. 169.254.169.254, CGNAT,
 *   Multicast, reserviert, Dokumentationsnetze, IPv6-ULA/link-local, auf
 *   IPv4 abgebildete bzw. NAT64-Adressen werden auf die IPv4 geprüft);
 * - die Verbindung geht genau an die geprüfte Adresse (eigener `lookup`,
 *   die Gegenstelle des Sockets wird nachgeprüft) — DNS-Rebinding zwischen
 *   Prüfung und Verbindung greift nicht; TLS prüft weiter das Zertifikat
 *   des Namens;
 * - Weiterleitungen manuell, höchstens `maxRedirects`, jede neu geprüft;
 * - Größe (gezählt beim Lesen), Inhaltsart (image/*), Gesamtzeit begrenzt.
 * Die eigentliche Bildprüfung macht danach sharp (lib/media-processing.ts).
 */
import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import type { IncomingMessage } from "node:http";

export class SafeFetchError extends Error {
  constructor(
    readonly code:
      | "URL"
      | "PROTOCOL"
      | "PORT"
      | "CREDENTIALS"
      | "DNS"
      | "BLOCKED_ADDRESS"
      | "REDIRECT_LIMIT"
      | "STATUS"
      | "CONTENT_TYPE"
      | "TOO_LARGE"
      | "TIMEOUT"
      | "NETWORK",
    message: string,
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export type TransportResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Buffer | Uint8Array>;
  /** Gegenstelle des Sockets (zur Nachprüfung). */
  remoteAddress?: string;
  destroy: () => void;
};
export type Transport = (req: { url: URL; address: ResolvedAddress; signal: AbortSignal; headers: Record<string, string> }) => Promise<TransportResponse>;

export type SafeFetchOptions = {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Erlaubte Inhaltsarten (Präfixe); Standard: image/ und application/octet-stream. */
  contentTypes?: string[];
  resolver?: Resolver;
  transport?: Transport;
};

export type SafeFetchResult = {
  bytes: Buffer;
  contentType: string;
  finalUrl: string;
  address: string;
  redirects: string[];
};

// ---------------------------------------------------------------------------
// Adressprüfung
// ---------------------------------------------------------------------------

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, p) => (acc << 8) + Number(p), 0) >>> 0;
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function v4Public(ip: string): boolean {
  const n = v4ToInt(ip);
  for (const [base, bits] of V4_BLOCKED) {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    if ((n & mask) === (v4ToInt(base) & mask)) return false;
  }
  return true;
}

/** IPv6 in 8 Gruppen à 16 Bit (auch mit eingebetteter IPv4). */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    if (!net.isIPv4(v4[1])) return null;
    const n = v4ToInt(v4[1]);
    s = s.slice(0, s.length - v4[1].length) + `${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const parts = s.split("::");
  if (parts.length > 2) return null;
  const parse = (x: string) => (x ? x.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)) : []);
  const a = parse(parts[0]);
  const b = parts.length === 2 ? parse(parts[1]) : [];
  const missing = 8 - a.length - b.length;
  if (missing < 0 || (parts.length === 1 && missing !== 0)) return null;
  const groups = [...a, ...Array(parts.length === 2 ? missing : 0).fill(0), ...b];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** Ist die Adresse öffentlich erreichbar (kein internes Ziel)? */
export function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return v4Public(ip);
  if (!net.isIPv6(ip)) return false;
  const g = v6Groups(ip);
  if (!g) return false;
  const embedded = () => `${g[6] >>> 8}.${g[6] & 0xff}.${g[7] >>> 8}.${g[7] & 0xff}`;
  if (g.every((x) => x === 0)) return false; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4Public(embedded()); // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return false; // ::a.b.c.d (veraltet)
  if (g[0] === 0x64 && g[1] === 0xff9b) return v4Public(embedded()); // NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 ULA
  if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return false; // fec0::/10 site-local
  if ((g[0] & 0xff00) === 0xff00) return false; // Multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // Dokumentation
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return false; // Discard
  if (g[0] === 0x2002) return v4Public(`${g[1] >>> 8}.${g[1] & 0xff}.${g[2] >>> 8}.${g[2] & 0xff}`); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return false; // Teredo
  return true;
}

// ---------------------------------------------------------------------------
// Abruf
// ---------------------------------------------------------------------------

export const defaultResolver: Resolver = async (hostname) => {
  const list = await dns.lookup(hostname, { all: true, verbatim: true });
  return list.map((x) => ({ address: x.address, family: x.family === 6 ? 6 : 4 }));
};

export const httpsTransport: Transport = ({ url, address, signal, headers }) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: "https:",
        hostname: url.hostname,
        servername: net.isIP(url.hostname) ? undefined : url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers,
        agent: false,
        signal,
        // Verbindung genau zur geprüften Adresse (kein zweites DNS).
        lookup: ((_host: string, opts: { all?: boolean }, cb: (...args: unknown[]) => void) => {
          if (opts?.all) cb(null, [{ address: address.address, family: address.family }]);
          else cb(null, address.address, address.family);
        }) as never,
      },
      (res: IncomingMessage) => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: res,
          remoteAddress: res.socket?.remoteAddress,
          destroy: () => res.destroy(),
        });
      },
    );
    req.on("error", reject);
    req.end();
  });

function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError("URL", "Ungültige Adresse");
  }
  if (url.protocol !== "https:") throw new SafeFetchError("PROTOCOL", "Nur https-Adressen werden abgerufen");
  if (url.username || url.password) throw new SafeFetchError("CREDENTIALS", "Adressen mit Zugangsdaten werden nicht abgerufen");
  if (url.port && url.port !== "443") throw new SafeFetchError("PORT", "Nur der Standardport 443 ist erlaubt");
  if (!url.hostname) throw new SafeFetchError("URL", "Adresse ohne Rechnernamen");
  return url;
}

const normAddr = (a: string | undefined) => (a ?? "").replace(/^::ffff:/i, "").toLowerCase();

/**
 * Holt eine Adresse unter den oben beschriebenen Regeln. Wirft
 * SafeFetchError mit deutscher Meldung.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxBytes = options.maxBytes ?? 15 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 3;
  const types = options.contentTypes ?? ["image/", "application/octet-stream"];
  const resolver = options.resolver ?? defaultResolver;
  const transport = options.transport ?? httpsTransport;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  const redirects: string[] = [];
  try {
    let url = checkUrl(rawUrl);
    for (let hop = 0; ; hop++) {
      // Auflösen (einmal je Schritt) und ALLE Adressen prüfen
      let addresses: ResolvedAddress[];
      const literal = url.hostname.replace(/^\[|\]$/g, "");
      if (net.isIP(literal)) addresses = [{ address: literal, family: net.isIPv6(literal) ? 6 : 4 }];
      else {
        try {
          addresses = await resolver(url.hostname);
        } catch {
          throw new SafeFetchError("DNS", "Rechnername nicht auflösbar");
        }
      }
      if (!addresses.length) throw new SafeFetchError("DNS", "Rechnername nicht auflösbar");
      if (addresses.some((a) => !isPublicAddress(a.address))) {
        throw new SafeFetchError("BLOCKED_ADDRESS", "Ziel liegt in einem internen Netz — wird nicht abgerufen");
      }
      const address = addresses[0];
      if (controller.signal.aborted) throw new SafeFetchError("TIMEOUT", "Zeitüberschreitung");
      let res: TransportResponse;
      try {
        res = await transport({
          url,
          address,
          signal: controller.signal,
          headers: { "User-Agent": "Stammbaum-Import/1.0", Accept: "image/*" },
        });
      } catch (err) {
        if (controller.signal.aborted) throw new SafeFetchError("TIMEOUT", "Zeitüberschreitung");
        throw new SafeFetchError("NETWORK", `Verbindung fehlgeschlagen (${(err as Error).message})`);
      }
      if (res.remoteAddress && normAddr(res.remoteAddress) !== normAddr(address.address)) {
        res.destroy();
        throw new SafeFetchError("BLOCKED_ADDRESS", "Verbindung ging an eine andere als die geprüfte Adresse");
      }
      if (res.status >= 300 && res.status < 400) {
        res.destroy();
        const loc = res.headers.location;
        const next = Array.isArray(loc) ? loc[0] : loc;
        if (!next) throw new SafeFetchError("STATUS", `Weiterleitung ohne Ziel (${res.status})`);
        if (hop >= maxRedirects) throw new SafeFetchError("REDIRECT_LIMIT", `Mehr als ${maxRedirects} Weiterleitungen`);
        url = checkUrl(new URL(next, url).toString());
        redirects.push(url.toString());
        continue;
      }
      if (res.status !== 200) {
        res.destroy();
        throw new SafeFetchError("STATUS", `Antwort ${res.status}`);
      }
      const ctRaw = res.headers["content-type"];
      const contentType = (Array.isArray(ctRaw) ? ctRaw[0] : ctRaw ?? "").split(";")[0].trim().toLowerCase();
      if (!types.some((t) => contentType.startsWith(t))) {
        res.destroy();
        throw new SafeFetchError("CONTENT_TYPE", `Inhaltsart nicht erlaubt: ${contentType || "unbekannt"}`);
      }
      const lenRaw = res.headers["content-length"];
      const declared = Number(Array.isArray(lenRaw) ? lenRaw[0] : lenRaw);
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.destroy();
        throw new SafeFetchError("TOO_LARGE", `Datei größer als ${Math.round(maxBytes / 1024 / 1024)} MB`);
      }
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        for await (const chunk of res.body) {
          size += chunk.byteLength;
          if (size > maxBytes) {
            res.destroy();
            throw new SafeFetchError("TOO_LARGE", `Datei größer als ${Math.round(maxBytes / 1024 / 1024)} MB`);
          }
          chunks.push(Buffer.from(chunk));
        }
      } catch (err) {
        if (err instanceof SafeFetchError) throw err;
        if (controller.signal.aborted) throw new SafeFetchError("TIMEOUT", "Zeitüberschreitung");
        throw new SafeFetchError("NETWORK", "Übertragung abgebrochen");
      }
      if (controller.signal.aborted) throw new SafeFetchError("TIMEOUT", "Zeitüberschreitung");
      return { bytes: Buffer.concat(chunks), contentType, finalUrl: url.toString(), address: address.address, redirects };
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Führt Aufgaben mit höchstens `limit` gleichzeitig aus (Reihenfolge der Ergebnisse bleibt). */
export async function withConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
