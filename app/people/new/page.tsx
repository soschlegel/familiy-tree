import { requirePage } from "@/lib/session";
import { PersonForm } from "@/components/PersonForm";

export default async function NewPersonPage() {
  await requirePage("person:create");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Person anlegen</h1>
      <PersonForm />
    </div>
  );
}
