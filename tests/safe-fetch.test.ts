/**
 * SSRF-Schutz beim Herunterladen von Fotos aus einer Importdatei
 * (lib/safe-fetch.ts). Ohne echtes Netz: Namensauflösung und Verbindung sind
 * eingespritzt; geprüft wird, was der Abruf mit Adressen, Weiterleitungen,
 * Größen, Inhaltsarten und Zeitlimits macht.
 */
import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { isPublicAddress, safeFetch, SafeFetchError, withConcurrency, type ResolvedAddress, type Transport } from "@/lib/safe-fetch";

const PUBLIC: ResolvedAddress = { address: "93.184.216.34", family: 4 };
const resolveTo = (...addresses: string[]) =>
  vi.fn(async () => addresses.map((a) => ({ address: a, family: (a.includes(":") ? 6 : 4) as 4 | 6 })));

function respond(status: number, headers: Record<string, string>, body: Buffer | Buffer[] = Buffer.alloc(0), remote?: string): Awaited<ReturnType<Transport>> {
  return {
    status,
    headers,
    body: Readable.from(Array.isArray(body) ? body : [body]),
    remoteAddress: remote,
    destroy: () => {},
  };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (err) {
    if (err instanceof SafeFetchError) return err.code;
    throw err;
  }
}

describe("isPublicAddress", () => {
  it.each([
    ["127.0.0.1", false],
    ["10.1.2.3", false],
    ["172.16.0.1", false],
    ["172.31.255.255", false],
    ["172.32.0.1", true],
    ["192.168.1.10", false],
    ["169.254.169.254", false], // Cloud-Metadaten
    ["100.64.0.1", false], // CGNAT
    ["0.0.0.0", false],
    ["224.0.0.1", false],
    ["255.255.255.255", false],
    ["198.18.0.1", false],
    ["8.8.8.8", true],
    ["93.184.216.34", true],
    ["::1", false],
    ["::", false],
    ["fe80::1", false],
    ["fc00::1", false],
    ["fd12:3456::1", false],
    ["ff02::1", false],
    ["::ffff:127.0.0.1", false],
    ["::ffff:7f00:1", false],
    ["::ffff:8.8.8.8", true],
    ["64:ff9b::a9fe:a9fe", false], // NAT64 auf 169.254.169.254
    ["2002:7f00:1::", false], // 6to4 auf 127.0.0.1
    ["2001:db8::1", false],
    ["2606:4700:4700::1111", true],
    ["kein-ip", false],
  ])("%s → %s", (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected);
  });
});

describe("safeFetch", () => {
  const okTransport = vi.fn<Transport>(async () => respond(200, { "content-type": "image/jpeg" }, Buffer.from("bild")));

  it("holt ein Bild über die geprüfte Adresse", async () => {
    const transport = vi.fn<Transport>(async () => respond(200, { "content-type": "image/jpeg" }, Buffer.from("bild"), "93.184.216.34"));
    const r = await safeFetch("https://bilder.example.test/a.jpg", { resolver: resolveTo("93.184.216.34"), transport });
    expect(r.bytes.toString()).toBe("bild");
    expect(transport.mock.calls[0][0].address).toEqual(PUBLIC);
    expect(transport.mock.calls[0][0].url.hostname).toBe("bilder.example.test");
  });

  it.each([
    ["http://bilder.example.test/a.jpg", "PROTOCOL"],
    ["ftp://bilder.example.test/a.jpg", "PROTOCOL"],
    ["file:///etc/passwd", "PROTOCOL"],
    ["https://nutzer:pass@bilder.example.test/a.jpg", "CREDENTIALS"],
    ["https://bilder.example.test:8443/a.jpg", "PORT"],
    ["kein url", "URL"],
    ["https://127.0.0.1/a.jpg", "BLOCKED_ADDRESS"],
    ["https://[::1]/a.jpg", "BLOCKED_ADDRESS"],
    ["https://169.254.169.254/latest/meta-data", "BLOCKED_ADDRESS"],
  ])("%s → %s", async (url, expected) => {
    expect(await code(safeFetch(url, { resolver: resolveTo("93.184.216.34"), transport: okTransport }))).toBe(expected);
  });

  it("Name, der (auch nur teilweise) auf ein internes Netz zeigt, wird nicht abgerufen", async () => {
    const transport = vi.fn<Transport>();
    expect(await code(safeFetch("https://intern.example.test/a.jpg", { resolver: resolveTo("192.168.1.2"), transport }))).toBe("BLOCKED_ADDRESS");
    expect(await code(safeFetch("https://gemischt.example.test/a.jpg", { resolver: resolveTo("93.184.216.34", "10.0.0.5"), transport }))).toBe("BLOCKED_ADDRESS");
    expect(transport).not.toHaveBeenCalled();
  });

  it("DNS-Rebinding: aufgelöst wird einmal je Schritt, verbunden wird mit genau dieser Adresse", async () => {
    let calls = 0;
    const resolver = vi.fn(async () => [{ address: calls++ === 0 ? "93.184.216.34" : "127.0.0.1", family: 4 as const }]);
    const transport = vi.fn<Transport>(async () => respond(200, { "content-type": "image/png" }, Buffer.from("x")));
    await safeFetch("https://rebind.example.test/a.png", { resolver, transport });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0].address.address).toBe("93.184.216.34");
  });

  it("Verbindung an eine andere als die geprüfte Adresse wird verworfen", async () => {
    const transport = vi.fn<Transport>(async () => respond(200, { "content-type": "image/png" }, Buffer.from("x"), "10.0.0.1"));
    expect(await code(safeFetch("https://a.example.test/x.png", { resolver: resolveTo("93.184.216.34"), transport }))).toBe("BLOCKED_ADDRESS");
  });

  it("Weiterleitungen werden neu geprüft (Ziel intern, http, zu viele)", async () => {
    const redirectTo = (loc: string) => vi.fn<Transport>(async () => respond(302, { location: loc }));
    const resolver = vi.fn(async (host: string) => [{ address: host.startsWith("intern") ? "10.0.0.1" : "93.184.216.34", family: 4 as const }]);
    expect(await code(safeFetch("https://a.example.test/x", { resolver, transport: redirectTo("https://intern.example.test/") }))).toBe("BLOCKED_ADDRESS");
    expect(await code(safeFetch("https://a.example.test/x", { resolver, transport: redirectTo("http://b.example.test/") }))).toBe("PROTOCOL");
    expect(await code(safeFetch("https://a.example.test/x", { resolver, transport: redirectTo("https://127.0.0.1/") }))).toBe("BLOCKED_ADDRESS");
    expect(await code(safeFetch("https://a.example.test/x", { resolver, transport: redirectTo("https://b.example.test/"), maxRedirects: 3 }))).toBe("REDIRECT_LIMIT");
    // erlaubte Weiterleitung
    let n = 0;
    const transport = vi.fn<Transport>(async () => (n++ === 0 ? respond(301, { location: "/neu.jpg" }) : respond(200, { "content-type": "image/jpeg" }, Buffer.from("ok"))));
    const r = await safeFetch("https://a.example.test/alt.jpg", { resolver, transport });
    expect(r.finalUrl).toBe("https://a.example.test/neu.jpg");
    expect(r.redirects).toHaveLength(1);
    expect(resolver).toHaveBeenCalledWith("a.example.test");
  });

  it("Inhaltsart, Statuscode, Größe (angegeben und tatsächlich)", async () => {
    const resolver = resolveTo("93.184.216.34");
    const t = (status: number, headers: Record<string, string>, body: Buffer | Buffer[] = Buffer.from("x")) => vi.fn<Transport>(async () => respond(status, headers, body));
    expect(await code(safeFetch("https://a.example.test/x", { resolver, transport: t(200, { "content-type": "text/html" }) }))).toBe("CONTENT_TYPE");
    expect(await code(safeFetch("https://a.example.test/x", { resolver, transport: t(200, {}) }))).toBe("CONTENT_TYPE");
    expect(await code(safeFetch("https://a.example.test/x", { resolver, transport: t(404, { "content-type": "image/png" }) }))).toBe("STATUS");
    expect(
      await code(safeFetch("https://a.example.test/x", { resolver, maxBytes: 10, transport: t(200, { "content-type": "image/png", "content-length": "11" }) })),
    ).toBe("TOO_LARGE");
    expect(
      await code(safeFetch("https://a.example.test/x", { resolver, maxBytes: 10, transport: t(200, { "content-type": "image/png" }, [Buffer.alloc(6), Buffer.alloc(6)]) })),
    ).toBe("TOO_LARGE");
  });

  it("Zeitlimit", async () => {
    const transport: Transport = ({ signal }) =>
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("abgebrochen"))));
    expect(await code(safeFetch("https://langsam.example.test/x", { resolver: resolveTo("93.184.216.34"), transport, timeoutMs: 50 }))).toBe("TIMEOUT");
  });

  it("Nicht auflösbarer Name", async () => {
    const resolver = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    });
    expect(await code(safeFetch("https://gibtsnicht.example.test/x", { resolver, transport: okTransport }))).toBe("DNS");
  });
});

describe("withConcurrency", () => {
  it("höchstens n gleichzeitig, Reihenfolge der Ergebnisse bleibt", async () => {
    let running = 0;
    let max = 0;
    const out = await withConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (x) => {
      running++;
      max = Math.max(max, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return x * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(max).toBe(3);
  });
});
