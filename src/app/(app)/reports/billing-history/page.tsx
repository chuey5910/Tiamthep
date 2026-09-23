import { SelectFilter } from "@/components/Filters";
import { Badge, Card, Empty, Formula, LinkButton, PageHeader, Stat } from "@/components/ui";
import { daysUntil, endOfMonth, formatThaiDate, TH_MONTHS_FULL, utcDate } from "@/lib/date";
import { baht, money } from "@/lib/format";
import { readMonth, type SearchParams } from "@/lib/params";
import { prisma } from "@/lib/prisma";
import { compareThaiFirst } from "@/lib/sort";
import { InvoiceTable, type InvoiceRow } from "./InvoiceTable";

export const dynamic = "force-dynamic";

/**
 * รายงานการวางบิล — ทะเบียนใบวางบิลทุกใบที่เคยออก
 *
 * หน้า «วางบิลลูกค้า» ใช้ตอนกำลังจะวางบิล (เลือกขา ออกใบ)
 * หน้านี้ใช้ตอนอยากดูย้อนหลัง: ออกใบไหนไปแล้วบ้าง ยอดเท่าไหร่ ครบกำหนดชำระเมื่อไหร่
 */
export default async function BillingHistoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { year, month } = readMonth(sp);
  const allMonths = sp.month === "0";
  const customerId = Number(typeof sp.customer === "string" ? sp.customer : "") || 0;

  // เลือก «ทั้งปี» = ทั้งปีนั้น · ไม่งั้นเฉพาะเดือนที่เลือก (นับตามวันที่วางบิล)
  const from = allMonths ? utcDate(year, 1, 1) : utcDate(year, month, 1);
  const to = allMonths ? endOfMonth(year, 12) : endOfMonth(year, month);

  const [billings, customers] = await Promise.all([
    prisma.customerBilling.findMany({
      where: {
        billedAt: { gte: from, lte: to },
        ...(customerId ? { customerId } : {}),
      },
      include: { customer: true, _count: { select: { lines: true } } },
      orderBy: [{ billedAt: "desc" }, { invoiceNo: "desc" }],
    }),
    prisma.customer.findMany({ orderBy: { code: "asc" } }),
  ]);

  const today = new Date();
  const rows: InvoiceRow[] = billings.map((b) => {
    const left = daysUntil(b.dueAt, today);
    return {
      id: b.id,
      invoiceNo: b.invoiceNo,
      customerId: b.customerId,
      customerCode: b.customer.code,
      customerName: b.customer.name,
      billedAt: formatThaiDate(b.billedAt),
      dueAt: b.dueAt ? formatThaiDate(b.dueAt) : "",
      /** ติดลบ = เลยกำหนดชำระแล้ว */
      daysLeft: left,
      period: `${formatThaiDate(b.periodFrom)} – ${formatThaiDate(b.periodTo)}`,
      periodFrom: b.periodFrom.toISOString().slice(0, 10),
      periodTo: b.periodTo.toISOString().slice(0, 10),
      legs: b._count.lines,
      amount: b.amount,
      billedBy: b.billedBy,
    };
  });

  const t = rows.reduce(
    (a, r) => ({
      legs: a.legs + r.legs,
      amount: a.amount + r.amount,
      overdue: a.overdue + (r.daysLeft != null && r.daysLeft < 0 ? 1 : 0),
    }),
    { legs: 0, amount: 0, overdue: 0 },
  );

  // ตัวเลือกลูกค้า = ทุกรายในฐานข้อมูล (ไม่ใช่เฉพาะที่มีบิลในเดือนนี้ จะได้ค้นย้อนหลังได้)
  const customerOptions = [
    { value: "", label: "— ทุกบริษัท —" },
    ...customers
      .map((c) => ({ value: String(c.id), label: `${c.code} — ${c.name}` }))
      .sort((a, b) => compareThaiFirst(a.label, b.label)),
  ];

  const period = allMonths ? `ทั้งปี ${year + 543}` : `${TH_MONTHS_FULL[month - 1]} ${year + 543}`;
  const pickedCustomer = customerId ? customers.find((c) => c.id === customerId) : undefined;

  const nowY = new Date().getFullYear();
  const yearOptions: { value: string; label: string }[] = [];
  for (let y = nowY - 4; y <= nowY + 1; y++) yearOptions.push({ value: String(y), label: String(y + 543) });

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="รายงานการวางบิล"
          subtitle="ใบวางบิลทุกใบที่เคยออก — ค้นย้อนหลังตามบริษัท เดือน และปี"
          actions={<LinkButton href="/reports/billing" variant="primary">+ ออกใบวางบิลใหม่</LinkButton>}
        />

        <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
          <SelectFilter
            name="customer"
            label="บริษัท (ลูกค้า)"
            value={String(customerId || "")}
            width="w-[22rem]"
            options={customerOptions}
          />
          <SelectFilter
            name="month"
            label="เดือน"
            value={allMonths ? "0" : String(month)}
            width="w-40"
            options={[
              { value: "0", label: "— ทั้งปี —" },
              ...TH_MONTHS_FULL.map((name, i) => ({ value: String(i + 1), label: name })),
            ]}
          />
          <SelectFilter
            name="year"
            label="ปี (พ.ศ.)"
            value={String(year)}
            width="w-32"
            options={yearOptions}
          />
        </div>

        <Formula>
          <b>นับตามวันที่วางบิล</b> ไม่ใช่วันที่วิ่งงาน — ใบที่ออกเดือนนี้อาจมีงานของเดือนก่อนรวมอยู่ (ดูได้ที่ช่อง «ช่วงงาน»)
          <br />
          <b>เลือกเดือนเป็น «ทั้งปี»</b> เพื่อดูทั้งปีรวดเดียว · กดปุ่ม «ดูยอด» ที่แถวไหนก็ได้เพื่อดูรายละเอียดของใบนั้น
        </Formula>

        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="ใบวางบิล" value={rows.length} hint={`ใบ · ${t.legs} ขา`} />
          <Stat label="ค่าบรรทุกรวม" value={baht(t.amount)} hint="บาท (ยอดที่วางบิลไป)" tone="good" />
          <Stat
            label="เลยกำหนดชำระ"
            value={t.overdue}
            hint="ใบ (ยังไม่ได้รับเงิน ต้องตามเก็บ)"
            tone={t.overdue > 0 ? "bad" : "good"}
          />
        </div>
      </div>

      <Card
        title={`ใบวางบิล — ${period}${pickedCustomer ? ` · เฉพาะ ${pickedCustomer.code} ${pickedCustomer.name}` : ""}`}
        bodyClass="p-0"
      >
        {rows.length === 0 ? (
          <Empty>
            ยังไม่มีใบวางบิลในช่วงที่เลือก —{" "}
            <a className="font-bold underline" href="/reports/billing">
              ไปออกใบวางบิล
            </a>
          </Empty>
        ) : (
          <InvoiceTable rows={rows} />
        )}
      </Card>

      {rows.length > 0 && (
        <p className="no-print mt-3 text-[12px] text-slate-500">
          – รวม {rows.length} ใบ · ค่าบรรทุก {money(t.amount)} บาท{" "}
          {t.overdue > 0 && <Badge tone="error">เลยกำหนดชำระ {t.overdue} ใบ</Badge>}
        </p>
      )}
    </>
  );
}
