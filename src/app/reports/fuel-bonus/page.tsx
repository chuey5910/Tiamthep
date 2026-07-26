import { DateRangeFilter } from "@/components/Filters";
import { Badge, Card, Empty, Formula, PageHeader, Stat } from "@/components/ui";
import { formatThaiDate } from "@/lib/date";
import { baht, num } from "@/lib/format";
import { readRange, type SearchParams } from "@/lib/params";
import { loadPeriod } from "@/lib/reports";
import { LitreOverride } from "./LitreOverride";

export const dynamic = "force-dynamic";

export default async function FuelBonusPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { from, to, fromStr, toStr } = readRange(sp);

  const data = await loadPeriod({ from, to });
  const rows = data.bonuses;

  // แผนที่รายละเอียดขาในแต่ละรอบ ไว้แสดงว่า "ขาไป A + ขากลับ B" คือน้ำมันเท่าไหร่
  const legsByTrip = new Map<string, { route: string; kpi: number | null }[]>();
  for (const j of data.jobs) {
    if (!j.tripCode) continue;
    const c = data.calcs.get(j.id)!;
    const list = legsByTrip.get(j.tripCode) ?? [];
    list.push({ route: `${j.origin} → ${j.destination}`, kpi: c.kpiLitres });
    legsByTrip.set(j.tripCode, list);
  }

  const eligible = rows.filter((r) => !r.isOutsource);
  const t = {
    kpi: eligible.reduce((a, r) => a + r.kpiLitres, 0),
    used: eligible.reduce((a, r) => a + r.usedLitres, 0),
    bonus: eligible.reduce((a, r) => a + r.bonus, 0),
  };
  const saved = t.kpi - t.used;
  const rate = data.ctx.fuelBuybackRate;

  return (
    <>
      <PageHeader
        title="สรุปเงินพิเศษค่าน้ำมัน (ซื้อคืนน้ำมันที่ประหยัดได้)"
        subtitle="ระบบจับคู่ขาไป-ขากลับให้เองจากรหัสรอบ แล้วรวมเป้าหมายน้ำมันเทียบกับที่เติมจริง — ไม่ต้องนั่งไล่ตารางเอง"
        actions={
          <button type="button" className="btn btn-ghost" data-print>
            🖨 พิมพ์
          </button>
        }
      />

      <DateRangeFilter from={fromStr} to={toStr} />

      <Formula>
        <b>เป้าหมายน้ำมันของแต่ละขา</b> = ระยะทางขาเดียว ÷ อัตราสิ้นเปลืองเป้าหมาย (ตั้งที่หน้าเส้นทาง)
        <br />
        <b>เป้าหมายรวมของรอบ</b> = ผลรวมของทุกขาที่ใช้รหัสรอบเดียวกัน — นี่คือตัวที่แก้ปัญหา
        &laquo;งาน A+B เป็นน้ำมัน X, งาน A+C เป็นน้ำมัน Y&raquo; โดยไม่ต้องทำตารางจับคู่เอง
        <br />
        <b>เงินซื้อคืน</b> = (เป้าหมายรวม − ลิตรที่เติมจริง) × {rate} บาท/ลิตร ·&nbsp;
        <b>ใช้เกินเป้า = ได้ 0 บาท แต่ไม่หักเงิน</b> · แก้อัตราได้ที่หน้าตั้งค่าระบบ
      </Formula>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="รอบที่สรุปได้" value={rows.length} hint="รอบ" />
        <Stat label="เป้าหมายน้ำมันรวม" value={num(t.kpi, 1)} hint="ลิตร (เฉพาะรถบริษัท)" />
        <Stat
          label="ประหยัดได้รวม"
          value={num(saved, 1)}
          hint="ลิตร"
          tone={saved >= 0 ? "good" : "bad"}
        />
        <Stat label="เงินพิเศษที่ต้องจ่าย" value={baht(t.bonus)} hint="บาท" tone="good" />
      </div>

      <Card
        title="รายรอบ"
        actions={<span className="text-[11px] font-normal text-slate-400">แก้ช่อง &laquo;ลิตรจริง (แก้เอง)&raquo; ได้ทันที</span>}
        bodyClass="p-0"
      >
        {rows.length === 0 ? (
          <Empty>ยังไม่มีรอบงานที่จบในช่วงนี้</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>รหัสรอบ</th>
                  <th>ทะเบียน</th>
                  <th>พขร.</th>
                  <th>วันจบรอบ</th>
                  <th>เส้นทางในรอบ</th>
                  <th className="num">ขา</th>
                  <th className="num">เป้าหมาย (ลิตร)</th>
                  <th className="num">เติมจริง (อัตโนมัติ)</th>
                  <th className="num">ลิตรจริง (แก้เอง)</th>
                  <th className="num">ประหยัดได้</th>
                  <th className="num">เงินซื้อคืน</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const legs = legsByTrip.get(r.tripCode) ?? [];
                  return (
                    <tr key={r.tripCode}>
                      <td className="font-mono text-[12px]">{r.tripCode}</td>
                      <td className="font-semibold">{r.plate}</td>
                      <td>{r.isOutsource ? <Badge tone="info">รถร่วม</Badge> : (r.driverCode ?? "-")}</td>
                      <td className="whitespace-nowrap">{formatThaiDate(r.endDate)}</td>
                      <td className="text-[12px] text-slate-500">
                        {legs.map((l, i) => (
                          <div key={i} className="whitespace-nowrap">
                            {l.route}
                            {l.kpi != null && <span className="ml-1 text-slate-400">({num(l.kpi, 1)} ล.)</span>}
                          </div>
                        ))}
                      </td>
                      <td className="num">{r.legs}</td>
                      <td className="num font-medium">{num(r.kpiLitres, 1)}</td>
                      <td className="num text-slate-500">{r.autoLitres > 0 ? num(r.autoLitres, 1) : "ไม่พบการเติม"}</td>
                      <td className="num">
                        <LitreOverride tripCode={r.tripCode} value={r.overrideLitres} />
                      </td>
                      <td className={`num font-medium ${r.savedLitres >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                        {num(r.savedLitres, 1)}
                      </td>
                      <td className="num font-bold">
                        {r.isOutsource ? (
                          <span className="text-slate-400">รถร่วม</span>
                        ) : r.usedLitres <= 0 ? (
                          <span className="text-amber-600" title="ยังไม่มีข้อมูลการเติมน้ำมันของรอบนี้">
                            รอข้อมูล
                          </span>
                        ) : (
                          baht(r.bonus)
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6}>รวม (เฉพาะรถบริษัท)</td>
                  <td className="num">{num(t.kpi, 1)}</td>
                  <td className="num" colSpan={2}>
                    {num(t.used, 1)}
                  </td>
                  <td className="num">{num(saved, 1)}</td>
                  <td className="num">{baht(t.bonus)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-3 text-[12px] text-slate-500">
        รอบที่ขึ้นว่า &laquo;รอข้อมูล&raquo; แปลว่ายังหาไม่เจอว่าเติมน้ำมันวันไหน — ให้นำเข้าข้อมูลการเติมน้ำมันที่หน้า{" "}
        <b>บันทึกประจำวัน → การเติมน้ำมัน</b> หรือกรอกลิตรจริงในช่องแก้เอง
      </p>
    </>
  );
}
