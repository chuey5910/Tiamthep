import Link from "next/link";
import { Badge, Card, Empty, PageHeader, Stat } from "@/components/ui";
import { Breakdown } from "@/components/Breakdown";
import { endOfMonth, formatThaiDate, startOfMonth } from "@/lib/date";
import { baht, pct } from "@/lib/format";
import { companyPnl, documentAlerts, expenseReport, loadPeriod, stockBalance, vehiclePnl } from "@/lib/reports";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const now = new Date();
  const from = startOfMonth(now.getFullYear(), now.getMonth() + 1);
  const to = endOfMonth(now.getFullYear(), now.getMonth() + 1);

  const data = await loadPeriod({ from, to });
  const pnl = companyPnl(data);
  const alerts = await documentAlerts(data.ctx.docAlertDays);
  const stock = await stockBalance();
  const expenses = expenseReport(data);
  const vehicles = vehiclePnl(data).filter((v) => v.legs > 0);

  const [vehicleCount, driverCount, customerCount, routeCount, fuelPriceCount] = await Promise.all([
    prisma.vehicle.count({ where: { active: true } }),
    prisma.driver.count({ where: { active: true } }),
    prisma.customer.count({ where: { active: true } }),
    prisma.route.count({ where: { active: true } }),
    prisma.fuelPrice.count(),
  ]);

  // ปัญหาที่ต้องแก้ก่อนตัวเลขจะถูก
  const issueCounts = new Map<string, number>();
  for (const j of data.ranJobs) {
    for (const i of data.calcs.get(j.id)!.issues) issueCounts.set(i, (issueCounts.get(i) ?? 0) + 1);
  }
  const issues = [...issueCounts.entries()].sort((a, b) => b[1] - a[1]);

  const lowStock = stock.filter((s) => s.needsReorder);
  const expired = alerts.filter((a) => a.severity === "expired");
  const soon = alerts.filter((a) => a.severity === "soon");

  const monthLabel = `${from.getUTCDate()}–${to.getUTCDate()} ${formatThaiDate(to).split(" ").slice(1).join(" ")}`;

  return (
    <>
      <PageHeader
        title="ภาพรวมกิจการ"
        subtitle={`ตัวเลขเดือนนี้ (${monthLabel}) — คลิกที่การ์ดเพื่อดูรายงานฉบับเต็ม`}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/reports/revenue">
          <Stat label="รายได้เดือนนี้" value={baht(pnl.totalRevenue)} hint={`${data.billedJobs.length} ขาที่เรียกเก็บ`} />
        </Link>
        <Link href="/reports/expenses">
          <Stat label="ต้นทุนเดือนนี้" value={baht(pnl.totalCost)} hint="บาท" />
        </Link>
        <Link href="/reports/company">
          <Stat
            label={pnl.netProfit >= 0 ? "กำไรสุทธิ" : "ขาดทุนสุทธิ"}
            value={baht(pnl.netProfit)}
            hint={`อัตรากำไร ${pct(pnl.margin)}`}
            tone={pnl.netProfit >= 0 ? "good" : "bad"}
          />
        </Link>
        <Link href="/reports/fuel-bonus">
          <Stat
            label="เงินพิเศษน้ำมันที่ต้องจ่าย"
            value={baht(data.bonuses.reduce((a, b) => a + b.bonus, 0))}
            hint={`${data.bonuses.length} รอบ`}
          />
        </Link>
      </div>

      {issues.length > 0 && (
        <Card
          title="⚠ ข้อมูลที่ต้องแก้ก่อน ตัวเลขถึงจะถูกต้อง"
          className="mb-4 border-amber-300"
          bodyClass="p-4"
        >
          <ul className="space-y-1.5 text-[13px]">
            {issues.slice(0, 8).map(([msg, count]) => (
              <li key={msg} className="flex items-start gap-2">
                <Badge tone="warn">{count} ขา</Badge>
                <span className="text-slate-700">{msg}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-slate-500">
            แก้ไขที่หน้า <Link href="/db/routes" className="text-brand-700 underline">เส้นทาง</Link> ·{" "}
            <Link href="/db/pairings" className="text-brand-700 underline">จับคู่รถ</Link> ·{" "}
            <Link href="/db/fuel-prices" className="text-brand-700 underline">ราคาน้ำมัน</Link>
          </p>
        </Card>
      )}

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card
          title="ต้นทุนเดือนนี้แยกตามประเภท"
          actions={
            <Link href="/reports/expenses" className="text-[12px] text-brand-700 hover:underline">
              ดูทั้งหมด →
            </Link>
          }
        >
          <Breakdown rows={expenses.byCategory} limit={7} />
        </Card>

        <Card
          title="กำไรขาดทุนรายคัน (เดือนนี้)"
          actions={
            <Link href="/reports/vehicles" className="text-[12px] text-brand-700 hover:underline">
              ดูทั้งหมด →
            </Link>
          }
          bodyClass="p-0"
        >
          {vehicles.length === 0 ? (
            <Empty>ยังไม่มีงานในเดือนนี้</Empty>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>ทะเบียน</th>
                    <th className="num">ขา</th>
                    <th className="num">รายได้</th>
                    <th className="num">กำไร</th>
                  </tr>
                </thead>
                <tbody>
                  {vehicles.slice(0, 12).map((v) => (
                    <tr key={v.plate}>
                      <td className="font-medium">{v.plate}</td>
                      <td className="num">{v.legs}</td>
                      <td className="num">{baht(v.revenue)}</td>
                      <td className={`num font-semibold ${v.profit >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                        {baht(v.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card
          title={`เอกสารใกล้หมดอายุ (แจ้งล่วงหน้า ${data.ctx.docAlertDays} วัน)`}
          actions={
            expired.length > 0 ? <Badge tone="error">หมดอายุแล้ว {expired.length}</Badge> : <Badge tone="ok">ปกติ</Badge>
          }
          bodyClass="p-0"
        >
          {alerts.length === 0 ? (
            <Empty>ไม่มีเอกสารที่ต้องต่ออายุในช่วงนี้</Empty>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>ประเภท</th>
                    <th>รายการ</th>
                    <th>เอกสาร</th>
                    <th>วันหมดอายุ</th>
                    <th className="num">คงเหลือ</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.slice(0, 30).map((a, i) => (
                    <tr key={i}>
                      <td className="text-slate-500">{a.kind}</td>
                      <td className="font-medium">{a.subject}</td>
                      <td>{a.label}</td>
                      <td className="whitespace-nowrap">{formatThaiDate(a.date)}</td>
                      <td className="num">
                        {a.severity === "expired" ? (
                          <Badge tone="error">เกิน {Math.abs(a.daysLeft)} วัน</Badge>
                        ) : (
                          <Badge tone="warn">อีก {a.daysLeft} วัน</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {alerts.length > 30 && (
            <p className="px-4 py-2 text-[12px] text-slate-400">
              และอีก {alerts.length - 30} รายการ — ดูครบที่หน้าข้อมูลรถ / ข้อมูลพนักงานขับรถ
            </p>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="สต็อกที่ต้องสั่งซื้อ" bodyClass="p-0">
            {lowStock.length === 0 ? (
              <Empty>สต็อกทุกรายการยังเพียงพอ</Empty>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>สินค้า</th>
                    <th className="num">คงเหลือ</th>
                    <th className="num">จุดสั่งซื้อ</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStock.map((s) => (
                    <tr key={s.code}>
                      <td>{s.name}</td>
                      <td className="num font-semibold text-red-700">
                        {s.balance} {s.unit}
                      </td>
                      <td className="num text-slate-500">{s.reorderPoint}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="ข้อมูลในระบบ">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-slate-500">รถ</dt>
              <dd className="text-right font-semibold">{vehicleCount} คัน</dd>
              <dt className="text-slate-500">พนักงานขับรถ</dt>
              <dd className="text-right font-semibold">{driverCount} คน</dd>
              <dt className="text-slate-500">ลูกค้า</dt>
              <dd className="text-right font-semibold">{customerCount} ราย</dd>
              <dt className="text-slate-500">เส้นทางที่ตั้งราคาแล้ว</dt>
              <dd className="text-right font-semibold">{routeCount} เส้นทาง</dd>
              <dt className="text-slate-500">ประกาศราคาน้ำมัน</dt>
              <dd className="text-right font-semibold">{fuelPriceCount} รายการ</dd>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
