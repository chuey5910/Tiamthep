import { MonthFilter, SelectFilter } from "@/components/Filters";
import { Card, Empty, Formula, PageHeader, Stat } from "@/components/ui";
import { TH_MONTHS_FULL, formatThaiDate, payPeriod } from "@/lib/date";
import { baht } from "@/lib/format";
import { readInt, readMonth, type SearchParams } from "@/lib/params";
import { allowanceReport, loadPeriod } from "@/lib/reports";

export const dynamic = "force-dynamic";

export default async function AllowancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { year, month } = readMonth(sp);
  const period = (readInt(sp, "period", 1) === 2 ? 2 : 1) as 1 | 2;
  const { from, to } = payPeriod(year, month, period);

  const data = await loadPeriod({ from, to });
  const rows = allowanceReport(data);

  const t = rows.reduce(
    (a, r) => ({
      legs: a.legs + r.legs,
      allowance: a.allowance + r.allowance,
      advance: a.advance + r.advance,
      toll: a.toll + r.toll,
      fuelBonus: a.fuelBonus + r.fuelBonus,
      netPay: a.netPay + r.netPay,
    }),
    { legs: 0, allowance: 0, advance: 0, toll: 0, fuelBonus: 0, netPay: 0 },
  );

  return (
    <>
      <PageHeader
        title="สรุปเบี้ยเลี้ยงพนักงานขับรถ"
        subtitle={`งวดวันที่ ${formatThaiDate(from)} ถึง ${formatThaiDate(to)} — ยอดนี้คือเงินที่ต้องจ่ายพร้อมเงินเดือน`}
        actions={
          <button type="button" className="btn btn-ghost" data-print>
            🖨 พิมพ์ใบสรุปจ่าย
          </button>
        }
      />

      <MonthFilter
        year={year}
        month={month}
        extra={
          <SelectFilter
            name="period"
            label="งวด"
            value={String(period)}
            width="w-52"
            options={[
              { value: "1", label: "งวดที่ 1 (วันที่ 1-15)" },
              { value: "2", label: "งวดที่ 2 (วันที่ 16-สิ้นเดือน)" },
            ]}
          />
        }
      />

      <Formula>
        <b>ต่อ 1 ขา:</b> เบี้ยเลี้ยงที่ได้จริง = เบี้ยเลี้ยงตามเส้นทาง − เงินเดินทางที่รับไปก่อนออกงาน +
        ค่าทางด่วนที่สำรองจ่าย
        <br />
        <b>ทั้งงวด:</b> ยอดจ่ายสุทธิ = ผลรวมข้างต้นของทุกขา + เงินพิเศษค่าน้ำมันที่ประหยัดได้
        <br />
        <span className="opacity-80">
          ตัวอย่าง: เบี้ยเลี้ยง 1,000 − เงินเดินทาง 500 + ทางด่วน 250 = 750 บาท/ขา · วิ่ง 10 ขา = 7,500 บาท
        </span>
      </Formula>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="พขร. ที่ต้องจ่าย" value={rows.filter((r) => r.netPay !== 0).length} hint="คน" />
        <Stat label="รวมขาที่วิ่ง" value={t.legs} hint="ขา" />
        <Stat label="เงินเดินทางที่จ่ายไปแล้ว" value={baht(t.advance)} hint="บาท" />
        <Stat label="ยอดจ่ายสุทธิรวม" value={baht(t.netPay)} hint="บาท" tone="good" />
      </div>

      <Card
        title={`งวดที่ ${period} — ${TH_MONTHS_FULL[month - 1]} ${year + 543}`}
        bodyClass="p-0"
      >
        {rows.length === 0 ? (
          <Empty>ยังไม่มีงานหรือรายการเงินเดินทางในงวดนี้</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>รหัส</th>
                  <th>ชื่อ-สกุล</th>
                  <th className="num">จำนวนขา</th>
                  <th className="num">เบี้ยเลี้ยงรวม</th>
                  <th className="num">หัก เงินเดินทางรับ</th>
                  <th className="num">บวก ค่าทางด่วน</th>
                  <th className="num">บวก เงินพิเศษน้ำมัน</th>
                  <th className="num">จ่ายสุทธิ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.driverCode}>
                    <td className="font-semibold">{r.driverCode}</td>
                    <td>{r.name}</td>
                    <td className="num">{r.legs || "-"}</td>
                    <td className="num">{baht(r.allowance)}</td>
                    <td className="num text-red-600">{r.advance ? `-${baht(r.advance)}` : "-"}</td>
                    <td className="num text-emerald-700">{r.toll ? `+${baht(r.toll)}` : "-"}</td>
                    <td className="num text-emerald-700">{r.fuelBonus ? `+${baht(r.fuelBonus)}` : "-"}</td>
                    <td className="num font-bold">{baht(r.netPay)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>รวมทั้งงวด</td>
                  <td className="num">{t.legs}</td>
                  <td className="num">{baht(t.allowance)}</td>
                  <td className="num">-{baht(t.advance)}</td>
                  <td className="num">+{baht(t.toll)}</td>
                  <td className="num">+{baht(t.fuelBonus)}</td>
                  <td className="num">{baht(t.netPay)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
