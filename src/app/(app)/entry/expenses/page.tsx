import { CrudPage } from "@/components/CrudPage";
import { canWrite } from "@/lib/roles";
import { getCurrentUser } from "@/lib/auth";
import { ExpenseImport } from "./ExpenseImport";
import { RESOURCES } from "@/lib/crud";
import type { SearchParams } from "@/lib/params";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await getCurrentUser();
  return (
    <CrudPage
      resource={RESOURCES["expenses"]}
      searchParams={await searchParams}
      toolbar={canWrite(user) ? <ExpenseImport /> : undefined}
    />
  );
}
