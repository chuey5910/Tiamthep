import { DateRangeFilter } from "@/components/Filters";
import { Badge, Card, Empty, Formula, PageHeader, Stat } from "@/components/ui";
import { formatThaiDate } from "@/lib/date";
import { fuelLayouts } from "@/lib/fuel-import";
import { baht, num } from "@/lib/format";
import { readRange, type SearchParams } from "@/lib/params";
import { prisma } from "@/lib/prisma";
import { DeleteFuelButton, FuelImportForm, ManualFuelForm } from "./FuelImport";

export const dynamic = "force-dynamic";

export default async function FuelPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { from, to, fromStr, toStr } = readRange(sp);

  const [entries, vehicles, drivers, plates] = await Promise.all([
    prisma.fuelEntry.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: 500,
    }),
    prisma.vehicle.findMany({ where: { active: true }, orderBy: { plate: "asc" } }),
    prisma.driver.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    prisma.vehicle.findMany({ select: { plate: true } }),
  ]);

  const knownPlates = new Set(plates.map((p) => p.plate));

  const totals = {
    litres: entries.reduce((a, e) => a + e.litres, 0),
    amount: entries.reduce((a, e) => a + e.amount, 0),
    unknown: entries.filter((e) => !knownPlates.has(e.plate)).length,
  };
  const avgPrice = totals.litres > 0 ? totals.amount / totals.litres : 0;

  return (
    <>
      <PageHeader
        title="การเติมน้ำมัน"
        subtitle="นำเข้าไฟล์ที่ export จากระบบน้ำมัน — ระบบใช้ข้อมูลนี้คิดต้นทุนน้ำมันรายคัน เงินพิเศษน้ำมัน และยอดหักของรถร่วม"
      />

      <Formula>
        นำเข้าไฟล์เดิมซ้ำได้ ไม่เกิดข้อมูลซ้ำ เพราะระบบจำ &laquo;เลขอ้างอิง&raquo; ของทุกแถวไว้
        (หมายเลขสลิป / TRANSACTION_ID) ·&nbsp; แนะนำให้กด <b>ตรวจสอบก่อน</b> ทุกครั้ง แล้วค่อยติ๊กบันทึกจริง
      </Formula>

      <Card title="นำเข้าจากไฟล์" className="mb-4">
        <FuelImportForm layouts={fuelLayouts()} />
      </Card>

      <Card title="เพิ่มรายการเอง (กรณีเติมนอกระบบ หรือแก้ตกหล่น)" className="mb-4">
        <ManualFuelForm
          vehicles={vehicles.map((v) => ({ value: v.plate, label: `${v.plate} (${v.vehicleType})` }))}
          drivers={drivers.map((d) => ({ value: d.code, label: `${d.code} ${d.firstName} ${d.lastName}`.trim() }))}
        />
      </Card>

      <DateRangeFilter from={fromStr} to={toStr} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="จำนวนครั้งที่เติม" value={entries.length} hint="ครั้ง" />
        <Stat label="รวมปริมาณ" value={num(totals.litres, 2)} hint="ลิตร" />
        <Stat label="รวมเป็นเงิน" value={baht(totals.amount)} hint="บาท" />
        <Stat
          label="ราคาเฉลี่ยที่จ่ายจริง"
          value={num(avgPrice, 2)}
          hint="บาท/ลิตร"
        />
      </div>

      {totals.unknown > 0 && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          ⚠ มี {totals.unknown} รายการที่ทะเบียนยังไม่มีในฐานข้อมูลรถ — ค่าน้ำมันเหล่านี้จะไม่เข้ารายงานรายคัน
        </p>
      )}

      <Card bodyClass="p-0">
        {entries.length === 0 ? (
          <Empty>ยังไม่มีรายการเติมน้ำมันในช่วงนี้</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>วันที่</th>
                  <th>แหล่งเติม</th>
                  <th>ทะเบียน</th>
                  <th>พขร.</th>
                  <th>สถานี</th>
                  <th className="num">เลขไมล์</th>
                  <th className="num">ลิตร</th>
                  <th className="num">บาท/ลิตร</th>
                  <th className="num">จำนวนเงิน</th>
                  <th>เลขอ้างอิง</th>
                  <th className="no-print">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{formatThaiDate(e.date)}</td>
                    <td>
                      <Badge tone={e.source === "FleetCard" ? "info" : "muted"}>{e.source}</Badge>
                    </td>
                    <td className={knownPlates.has(e.plate) ? "font-medium" : "font-medium text-amber-700"}>
                      {e.plate}
                      {!knownPlates.has(e.plate) && " ⚠"}
                    </td>
                    <td>{e.driverCode ?? "-"}</td>
                    <td className="text-slate-500">{e.station ?? "-"}</td>
                    <td className="num text-slate-500">{e.mileage != null ? num(e.mileage, 0) : "-"}</td>
                    <td className="num">{num(e.litres, 2)}</td>
                    <td className="num">{num(e.pricePerL, 2)}</td>
                    <td className="num font-medium">{baht(e.amount)}</td>
                    <td className="font-mono text-[11px] text-slate-400">{e.refNo}</td>
                    <td className="no-print">
                      <DeleteFuelButton id={e.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6}>รวม {entries.length} รายการ</td>
                  <td className="num">{num(totals.litres, 2)}</td>
                  <td className="num">{num(avgPrice, 2)}</td>
                  <td className="num">{baht(totals.amount)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
