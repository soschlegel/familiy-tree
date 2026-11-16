import { request as pwRequest, expect, type APIRequestContext } from "@playwright/test";

import { authFile } from "./fixtures";
import type { Role } from "./mock";

const BASE_URL = `http://localhost:${process.env.MOCK_PORT ?? 3100}`;

/** API-Zugang mit den Anmeldedaten einer Rolle (für Testdaten und Aufräumen). */
export async function apiAs(role: Role): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: BASE_URL, storageState: authFile(role) });
}

/** Eindeutiger Zusatz für Testdatensätze, damit Wiederholungen nicht kollidieren. */
export function uniq(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export type CreatedPerson = { id: string; givenName: string; familyName: string | null };

export async function createPerson(
  api: APIRequestContext,
  data: Record<string, unknown>,
): Promise<CreatedPerson> {
  const res = await api.post("/api/persons", { data });
  expect(res.status(), await res.text()).toBe(201);
  return res.json();
}

export async function deletePerson(api: APIRequestContext, id: string) {
  const res = await api.delete(`/api/persons/${id}?force=true`);
  // Schon weg (z.B. im Test selbst gelöscht) ist in Ordnung.
  expect([200, 404]).toContain(res.status());
}

export async function createRelationship(api: APIRequestContext, data: Record<string, unknown>) {
  const res = await api.post("/api/relationships", { data });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: string };
}

export async function deleteSource(api: APIRequestContext, id: string) {
  const res = await api.delete(`/api/sources/${id}`);
  expect([200, 404]).toContain(res.status());
}

/** Kleines, gültiges PNG (einfarbig) — ohne Bilddatei im Repository. */
export function tinyPng(rgb: [number, number, number] = [200, 80, 60], size = 24): Buffer {
  // PNG von Hand: IHDR, ein IDAT mit unkomprimierten Zeilen (zlib „stored“), IEND.
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  // zlib: Header + ein „stored“-Block + Adler-32
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const head = Buffer.from([0x78, 0x01, 0x01, raw.length & 0xff, raw.length >> 8, ~raw.length & 0xff, (~raw.length >> 8) & 0xff]);
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(((b << 16) | a) >>> 0);
  const idat = Buffer.concat([head, raw, adler]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
