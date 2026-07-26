import { Breakdown, BreakdownTable } from "@/components/Breakdown";
import { DateRangeFilter } from "@/components/Filters";
import { Card, Formula, PageHeader, Stat } from "@/components/ui";
import { baht, pct } from "@/lib/format";
import { readRange, readString, type SearchParams } from "@/lib/params";
import { expenseReport, loadPeriod } from "@/lib/reports";
import Link from "next/link";

export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "category", label: "แยกตามประเภทค่าใช้จ่าย", head: "ประเภทค่าใช้จ่าย" },
  { key: "vehicle", label: "แยกตามทะเบียนรถ", head: "ทะเบียนรถ" },
  { key: "driver", label: "แยกตาม พขร.", head: "พนักงานขับรถ" },
  { key: "supplier", label: "แยกตามผู้ให้บริการ", head: "ผู้ให้บริการ / supplier" },
] as const;

export default async function ExpenseReportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { from, to, fromStr, toStr } = readRange(sp);
  const view = (readString(sp, "view", "category") || "category") as (typeof VIEWS)[number]["key"];

  const data = await loadPeriod({ from, to });
  const rep = expenseReport(data);

  const rows =
    view === "vehicle" ? rep.byVehicle : view === "driver" ? rep.byDriver : view === "supplier" ? rep.bySupplier : rep.byCategory;
  const head = VIEWS.find((v) => v.key === view)!.head;
  const top = rep.byCategory[0];

  return (
    <>
      <PageHeader
        title="รายงานวิเคราะห์ค่าใช้จ่าย"
        subtitle="ต้นทุนส่วนใหญ่อยู่ตรงไหน ควรลดตรงไหนถึงจะกระทบกำไรมากที่สุด"
        actions={
          <button type="button" className="btn btn-ghost" data-print>
            🖨 พิมพ์
          </button>
        }
      />

      <DateRangeFilter from={fromStr} to={toStr} />

      <Formula>
        รวมต้นทุนทุกก้อนที่กระทบกำไร ไม่ใช่แค่ที่คีย์ในหน้าค่าใช้จ่าย — <b>ค่าน้ำมัน</b> (จากรายการเติมน้ำมัน){" "}
        <b>เบี้ยเลี้ยง</b> <b>ค่าทางด่วน</b> <b>เงินพิเศษน้ำมัน</b> <b>ค่าจ้างรถร่วม</b> <b>อะไหล่จากสต็อก</b> และ{" "}
        <b>ค่าแรงอู่</b>
        <br />
        ยอดรวมของทุกมุมมองเท่ากันเสมอ และเท่ากับ &laquo;รวมต้นทุนและค่าใช้จ่าย&raquo; ในงบกำไรขาดทุน ·&nbsp;
        ค่าน้ำมันของรถร่วมไม่นับซ้ำ เพราะหักคืนตอนจ่ายค่าจ้างอยู่แล้ว
      </Formula>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="ค่าใช้จ่ายรวม" value={baht(rep.total)} hint="บาท" />
        <Stat
          label="ต้นทุนก้อนใหญ่ที่สุด"
          value={top?.label ?? "-"}
          hint={top ? `${baht(top.amount)} บาท (${pct(top.share)})` : ""}
          tone="warn"
        />
        <Stat label="จำนวนประเภทต้นทุน" value={rep.byCategory.length} hint="ประเภท" />
        <Stat
          label="รถที่มีต้นทุน"
          value={rep.byVehicle.filter((r) => r.key !== "__none__").length}
          hint="คัน"
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
          <BreakdownTable rows={rows} labelHead={head} />
        </Card>
      </div>

      {view !== "category" && (
        <Card title="ภาพรวมตามประเภทค่าใช้จ่าย" className="mt-4">
          <Breakdown rows={rep.byCategory} />
        </Card>
      )}
    </>
  );
}
