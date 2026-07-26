import { DateRangeFilter } from "@/components/Filters";
import { Card, Empty, Formula, PageHeader, Stat } from "@/components/ui";
import { baht, profitClass } from "@/lib/format";
import { readRange, type SearchParams } from "@/lib/params";
import { driverPnl, loadPeriod } from "@/lib/reports";

export const dynamic = "force-dynamic";

export default async function DriverPnlPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { from, to, fromStr, toStr } = readRange(sp);

  const data = await loadPeriod({ from, to });
  const rows = driverPnl(data).filter((r) => r.legs > 0 || r.revenue !== 0 || r.totalCost !== 0);

  const t = rows.reduce(
    (a, r) => ({
      legs: a.legs + r.legs,
      revenue: a.revenue + r.revenue,
      fuelCost: a.fuelCost + r.fuelCost,
      allowance: a.allowance + r.allowance,
      toll: a.toll + r.toll,
      fuelBonus: a.fuelBonus + r.fuelBonus,
      otherExpense: a.otherExpense + r.otherExpense,
      totalCost: a.totalCost + r.totalCost,
      profit: a.profit + r.profit,
    }),
    { legs: 0, revenue: 0, fuelCost: 0, allowance: 0, toll: 0, fuelBonus: 0, otherExpense: 0, totalCost: 0, profit: 0 },
  );

  return (
    <>
      <PageHeader
        title="กำไรขาดทุน แยกตามพนักงานขับรถ"
        subtitle="ผลงานของ พขร. แต่ละคน — ใช้ดูว่าใครคุมต้นทุนน้ำมันได้ดี และใครมีค่าใช้จ่ายผิดปกติ"
        actions={
          <button type="button" className="btn btn-ghost" data-print>
            🖨 พิมพ์
          </button>
        }
      />

      <DateRangeFilter from={fromStr} to={toStr} />

      <Formula>
        ผลงานสุทธิ = รายได้จากงานที่ขับ − ค่าน้ำมันที่เติม − เบี้ยเลี้ยง − ค่าทางด่วน − เงินพิเศษน้ำมัน −
        ค่าใช้จ่ายที่ผูกกับ พขร. ·&nbsp; ระบบดึงชื่อ พขร. จากตารางจับคู่รถ ณ วันที่ทำงาน จึงไม่ต้องเลือกเอง
      </Formula>

      {rows.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="พขร. ที่มีงาน" value={rows.filter((r) => r.legs > 0).length} hint="คน" />
          <Stat label="รวมขาที่วิ่ง" value={t.legs} hint="ขา" />
          <Stat label="รวมรายได้" value={baht(t.revenue)} hint="บาท" />
          <Stat label="ผลงานสุทธิรวม" value={baht(t.profit)} hint="บาท" tone={t.profit >= 0 ? "good" : "bad"} />
        </div>
      )}

      <Card bodyClass="p-0">
        {rows.length === 0 ? (
          <Empty />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>รหัส</th>
                  <th>ชื่อ-สกุล</th>
                  <th className="num">ขา</th>
                  <th className="num">รายได้</th>
                  <th className="num">ค่าน้ำมัน</th>
                  <th className="num">เบี้ยเลี้ยง</th>
                  <th className="num">ค่าทางด่วน</th>
                  <th className="num">เงินพิเศษน้ำมัน</th>
                  <th className="num">ค่าใช้จ่ายอื่น</th>
                  <th className="num">รวมต้นทุน</th>
                  <th className="num">ผลงานสุทธิ</th>
                  <th className="num">รายได้ต่อขา</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.driverCode}>
                    <td className="font-semibold">{r.driverCode}</td>
                    <td>{r.name}</td>
                    <td className="num">{r.legs || "-"}</td>
                    <td className="num">{baht(r.revenue)}</td>
                    <td className="num text-slate-500">{baht(r.fuelCost)}</td>
                    <td className="num text-slate-500">{baht(r.allowance)}</td>
                    <td className="num text-slate-500">{baht(r.toll)}</td>
                    <td className="num text-slate-500">{baht(r.fuelBonus)}</td>
                    <td className="num text-slate-500">{baht(r.otherExpense)}</td>
                    <td className="num">{baht(r.totalCost)}</td>
                    <td className={`num font-bold ${profitClass(r.profit)}`}>{baht(r.profit)}</td>
                    <td className="num text-slate-500">{r.legs > 0 ? baht(r.revenue / r.legs) : "-"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>รวมทั้งหมด</td>
                  <td className="num">{t.legs}</td>
                  <td className="num">{baht(t.revenue)}</td>
                  <td className="num">{baht(t.fuelCost)}</td>
                  <td className="num">{baht(t.allowance)}</td>
                  <td className="num">{baht(t.toll)}</td>
                  <td className="num">{baht(t.fuelBonus)}</td>
                  <td className="num">{baht(t.otherExpense)}</td>
                  <td className="num">{baht(t.totalCost)}</td>
                  <td className={`num ${profitClass(t.profit)}`}>{baht(t.profit)}</td>
                  <td className="num">{t.legs > 0 ? baht(t.revenue / t.legs) : "-"}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
