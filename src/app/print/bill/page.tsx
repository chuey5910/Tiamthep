import { notFound } from "next/navigation";
import { InvoiceDocument } from "@/components/InvoiceDocument";
import { requireAuth } from "@/lib/auth";
import { parseDate } from "@/lib/date";
import { draftInvoiceDoc } from "@/lib/invoice-doc";

export const dynamic = "force-dynamic";
export const metadata = { title: "ใบวางบิล (ร่าง)" };

/**
 * ร่างใบวางบิลจากขาที่ติ๊กเลือก — หน้านี้มีไว้ให้ตัวทำ PDF (api/pdf) เปิด
 *   /print/bill?customer=1&from=2026-09-01&to=2026-09-30&ids=12,13,14
 */
export default async function PrintBillPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAuth();
  const sp = await searchParams;
  const customerId = Number(sp.customer);
  const from = parseDate(sp.from ?? "");
  const to = parseDate(sp.to ?? "");
  const ids = (sp.ids ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!customerId || !from || !to || ids.length === 0) notFound();

  const doc = await draftInvoiceDoc(customerId, from, to, ids);
  if (!doc) notFound();
  return (
    <div className="invoice-page" data-missing={doc.missing} data-filename={doc.fileName}>
      <InvoiceDocument doc={doc} />
    </div>
  );
}
