import { PageLoading } from "@/components/PageLoading";

// Nur auf Seiten ohne notFound(): eine Ladeanzeige streamt die Antwort, und
// danach ließe sich kein 404-Status mehr setzen.
export default function Loading() {
  return <PageLoading />;
}
