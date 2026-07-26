import { CrudPage } from "@/components/CrudPage";
import { RESOURCES } from "@/lib/crud";
import type { SearchParams } from "@/lib/params";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <CrudPage resource={RESOURCES["expenses"]} searchParams={await searchParams} />;
}
