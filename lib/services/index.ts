/**
 * Dienstschicht: reine async-Funktionen über Prisma, die einen Scope
 * (lib/scope.ts) bekommen und serialisierbare Daten liefern.
 *
 * Bewusst ohne Abhängigkeit zu next/* oder lib/auth.ts — die Funktionen
 * laufen genauso in einem einfachen Node-Prozess (Skripte, MCP-Server). Die
 * Route-Handler in app/api und die Server-Components nutzen dieselben
 * Funktionen, damit Validierung, Rechteprüfung und Audit an einer Stelle
 * liegen.
 *
 * Fehler werden als ServiceError geworfen (siehe errors.ts). Lesende
 * Einzelabfragen liefern stattdessen null, wenn es die Person nicht gibt oder
 * sie nicht sichtbar ist.
 */
export * from "./errors";
export * from "./dto";
export * from "./context";
export * from "./tree";
export * from "./persons";
export * from "./relationships";
export * from "./research";
export * from "./duplicates";
export * from "./merge";
export * from "./merge-bulk";
export * from "./families";
export * from "./kinship";
export * from "./reference";
export * from "./timeline";
export * from "./consistency";
export * from "./sources";
export * from "./ai-access";
export * from "./events";
export * from "./names";
export * from "./imports";
export * from "./import-apply";
export { loadGraph, type GraphPerson, type GraphRelationship, type LoadedGraph } from "./graph-data";
export * from "./changes";
export * from "./media-links";
export * from "./attached-media";
