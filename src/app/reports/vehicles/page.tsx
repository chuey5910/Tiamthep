import { DateRangeFilter } from "@/components/Filters";
import { Badge, Card, Empty, Formula, PageHeader, Stat } from "@/components/ui";
import { baht, profitClass } from "@/lib/format";
import { readRange, readString, type SearchParams } from "@/lib/params";
import { loadPeriod, vehiclePnl } from "@/lib/reports";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function VehiclePnlPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { from, to, fromStr, toStr } = readRange(sp);
  const showAll = readString(sp, "all") === "1";

  const data = await loadPeriod({ from, to });
  const all = vehiclePnl(data);
  const rows = showAll ? all : all.filter((r) => r.legs > 0 || r.revenue !== 0 || r.totalCost !== 0);

  const totals = rows.reduce(
    (a, r) => ({
      legs: a.legs + r.legs,
      revenue: a.revenue + r.revenue,
      fuelCost: a.fuelCost + r.fuelCost,
      allowance: a.allowance + r.allowance,
      toll: a.toll + r.toll,
      fuelBonus: a.fuelBonus + r.fuelBonus,
      otherExpense: a.otherExpense + r.otherExpense,
      partsCost: a.partsCost + r.partsCost,
      garageCost: a.garageCost + r.garageCost,
      outsourcePay: a.outsourcePay + r.outsourcePay,
      totalCost: a.totalCost + r.totalCost,
      profit: a.profit + r.profit,
    }),
    {
      legs: 0, revenue: 0, fuelCost: 0, allowance: 0, toll: 0, fuelBonus: 0,
      otherExpense: 0, partsCost: 0, garageCost: 0, outsourcePay: 0, totalCost: 0, profit: 0,
    },
  );

  const best = rows.filter((r) => r.legs > 0).slice(0, 1)[0];
  const worst = [...rows].filter((r) => r.legs > 0).sort((a, b) => a.profit - b.profit)[0];

  const qs = new URLSearchParams({ from: fromStr, to: toStr });
  if (!showAll) qs.set("all", "1");

  return (
    <>
      <PageHeader
        title="กำไรขาดทุน แยกตามทะเบียนรถ"
        subtitle="ดูว่ารถคันไหนทำเงิน คันไหนกินต้นทุน เพื่อตัดสินใจว่าควรซ่อม ควรขาย หรือควรเปลี่ยนเส้นทางวิ่ง"
        actions={
          <>
            <Link href={`?${qs.toString()}`} className="btn btn-ghost">
              {showAll ? "ซ่อนรถที่ไม่มีงาน" : "แสดงรถทุกคัน"}
            </Link>
            <button type="button" className="btn btn-ghost" data-print>
              🖨 พิมพ์
            </button>
          </>
        }
      />

      <DateRangeFilter from={fromStr} to={toStr} />

      <Formula>
        <b>รถบริษัท:</b> กำไร = รายได้ − ค่าน้ำมัน − เบี้ยเลี้ยง − ค่าทางด่วน − เงินพิเศษน้ำมัน − ค่าใช้จ่ายอื่น −
        อะไหล่จากสต็อก − ค่าแรงอู่ ·&nbsp;
        <b>รถร่วม:</b> กำไร = รายได้ − ค่าจ้างที่จ่ายรถร่วม (ค่าน้ำมันที่บริษัทออกให้ หักคืนตอนจ่ายค่าจ้าง จึงไม่นับซ้ำ)
      </Formula>

      {rows.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="รวมรายได้" value={baht(totals.revenue)} hint="บาท" />
          <Stat label="รวมต้นทุน" value={baht(totals.totalCost)} hint="บาท" />
          <Stat
            label="กำไรรวม"
            value={baht(totals.profit)}
            hint={`${totals.legs} ขา`}
            tone={totals.profit >= 0 ? "good" : "bad"}
          />
          <Stat
            label="คันที่กำไรน้อยที่สุด"
            value={worst ? worst.plate : "-"}
            hint={worst ? `${baht(worst.profit)} บาท` : ""}
            tone={worst && worst.profit < 0 ? "bad" : "warn"}
          />
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
                  <th>ทะเบียน</th>
                  <th>ประเภทรถ</th>
                  <th>เจ้าของ</th>
                  <th className="num">ขา</th>
                  <th className="num">รายได้</th>
                  <th className="num">ค่าน้ำมัน</th>
                  <th className="num">เบี้ยเลี้ยง</th>
                  <th className="num">ค่าทางด่วน</th>
                  <th className="num">เงินพิเศษน้ำมัน</th>
                  <th className="num">ค่าใช้จ่ายอื่น</th>
                  <th className="num">อะไหล่</th>
                  <th className="num">ค่าแรงอู่</th>
                  <th className="num">ค่าจ้างรถร่วม</th>
                  <th className="num">รวมต้นทุน</th>
                  <th className="num">กำไร (ขาดทุน)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isOut = r.ownerType === "รถร่วม";
                  return (
                    <tr key={r.plate}>
                      <td className="font-semibold">{r.plate}</td>
                      <td className="text-slate-500">{r.vehicleType}</td>
                      <td>
                        {isOut ? (
                          <Badge tone="info">{r.partnerName ?? "รถร่วม"}</Badge>
                        ) : (
                          <Badge tone="muted">รถบริษัท</Badge>
                        )}
                      </td>
                      <td className="num">{r.legs || "-"}</td>
                      <td className="num">{baht(r.revenue)}</td>
                      <td className="num text-slate-500">{isOut ? "—" : baht(r.fuelCost)}</td>
                      <td className="num text-slate-500">{isOut ? "—" : baht(r.allowance)}</td>
                      <td className="num text-slate-500">{isOut ? "—" : baht(r.toll)}</td>
                      <td className="num text-slate-500">{isOut ? "—" : baht(r.fuelBonus)}</td>
                      <td className="num text-slate-500">{isOut ? "—" : baht(r.otherExpense)}</td>
                      <td className="num text-slate-500">{isOut ? "—" : baht(r.partsCost)}</td>
                      <td className="num text-slate-500">{isOut ? "—" : baht(r.garageCost)}</td>
                      <td className="num text-slate-500">{isOut ? baht(r.outsourcePay) : "—"}</td>
                      <td className="num">{baht(r.totalCost)}</td>
                      <td className={`num font-bold ${profitClass(r.profit)}`}>{baht(r.profit)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>รวมทั้งหมด</td>
                  <td className="num">{totals.legs}</td>
                  <td className="num">{baht(totals.revenue)}</td>
                  <td className="num">{baht(totals.fuelCost)}</td>
                  <td className="num">{baht(totals.allowance)}</td>
                  <td className="num">{baht(totals.toll)}</td>
                  <td className="num">{baht(totals.fuelBonus)}</td>
                  <td className="num">{baht(totals.otherExpense)}</td>
                  <td className="num">{baht(totals.partsCost)}</td>
                  <td className="num">{baht(totals.garageCost)}</td>
                  <td className="num">{baht(totals.outsourcePay)}</td>
                  <td className="num">{baht(totals.totalCost)}</td>
                  <td className={`num ${profitClass(totals.profit)}`}>{baht(totals.profit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {best && (
        <p className="mt-3 text-[12px] text-slate-500">
          คันที่ทำกำไรสูงสุดในช่วงนี้คือ <b>{best.plate}</b> ({baht(best.profit)} บาท จาก {best.legs} ขา)
        </p>
      )}
    </>
  );
}
