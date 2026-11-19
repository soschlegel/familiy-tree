/**
 * ANSEL (ANSI/NISO Z39.47) mit den GEDCOM-Erweiterungen — ohne Abhängigkeit.
 *
 * Besonderheit: Kombinierende Zeichen (0xE0–0xFE) stehen in ANSEL VOR dem
 * Grundbuchstaben, in Unicode DAHINTER. „ä“ ist in ANSEL 0xE8 0x61; daraus
 * wird "a" + U+0308 und nach NFC-Normalisierung "ä".
 *
 * Tabelle nach GEDCOM 5.5.1, Anhang D, und der MARC-21-Codetabelle
 * „Extended Latin (ANSEL)“ der Library of Congress.
 */

const SPACING: Record<number, number> = {
  0xa1: 0x0141, // Ł
  0xa2: 0x00d8, // Ø
  0xa3: 0x0110, // Đ
  0xa4: 0x00de, // Þ
  0xa5: 0x00c6, // Æ
  0xa6: 0x0152, // Œ
  0xa7: 0x02b9, // Prime
  0xa8: 0x00b7, // Mittelpunkt
  0xa9: 0x266d, // ♭
  0xaa: 0x00ae, // ®
  0xab: 0x00b1, // ±
  0xac: 0x01a0, // Ơ
  0xad: 0x01af, // Ư
  0xae: 0x02bc, // Alif
  0xb0: 0x02bb, // Ain
  0xb1: 0x0142, // ł
  0xb2: 0x00f8, // ø
  0xb3: 0x0111, // đ
  0xb4: 0x00fe, // þ
  0xb5: 0x00e6, // æ
  0xb6: 0x0153, // œ
  0xb7: 0x02ba, // Doppelprime
  0xb8: 0x0131, // ı
  0xb9: 0x00a3, // £
  0xba: 0x00f0, // ð
  0xbc: 0x01a1, // ơ
  0xbd: 0x01b0, // ư
  0xbe: 0x25a1, // □ (GEDCOM)
  0xbf: 0x25a0, // ■ (GEDCOM)
  0xc0: 0x00b0, // °
  0xc1: 0x2113, // ℓ
  0xc2: 0x2117, // ℗
  0xc3: 0x00a9, // ©
  0xc4: 0x266f, // ♯
  0xc5: 0x00bf, // ¿
  0xc6: 0x00a1, // ¡
  0xc7: 0x00df, // ß (MARC 21)
  0xc8: 0x20ac, // € (MARC 21)
  0xcd: 0x0065, // Mittellinien-e (GEDCOM) → e
  0xce: 0x006f, // Mittellinien-o (GEDCOM) → o
  0xcf: 0x00df, // ß (GEDCOM)
};

const COMBINING: Record<number, number> = {
  0xe0: 0x0309, // Haken oben
  0xe1: 0x0300, // Gravis
  0xe2: 0x0301, // Akut
  0xe3: 0x0302, // Zirkumflex
  0xe4: 0x0303, // Tilde
  0xe5: 0x0304, // Makron
  0xe6: 0x0306, // Breve
  0xe7: 0x0307, // Punkt oben
  0xe8: 0x0308, // Trema / Umlaut
  0xe9: 0x030c, // Hatschek
  0xea: 0x030a, // Ring oben
  0xeb: 0xfe20, // Ligatur links
  0xec: 0xfe21, // Ligatur rechts
  0xed: 0x0315, // Komma oben rechts
  0xee: 0x030b, // Doppelakut
  0xef: 0x0310, // Candrabindu
  0xf0: 0x0327, // Cedille
  0xf1: 0x0328, // Ogonek
  0xf2: 0x0323, // Punkt unten
  0xf3: 0x0324, // Doppelpunkt unten
  0xf4: 0x0325, // Ring unten
  0xf5: 0x0333, // doppelt unterstrichen
  0xf6: 0x0332, // unterstrichen
  0xf7: 0x0326, // Komma unten
  0xf8: 0x031c, // Halbring rechts unten
  0xf9: 0x032e, // Breve unten
  0xfa: 0xfe22, // Doppeltilde links
  0xfb: 0xfe23, // Doppeltilde rechts
  0xfe: 0x0313, // Komma oben
};

/**
 * Dekodiert ANSEL-Bytes. Unbekannte Bytes werden zu U+FFFD und gezählt.
 * Ein kombinierendes Zeichen vor einem Zeilenende oder vor einem weiteren
 * Steuerzeichen bleibt als eigenständiges Zeichen stehen.
 */
export function decodeAnsel(bytes: Uint8Array): { text: string; invalid: number } {
  let invalid = 0;
  const out: string[] = [];
  let chunk: number[] = [];
  let pending: number[] = [];
  const flush = () => {
    if (chunk.length) {
      out.push(String.fromCharCode(...chunk));
      chunk = [];
    }
  };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b < 0x80) {
      chunk.push(b);
      if (pending.length) {
        if (b >= 0x20) chunk.push(...pending.reverse());
        else chunk.splice(chunk.length - 1, 0, ...pending);
        pending = [];
      }
    } else if (COMBINING[b] !== undefined) {
      pending.push(COMBINING[b]);
    } else {
      const cp = SPACING[b];
      if (cp === undefined) {
        invalid++;
        chunk.push(0xfffd);
      } else chunk.push(cp);
      if (pending.length) {
        chunk.push(...pending.reverse());
        pending = [];
      }
    }
    if (chunk.length > 8192) flush();
  }
  if (pending.length) chunk.push(...pending);
  flush();
  return { text: out.join("").normalize("NFC"), invalid };
}

const REVERSE_SPACING = new Map<number, number>();
for (const [k, v] of Object.entries(SPACING)) {
  const b = Number(k);
  // Rückrichtung eindeutig: ß → 0xCF (GEDCOM), e/o nicht zurück.
  if (b === 0xc7 || b === 0xcd || b === 0xce) continue;
  REVERSE_SPACING.set(v, b);
}
const REVERSE_COMBINING = new Map<number, number>();
for (const [k, v] of Object.entries(COMBINING)) REVERSE_COMBINING.set(v, Number(k));

/**
 * Kodiert Text als ANSEL (für Tests und ältere Zielprogramme). Nicht
 * darstellbare Zeichen werden zu "?".
 */
export function encodeAnsel(text: string): Uint8Array {
  const out: number[] = [];
  const chars = [...text.normalize("NFD")];
  for (let i = 0; i < chars.length; i++) {
    const cp = chars[i].codePointAt(0)!;
    // Kombinierende Zeichen sammeln, die zu diesem Grundzeichen gehören.
    const marks: number[] = [];
    let j = i + 1;
    while (j < chars.length && REVERSE_COMBINING.has(chars[j].codePointAt(0)!)) {
      marks.push(REVERSE_COMBINING.get(chars[j].codePointAt(0)!)!);
      j++;
    }
    out.push(...marks.reverse());
    if (cp < 0x80) out.push(cp);
    else if (REVERSE_SPACING.has(cp)) out.push(REVERSE_SPACING.get(cp)!);
    else out.push(0x3f);
    i = j - 1;
  }
  return Uint8Array.from(out);
}
