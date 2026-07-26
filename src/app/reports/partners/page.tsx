import { MonthFilter, SelectFilter } from "@/components/Filters";
import { Card, Empty, Formula, PageHeader, Stat } from "@/components/ui";
import { TH_MONTHS_FULL, formatThaiDate } from "@/lib/date";
import { baht, num } from "@/lib/format";
import { readMonth, readString, type SearchParams } from "@/lib/params";
import { loadPeriod, partnerSettlement } from "@/lib/reports";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function PartnerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { year, month, from, to } = readMonth(sp);

  const partners = await prisma.partner.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const selected = readString(sp, "partner") || partners[0]?.name || "";

  if (!partners.length) {
    return (
      <>
        <PageHeader title="รายงานการจ่ายเงินรถร่วม" />
        <Card>
          <Empty>
            ยังไม่มีรถร่วมในระบบ — เพิ่มได้ที่หน้า <b>ฐานข้อมูล → รถร่วม (outsource)</b>
          </Empty>
        </Card>
      </>
    );
  }

  const data = await loadPeriod({ from, to });
  const s = partnerSettlement(data, selected);

  return (
    <>
      <PageHeader
        title="รายงานการจ่ายเงินรถร่วม (outsource)"
        subtitle={`สรุปยอดที่ต้องจ่าย ${selected} ประจำเดือน ${TH_MONTHS_FULL[month - 1]} ${year + 543}`}
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
            name="partner"
            label="รถร่วม"
            value={selected}
            width="w-64"
            options={partners.map((p) => ({ value: p.name, label: p.name }))}
          />
        }
      />

      <Formula>
        ยอดจ่ายสุทธิ = ค่าบรรทุกตามราคารถร่วม − ค่าน้ำมันที่บริษัทออกให้ − ค่าใช้จ่ายที่บริษัทจ่ายแทน
        ·&nbsp; ราคารถร่วมของแต่ละเส้นทางตั้งได้ที่หน้า <b>ฐานข้อมูล → เส้นทาง ระยะทาง ราคา</b>
      </Formula>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="ค่าบรรทุกรวม (ก)" value={baht(s.freight)} hint={`${s.jobs.length} ขา`} />
        <Stat label="หัก ค่าน้ำมัน (ข)" value={baht(s.fuelDeduction)} hint={`${s.fuel.length} ครั้ง`} tone="warn" />
        <Stat
          label="หัก ค่าใช้จ่ายจ่ายแทน (ค)"
          value={baht(s.expenseDeduction)}
          hint={`${s.expenses.length} รายการ`}
          tone="warn"
        />
        <Stat label="ยอดจ่ายสุทธิ (ก−ข−ค)" value={baht(s.netPay)} hint="บาท" tone={s.netPay >= 0 ? "good" : "bad"} />
      </div>

      <div className="space-y-4">
        <Card title={`รายละเอียดงานที่วิ่ง (${s.jobs.length} ขา)`} bodyClass="p-0">
          {s.jobs.length === 0 ? (
            <Empty />
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th>ทะเบียน</th>
                    <th>ลูกค้า</th>
                    <th>เส้นทาง</th>
                    <th className="num">น้ำหนัก (ตัน)</th>
                    <th>หน่วยคิดราคา</th>
                    <th className="num">ค่าบรรทุก (บาท)</th>
                  </tr>
                </thead>
                <tbody>
                  {s.jobs.map((j, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap">{formatThaiDate(j.date)}</td>
                      <td>{j.plate}</td>
                      <td>{j.customer}</td>
                      <td>{j.route}</td>
                      <td className="num">{num(j.weight, 2)}</td>
                      <td className="text-slate-500">{j.unit}</td>
                      <td className="num font-medium">{baht(j.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={6}>รวมค่าบรรทุก (ก)</td>
                    <td className="num">{baht(s.freight)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        <Card title={`การเติมน้ำมันที่บริษัทออกให้ (${s.fuel.length} ครั้ง)`} bodyClass="p-0">
          {s.fuel.length === 0 ? (
            <Empty />
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th>ทะเบียน</th>
                    <th>แหล่งเติม</th>
                    <th className="num">จำนวน (ลิตร)</th>
                    <th className="num">ราคา/ลิตร</th>
                    <th className="num">เป็นเงิน (บาท)</th>
                  </tr>
                </thead>
                <tbody>
                  {s.fuel.map((f, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap">{formatThaiDate(f.date)}</td>
                      <td>{f.plate}</td>
                      <td className="text-slate-500">{f.source}</td>
                      <td className="num">{num(f.litres, 2)}</td>
                      <td className="num">{num(f.pricePerL, 2)}</td>
                      <td className="num font-medium">{baht(f.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5}>รวมค่าน้ำมัน (ข)</td>
                    <td className="num">{baht(s.fuelDeduction)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        <Card title={`ค่าใช้จ่ายอื่นที่บริษัทจ่ายแทน (${s.expenses.length} รายการ)`} bodyClass="p-0">
          {s.expenses.length === 0 ? (
            <Empty />
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th>ทะเบียน</th>
                    <th>ประเภท</th>
                    <th>รายละเอียด</th>
                    <th className="num">จำนวนเงิน (บาท)</th>
                  </tr>
                </thead>
                <tbody>
                  {s.expenses.map((e, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap">{formatThaiDate(e.date)}</td>
                      <td>{e.plate ?? "-"}</td>
                      <td>{e.category}</td>
                      <td className="text-slate-500">{e.detail ?? "-"}</td>
                      <td className="num font-medium">{baht(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>รวมค่าใช้จ่ายจ่ายแทน (ค)</td>
                    <td className="num">{baht(s.expenseDeduction)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        <Card title="สรุปยอดจ่าย">
          <table className="tbl">
            <tbody>
              <tr>
                <td>ค่าบรรทุกรวม (ก)</td>
                <td className="num">{baht(s.freight)}</td>
              </tr>
              <tr>
                <td>หัก ค่าน้ำมันที่บริษัทออกให้ (ข)</td>
                <td className="num text-red-600">-{baht(s.fuelDeduction)}</td>
              </tr>
              <tr>
                <td>หัก ค่าใช้จ่ายที่บริษัทจ่ายแทน (ค)</td>
                <td className="num text-red-600">-{baht(s.expenseDeduction)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td className="text-base">ยอดที่ต้องจ่าย {s.partnerName}</td>
                <td className="num text-base">{baht(s.netPay)}</td>
              </tr>
            </tfoot>
          </table>
        </Card>
      </div>
    </>
  );
}
