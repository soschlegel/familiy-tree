/** Zahl mit passender Einzahl/Mehrzahl: plural(1, "Eintrag", "Einträge") → "1 Eintrag". */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
