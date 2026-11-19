import type { GedcomWarning, GedcomWarningCode } from "./types";

/**
 * Sammelt Warnungen. Je Art werden höchstens `cap` mit Zeilennummer
 * aufbewahrt; der Rest wird gezählt und am Ende in einer Sammelmeldung
 * genannt — eine kaputte Datei mit 100 000 gleichen Fehlern soll die
 * Vorschau nicht sprengen.
 */
export class WarningSink {
  private readonly list: GedcomWarning[] = [];
  private readonly counts = new Map<GedcomWarningCode, number>();

  constructor(private readonly cap = 200) {}

  add(code: GedcomWarningCode, message: string, line?: number, recordId?: string): void {
    const n = (this.counts.get(code) ?? 0) + 1;
    this.counts.set(code, n);
    if (n <= this.cap) {
      const w: GedcomWarning = { code, message };
      if (line !== undefined) w.line = line;
      if (recordId !== undefined) w.recordId = recordId;
      this.list.push(w);
    }
  }

  addAll(warnings: GedcomWarning[]): void {
    for (const w of warnings) this.add(w.code, w.message, w.line, w.recordId);
  }

  count(code: GedcomWarningCode): number {
    return this.counts.get(code) ?? 0;
  }

  /** Alle Warnungen samt Sammelmeldungen für gekappte Arten. */
  result(): GedcomWarning[] {
    const out = [...this.list];
    for (const [code, n] of this.counts) {
      if (n > this.cap) {
        out.push({ code, message: `… und ${n - this.cap} weitere Meldungen dieser Art (insgesamt ${n}).` });
      }
    }
    return out;
  }

  /** Anzahl je Art (ungekappt). */
  totals(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }
}
