import { SelectFilter } from "@/components/Filters";
import { Formula, PageHeader, Stat } from "@/components/ui";
import {
  billingCustomers,
  billingDefaults,
  billingLines,
  dueDateOf,
  type BillingRecord,
} from "@/lib/billing";
import { daysUntil, formatThaiDate } from "@/lib/date";
import { baht } from "@/lib/format";
import { readRange, type SearchParams } from "@/lib/params";
import { prisma } from "@/lib/prisma";
import { loadPeriod } from "@/lib/reports";
import { sortOptionsThaiFirst } from "@/lib/sort";
import { BillingHub, type CustomerView, type InvoiceView, type LineView } from "./BillingHub";

export const dynamic = "force-dynamic";

export default async function BillingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { from, to, fromStr, toStr } = readRange(sp);
  const pickedId = Number(typeof sp.customer === "string" ? sp.customer : "") || 0;

  const [data, settingRows] = await Promise.all([
    loadPeriod({ from, to }),
    prisma.setting.findMany(),
  ]);
  const defaults = billingDefaults(new Map(settingRows.map((s) => [s.key, s.value])));

  // ขาในช่วงนี้ถูกวางบิลไปแล้วในใบไหนบ้าง — 1 ขาอยู่ได้ใบเดียว
  const jobIds = data.billedJobs.map((j) => j.id);
  const billedLines = await prisma.customerBillingLine.findMany({
    where: { jobId: { in: jobIds } },
    include: { billing: true },
  });
  const invoiceByJob = new Map(billedLines.map((l) => [l.jobId, l.billing.invoiceNo]));

  const rows = billingCustomers(data, invoiceByJob, defaults);
  const picked = rows.find((r) => r.customerId === pickedId) ?? null;

  // ใบวางบิลที่ออกไปแล้วของลูกค้าที่เลือก (เฉพาะใบที่มีขาอยู่ในช่วงนี้)
  const invoices: InvoiceView[] = [];
  if (picked) {
    const seen = new Map<number, BillingRecord>();
    for (const l of billedLines) {
      if (l.billing.customerId !== picked.customerId) continue;
      const cur = seen.get(l.billing.id);
      if (cur) cur.jobIds.push(l.jobId);
      else
        seen.set(l.billing.id, {
          id: l.billing.id,
          invoiceNo: l.billing.invoiceNo,
          customerId: l.billing.customerId,
          periodFrom: l.billing.periodFrom,
          periodTo: l.billing.periodTo,
          billedAt: l.billing.billedAt,
          dueAt: l.billing.dueAt,
          legs: l.billing.legs,
          amount: l.billing.amount,
          billedBy: l.billing.billedBy,
          jobIds: [l.jobId],
        });
    }
    for (const b of [...seen.values()].sort((a, c) => c.billedAt.getTime() - a.billedAt.getTime())) {
      invoices.push({
        id: b.id,
        invoiceNo: b.invoiceNo,
        billedAt: formatThaiDate(b.billedAt),
        dueAt: b.dueAt ? formatThaiDate(b.dueAt) : "",
        period: `${formatThaiDate(b.periodFrom)} – ${formatThaiDate(b.periodTo)}`,
        legs: b.legs,
        amount: b.amount,
        billedBy: b.billedBy,
        legsInRange: b.jobIds.length,
      });
    }
  }

  // รายการขาของลูกค้าที่เลือก — วันที่แปลงเป็นข้อความก่อนส่งให้ฝั่งเบราว์เซอร์
  const customerRecord = picked ? data.ctx.customerById.get(picked.customerId) : undefined;
  const lines: LineView[] = picked
    ? billingLines(data, picked.customerId, invoiceByJob).map((l) => ({
        jobId: l.jobId,
        date: formatThaiDate(l.date),
        plate: l.trailerPlate ? `${l.plate} + ${l.trailerPlate}` : l.plate,
        ticketOrigin: l.ticketOrigin,
        origin: l.origin,
        destination: l.destination,
        weightOrigin: l.weightOrigin,
        weightDest: l.weightDest,
        weightBasis: l.weightBasis,
        priceUnit: l.priceUnit,
        rate: l.rate,
        amount: l.amount,
        vehicleType: l.vehicleType,
        issues: l.issues,
        fix: l.fix,
        missingRoute: l.missingRoute,
        invoiceNo: l.invoiceNo,
      }))
    : [];

  const views: CustomerView[] = rows.map((r) => ({
    customerId: r.customerId,
    code: r.code,
    name: r.name,
    legs: r.legs,
    billedLegs: r.billedLegs,
    openLegs: r.openLegs,
    openAmount: r.openAmount,
    problemLegs: r.problemLegs,
    invoices: r.invoices,
    dueDate: formatThaiDate(r.dueDate),
    dueDaySource: r.dueDaySource,
    billingDayNote: r.billingDayNote,
    overdue: r.overdue,
  }));

  const t = rows.reduce(
    (a, r) => ({
      openCustomers: a.openCustomers + (r.openLegs > 0 ? 1 : 0),
      openAmount: a.openAmount + r.openAmount,
      invoices: a.invoices + r.invoices,
      billedAmount: a.billedAmount + r.billedAmount,
    }),
    { openCustomers: 0, openAmount: 0, invoices: 0, billedAmount: 0 },
  );

  // วันครบกำหนดของงวดนี้ตามค่ากลาง — ใช้โชว์บนการ์ดสรุป
  const dueDate = dueDateOf(to, defaults.dueDay);
  const left = daysUntil(dueDate) ?? 0;

  const customerOptions = sortOptionsThaiFirst(
    rows.map((r) => ({ value: String(r.customerId), label: `${r.code} — ${r.name}` })),
  );

  return (
    <>
      <div className="no-print">
      <PageHeader
        title="วางบิลลูกค้า"
        subtitle="เลือกขาที่จะวางบิล ออกเป็นใบวางบิล และติดตามว่ารายไหนยังมีขาค้างวางบิล"
      />

      <Formula>
        <b>ครบกำหนดวางบิล</b> = วันที่ {defaults.dueDay} ของเดือน (ตั้งค่ากลางที่หน้าตั้งค่าระบบ ·
        ลูกค้ารายไหนต่างก็ตั้งเฉพาะรายนั้นที่หน้าข้อมูลลูกค้า)
        <br />
        <b>ยอดวางบิล</b> = ผลรวมค่าบรรทุกของขาที่ติ๊กเลือก — ตัวเลขชุดเดียวกับรายงานรายได้
        <br />
        <b>แถวแดง</b> = เลยกำหนดแล้วยังมีขาค้าง · <b>1 ขา วางบิลได้ครั้งเดียว</b> ระบบไม่ยอมให้ซ้ำ
      </Formula>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="ลูกค้าที่ยังมีขาค้าง"
          value={t.openCustomers}
          hint={`จาก ${rows.length} รายที่มีงานในช่วงนี้`}
          tone={t.openCustomers > 0 ? "bad" : "good"}
        />
        <Stat label="ยอดที่ยังไม่วางบิล" value={baht(t.openAmount)} hint="บาท (ก่อน VAT)" tone="bad" />
        <Stat label="วางบิลแล้วในช่วงนี้" value={t.invoices} hint={`ใบ · ${baht(t.billedAmount)} บาท`} tone="good" />
        <Stat
          label="ครบกำหนดวางบิล"
          value={formatThaiDate(dueDate)}
          hint={left >= 0 ? `อีก ${left} วัน` : `เลยมาแล้ว ${Math.abs(left)} วัน`}
          tone={left < 0 ? "bad" : "default"}
        />
      </div>
      </div>

      <BillingHub
        customers={views}
        picked={
          picked
            ? {
                customerId: picked.customerId,
                code: picked.code,
                name: picked.name,
                address: customerRecord?.address ?? null,
                taxId: customerRecord?.taxId ?? null,
                branch: customerRecord?.branch ?? null,
                creditDays: customerRecord?.creditDays ?? 0,
                weightBasis: customerRecord?.weightBasis ?? "น้ำหนักปลายทาง",
              }
            : null
        }
        lines={lines}
        invoices={invoices}
        range={`${formatThaiDate(from)} ถึง ${formatThaiDate(to)}`}
        fromStr={fromStr}
        toStr={toStr}
        customerFilter={
          <SelectFilter
            key="customer"
            name="customer"
            label="ลูกค้า"
            value={String(pickedId || "")}
            width="w-[22rem]"
            options={[{ value: "", label: "— เลือกลูกค้าที่จะวางบิล —" }, ...customerOptions]}
          />
        }
      />
    </>
  );
}
