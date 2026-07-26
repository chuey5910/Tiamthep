import { Breakdown, BreakdownTable } from "@/components/Breakdown";
import { DateRangeFilter } from "@/components/Filters";
import { Card, Formula, PageHeader, Stat } from "@/components/ui";
import { baht, pct } from "@/lib/format";
import { readRange, readString, type SearchParams } from "@/lib/params";
import { loadPeriod, revenueReport } from "@/lib/reports";
import Link from "next/link";

export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "customer", label: "แยกตามลูกค้า", head: "ลูกค้า" },
  { key: "vehicle", label: "แยกตามทะเบียนรถ", head: "ทะเบียนรถ" },
  { key: "driver", label: "แยกตาม พขร.", head: "พนักงานขับรถ" },
  { key: "type", label: "แยกตามประเภทรถ", head: "ประเภทรถ" },
] as const;

export default async function RevenueReportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { from, to, fromStr, toStr } = readRange(sp);
  const view = (readString(sp, "view", "customer") || "customer") as (typeof VIEWS)[number]["key"];

  const data = await loadPeriod({ from, to });
  const rep = revenueReport(data);

  const rows =
    view === "vehicle" ? rep.byVehicle : view === "driver" ? rep.byDriver : view === "type" ? rep.byVehicleType : rep.byCustomer;
  const head = VIEWS.find((v) => v.key === view)!.head;
  const top = rep.byCustomer[0];
  const legs = data.billedJobs.length;

  return (
    <>
      <PageHeader
        title="รายงานรายได้"
        subtitle="รายได้มาจากไหน ลูกค้ารายไหนคือรายได้หลัก และรถประเภทไหนสร้างรายได้มากที่สุด"
        actions={
          <button type="button" className="btn btn-ghost" data-print>
            🖨 พิมพ์
          </button>
        }
      />

      <DateRangeFilter from={fromStr} to={toStr} />

      <Formula>
        รายได้ต่อขา = ราคาค่าบรรทุกตามเส้นทาง ณ ช่วงราคาน้ำมันของลูกค้ารายนั้น × น้ำหนัก (ถ้าคิดต่อตัน) ·&nbsp; ราคาน้ำมันอ้างอิงและเกณฑ์น้ำหนัก
        (ต้นทาง/ปลายทาง) ตั้งแยกได้รายลูกค้าที่หน้า <b>ฐานข้อมูล → ข้อมูลลูกค้า</b>
      </Formula>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="รายได้รวม" value={baht(rep.total)} hint="บาท" />
        <Stat label="จำนวนขาที่เรียกเก็บ" value={legs} hint="ขา" />
        <Stat label="รายได้เฉลี่ยต่อขา" value={legs > 0 ? baht(rep.total / legs) : "-"} hint="บาท" />
        <Stat
          label="ลูกค้ารายใหญ่ที่สุด"
          value={top?.label.split(" ")[0] ?? "-"}
          hint={top ? `${baht(top.amount)} บาท (${pct(top.share)})` : ""}
        />
      </div>

      <div className="no-print mb-4 flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={`?from=${fromStr}&to=${toStr}&view=${v.key}`}
            className={`btn ${view === v.key ? "btn-primary" : "btn-ghost"}`}
          >
            {v.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={VIEWS.find((v) => v.key === view)!.label}>
          <Breakdown rows={rows} limit={12} />
        </Card>
        <Card title="ตารางตัวเลข" bodyClass="p-0">
          <BreakdownTable rows={rows} labelHead={head} valueHead="รายได้ (บาท)" />
        </Card>
      </div>

      {top && top.share > 40 && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          ⚠ รายได้ {pct(top.share)} มาจากลูกค้ารายเดียว ({top.label}) — ถ้าเสียลูกค้ารายนี้ไปจะกระทบหนัก
          ควรพิจารณากระจายความเสี่ยง
        </p>
      )}
    </>
  );
}
