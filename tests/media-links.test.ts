/**
 * Bilder an Ereignissen, Belegen und Quellen — Teile ohne Datenbank:
 * base64-Eingang (Größe, Format), Abruf per Adresse über lib/safe-fetch.ts
 * (abgelehnte interne Adressen, Weiterleitungen, Typ, Größe — ohne echtes
 * Netz: Resolver und Transport sind ersetzt) und die Regel, wo ein Bild einer
 * Quelle erscheint.
 */
import { describe, expect, it } from "vitest";

import {
  decodeBase64Image,
  fetchImageFromUrl,
  inheritedSourceImages,
  mediaErrorReason,
  type AttachedImage,
} from "@/lib/services";
import type { ResolvedAddress, Transport } from "@/lib/safe-fetch";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function reason(p: Promise<unknown> | (() => unknown)): Promise<string | null> {
  try {
    await (typeof p === "function" ? p() : p);
    return null;
  } catch (err) {
    return mediaErrorReason(err) ?? `other: ${(err as Error).message}`;
  }
}

describe("decodeBase64Image", () => {
  it("dekodiert base64 und data:-URLs (Typangabe nur als Angabe)", () => {
    const plain = decodeBase64Image(PNG.toString("base64"));
    expect(plain.bytes.equals(PNG)).toBe(true);
    expect(plain.declaredMime).toBeNull();
    const url = decodeBase64Image(`data:image/png;base64,${PNG.toString("base64")}`);
    expect(url.bytes.equals(PNG)).toBe(true);
    expect(url.declaredMime).toBe("image/png");
    // Zeilenumbrüche und base64url werden angenommen
    const wrapped = PNG.toString("base64").replace(/(.{20})/g, "$1\n").replace(/\+/g, "-").replace(/\//g, "_");
    expect(decodeBase64Image(wrapped).bytes.equals(PNG)).toBe(true);
  });

  it("lehnt Ungültiges und Leeres ab", async () => {
    expect(await reason(() => decodeBase64Image(""))).toBe("DATA");
    expect(await reason(() => decodeBase64Image("not base64!"))).toBe("DATA");
    expect(await reason(() => decodeBase64Image("A"))).toBe("DATA");
  });

  it("prüft die Größe vor dem Dekodieren (MAX_UPLOAD_BYTES)", async () => {
    const big = Buffer.alloc(2048, 1).toString("base64");
    expect(await reason(() => decodeBase64Image(big, 1024))).toBe("TOO_LARGE");
    expect(decodeBase64Image(big, 4096).bytes.byteLength).toBe(2048);
  });
});

// ---------------------------------------------------------------------------
// Abruf per Adresse (Weg 1) — nur über safe-fetch, hier ohne echtes Netz
// ---------------------------------------------------------------------------

function resolverFor(map: Record<string, string[]>) {
  return async (host: string): Promise<ResolvedAddress[]> => {
    const list = map[host];
    if (!list) throw new Error("ENOTFOUND");
    return list.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
}

/** Transport-Attrappe: Antworten je Adresse (url → Antwort), zählt Aufrufe. */
function fakeTransport(
  responses: Record<string, { status: number; headers?: Record<string, string>; body?: Buffer }>,
  calls: string[] = [],
): Transport {
  return async ({ url, address }) => {
    calls.push(`${url.toString()}@${address.address}`);
    const r = responses[url.toString()];
    if (!r) throw new Error("unerwartete Anfrage");
    const body = r.body ?? Buffer.alloc(0);
    return {
      status: r.status,
      headers: r.headers ?? {},
      body: (async function* () {
        yield body;
      })(),
      remoteAddress: address.address,
      destroy: () => {},
    };
  };
}

describe("fetchImageFromUrl (Weg 1: per Adresse, SSRF-Schutz)", () => {
  const publicHost = { "bilder.example": ["93.184.216.34"] };

  it("holt ein Bild von einer öffentlichen https-Adresse, Dateiname aus der Adresse", async () => {
    const calls: string[] = [];
    const res = await fetchImageFromUrl("https://bilder.example/scans/taufe%201850.png", {
      resolver: resolverFor(publicHost),
      transport: fakeTransport(
        { "https://bilder.example/scans/taufe%201850.png": { status: 200, headers: { "content-type": "image/png" }, body: PNG } },
        calls,
      ),
    });
    expect(res.bytes.equals(PNG)).toBe(true);
    expect(res.fileName).toBe("taufe 1850.png");
    expect(calls).toEqual(["https://bilder.example/scans/taufe%201850.png@93.184.216.34"]);
  });

  it.each([
    ["Loopback", "127.0.0.1"],
    ["privates Netz", "10.0.0.5"],
    ["Heimnetz", "192.168.1.10"],
    ["Cloud-Metadaten", "169.254.169.254"],
    ["IPv6 Loopback", "::1"],
    ["IPv6 ULA", "fd00::1"],
    ["auf IPv4 abgebildet", "::ffff:10.1.2.3"],
  ])("lehnt interne Adressen ab, ohne zu verbinden: %s", async (_label, address) => {
    const calls: string[] = [];
    const err = await reason(
      fetchImageFromUrl("https://intern.example/bild.png", {
        resolver: resolverFor({ "intern.example": [address] }),
        transport: fakeTransport({}, calls),
      }),
    );
    expect(err).toBe("FETCH");
    expect(calls).toEqual([]);
  });

  it("lehnt einen Namen ab, wenn auch nur EINE seiner Adressen intern ist", async () => {
    const calls: string[] = [];
    const err = await reason(
      fetchImageFromUrl("https://gemischt.example/bild.png", {
        resolver: resolverFor({ "gemischt.example": ["93.184.216.34", "127.0.0.1"] }),
        transport: fakeTransport({}, calls),
      }),
    );
    expect(err).toBe("FETCH");
    expect(calls).toEqual([]);
  });

  it("lehnt IP-Literale im Heimnetz, http, fremde Ports und Zugangsdaten ab", async () => {
    const opts = { resolver: resolverFor(publicHost), transport: fakeTransport({}) };
    for (const url of [
      "https://192.168.178.1/bild.png",
      "https://[::1]/bild.png",
      "http://bilder.example/bild.png",
      "https://bilder.example:8443/bild.png",
      "https://user:pass@bilder.example/bild.png",
      "file:///etc/passwd",
      "kein url",
    ]) {
      expect(await reason(fetchImageFromUrl(url, opts)), url).toBe("FETCH");
    }
  });

  it("prüft jede Weiterleitung neu — eine Umleitung ins Heimnetz wird abgelehnt", async () => {
    const calls: string[] = [];
    const err = await reason(
      fetchImageFromUrl("https://bilder.example/weiter.png", {
        resolver: resolverFor({ ...publicHost, "router.example": ["192.168.0.1"] }),
        transport: fakeTransport(
          { "https://bilder.example/weiter.png": { status: 302, headers: { location: "https://router.example/admin.png" } } },
          calls,
        ),
      }),
    );
    expect(err).toBe("FETCH");
    expect(calls).toHaveLength(1);
  });

  it("lehnt andere Inhaltsarten (HTML-Seite statt Bilddatei) und zu große Dateien ab", async () => {
    const html = await reason(
      fetchImageFromUrl("https://bilder.example/seite", {
        resolver: resolverFor(publicHost),
        transport: fakeTransport({ "https://bilder.example/seite": { status: 200, headers: { "content-type": "text/html" }, body: Buffer.from("<html>") } }),
      }),
    );
    expect(html).toBe("FETCH");
    const big = await reason(
      fetchImageFromUrl("https://bilder.example/gross.png", {
        maxBytes: 10,
        resolver: resolverFor(publicHost),
        transport: fakeTransport({ "https://bilder.example/gross.png": { status: 200, headers: { "content-type": "image/png" }, body: PNG } }),
      }),
    );
    expect(big).toBe("TOO_LARGE");
  });
});

// ---------------------------------------------------------------------------
// Regel: wo erscheint ein Bild der Quelle?
// ---------------------------------------------------------------------------

describe("inheritedSourceImages (Belegbild-Regel)", () => {
  const img = (id: string): AttachedImage => ({ mediaId: id, caption: null, width: null, height: null });
  const citations = [
    { id: "c1", sourceId: "s1" },
    { id: "c2", sourceId: "s1" },
    { id: "c3", sourceId: "s2" },
  ];
  const sourceImages = new Map([
    ["s1", [img("titel"), img("seite12")]],
    ["s2", [img("grabstein")]],
  ]);

  it("ohne Zuordnung an einen Beleg: bei jedem Beleg der Quelle", () => {
    const out = inheritedSourceImages(citations, sourceImages, new Set());
    expect(out.get("c1")?.map((m) => m.mediaId)).toEqual(["titel", "seite12"]);
    expect(out.get("c2")?.map((m) => m.mediaId)).toEqual(["titel", "seite12"]);
    expect(out.get("c3")?.map((m) => m.mediaId)).toEqual(["grabstein"]);
  });

  it("hängt das Bild an einem Beleg derselben Quelle, erscheint es nur dort (als eigenes Bild)", () => {
    const own = new Map([["c1", [img("seite12")]]]);
    const out = inheritedSourceImages(citations, sourceImages, new Set(["s1|seite12"]), own);
    expect(out.get("c1")?.map((m) => m.mediaId)).toEqual(["titel"]);
    expect(out.get("c2")?.map((m) => m.mediaId)).toEqual(["titel"]);
  });

  it("eine Zuordnung an einen Beleg einer ANDEREN Quelle zählt nicht", () => {
    const out = inheritedSourceImages(citations, sourceImages, new Set(["s2|seite12"]));
    expect(out.get("c2")?.map((m) => m.mediaId)).toEqual(["titel", "seite12"]);
  });
});
