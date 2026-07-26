import { MonthFilter } from "@/components/Filters";
import { Breakdown } from "@/components/Breakdown";
import { Card, Formula, PageHeader, Stat } from "@/components/ui";
import { TrendChart, type TrendPoint } from "@/components/TrendChart";
import { TH_MONTHS_FULL, endOfMonth, utcDate } from "@/lib/date";
import { baht, pct, profitClass } from "@/lib/format";
import { readMonth, type SearchParams } from "@/lib/params";
import { companyPnl, loadPeriod } from "@/lib/reports";

export const dynamic = "force-dynamic";

export default async function CompanyPnlPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { year, month, from, to } = readMonth(sp);

  const data = await loadPeriod({ from, to });
  const pnl = companyPnl(data);

  // แนวโน้มย้อนหลัง 12 เดือน — คำนวณทีละเดือนด้วยเครื่องคำนวณตัวเดียวกัน
  const trend: TrendPoint[] = [];
  for (let i = 11; i >= 0; i--) {
    const total = year * 12 + (month - 1) - i;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    const d = await loadPeriod({ from: utcDate(y, m, 1), to: endOfMonth(y, m) });
    const p = companyPnl(d);
    trend.push({
      label: `${TH_MONTHS_FULL[m - 1].slice(0, 3)} ${String((y + 543) % 100).padStart(2, "0")}`,
      revenue: p.totalRevenue,
      cost: p.totalCost,
      profit: p.netProfit,
    });
  }

  const costRows = pnl.costs.map((c, i) => ({
    key: `${i}-${c.label}`,
    label: c.label,
    amount: c.amount,
    share: pnl.totalCost > 0 ? (c.amount / pnl.totalCost) * 100 : 0,
  }));

  return (
    <>
      <PageHeader
        title="งบกำไรขาดทุนของกิจการ"
        subtitle={`สรุปผลประกอบการเดือน ${TH_MONTHS_FULL[month - 1]} ${year + 543}`}
        actions={
          <button type="button" className="btn btn-ghost" data-print>
            🖨 พิมพ์ / บันทึก PDF
          </button>
        }
      />

      <MonthFilter year={year} month={month} />

      <Formula>
        <b>รายได้</b> นับตามวันที่เรียกเก็บเงินของลูกค้าแต่ละราย (ส่วนใหญ่คือวันขึ้นสินค้า)
        · <b>ค่าน้ำมันและค่าใช้จ่ายของรถร่วม</b> ไม่นับเป็นต้นทุนบริษัท เพราะหักคืนตอนจ่ายค่าจ้างรถร่วมอยู่แล้ว
        (นับซ้ำจะทำให้ต้นทุนสูงเกินจริง)
      </Formula>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="รวมรายได้" value={baht(pnl.totalRevenue)} hint="บาท" />
        <Stat label="รวมต้นทุนและค่าใช้จ่าย" value={baht(pnl.totalCost)} hint="บาท" />
        <Stat
          label={pnl.netProfit >= 0 ? "กำไรสุทธิ" : "ขาดทุนสุทธิ"}
          value={baht(pnl.netProfit)}
          hint="บาท"
          tone={pnl.netProfit >= 0 ? "good" : "bad"}
        />
        <Stat
          label="อัตรากำไรสุทธิ"
          value={pct(pnl.margin)}
          hint="กำไรสุทธิ ÷ รายได้"
          tone={pnl.margin >= 0 ? "good" : "bad"}
        />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card title="งบกำไรขาดทุน" bodyClass="p-0">
          <table className="tbl">
            <tbody>
              <tr>
                <td colSpan={2} className="bg-slate-50 font-bold">
                  รายได้
                </td>
              </tr>
              <tr>
                <td className="pl-8">รายได้ค่าบรรทุก — รถบริษัท</td>
                <td className="num">{baht(pnl.revenueOwn)}</td>
              </tr>
              <tr>
                <td className="pl-8">รายได้ค่าบรรทุก — งานที่ใช้รถร่วมวิ่ง</td>
                <td className="num">{baht(pnl.revenueOutsource)}</td>
              </tr>
              <tr className="font-bold">
                <td>รวมรายได้</td>
                <td className="num">{baht(pnl.totalRevenue)}</td>
              </tr>

              <tr>
                <td colSpan={2} className="bg-slate-50 font-bold">
                  ต้นทุนและค่าใช้จ่าย
                </td>
              </tr>
              {pnl.costs.map((c, i) => (
                <tr key={i}>
                  <td className="pl-8">{c.label}</td>
                  <td className="num">{baht(c.amount)}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td>รวมต้นทุนและค่าใช้จ่าย</td>
                <td className="num">{baht(pnl.totalCost)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td className="text-base">{pnl.netProfit >= 0 ? "กำไรสุทธิ" : "ขาดทุนสุทธิ"}</td>
                <td className={`num text-base ${profitClass(pnl.netProfit)}`}>{baht(pnl.netProfit)}</td>
              </tr>
            </tfoot>
          </table>
        </Card>

        <Card title="ต้นทุนส่วนใหญ่อยู่ตรงไหน">
          <Breakdown rows={costRows} />
        </Card>
      </div>

      <Card title="แนวโน้มย้อนหลัง 12 เดือน">
        <TrendChart data={trend} />
      </Card>
    </>
  );
}
