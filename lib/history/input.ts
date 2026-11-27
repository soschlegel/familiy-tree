import { z } from "zod";

/**
 * Form der Anfrage für eigene Ereignisse der Zeitgeschichte (POST
 * /api/history-events, PATCH /api/history-events/[id]). Nur die grobe Form
 * und Obergrenzen — die eigentliche Prüfung mit verständlichen Meldungen je
 * Feld macht checkHistoryInput (lib/history/events.ts) im Dienst.
 */
export const historyRequestInput = z.object({
  title: z.string().max(1000),
  yearFrom: z.union([z.number(), z.string().max(10)]),
  yearTo: z.union([z.number(), z.string().max(10), z.null()]).optional(),
  kind: z.string().max(40),
  description: z.string().max(5000).nullable().optional(),
  region: z.string().max(1000).nullable().optional(),
});

/** KI-Einträge bestätigen (POST /api/history-events/confirm): eine oder mehrere Kennungen. */
export const historyConfirmInput = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(500) });

/** Mitgelieferten Eintrag aus- bzw. einblenden (PATCH /api/history-events/builtin/[id]). */
export const historyHiddenInput = z.object({ hidden: z.boolean() });
