import { notFound } from "next/navigation";
import { InvoiceDocument } from "@/components/InvoiceDocument";
import { requireAuth } from "@/lib/auth";
import { issuedInvoiceDoc } from "@/lib/invoice-doc";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// ชื่อเอกสารใน PDF (โชว์บนแถบหน้าต่างดู PDF) = เลขที่ใบวางบิล
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inv = await prisma.customerBilling.findUnique({ where: { id: Number(id) }, select: { invoiceNo: true } });
  return { title: inv ? `ใบวางบิล ${inv.invoiceNo}` : "ใบวางบิล" };
}

/** ใบวางบิลที่ออกไปแล้ว 1 ใบ — หน้านี้มีไว้ให้ตัวทำ PDF (api/pdf) เปิด */
export default async function PrintInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await params;
  const doc = await issuedInvoiceDoc(Number(id));
  if (!doc) notFound();
  return (
    <div className="invoice-page" data-missing={doc.missing} data-filename={doc.fileName}>
      <InvoiceDocument doc={doc} />
    </div>
  );
}
