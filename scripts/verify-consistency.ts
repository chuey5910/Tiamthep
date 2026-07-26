/**
 * ตรวจว่าตัวเลขในรายงานทุกหน้าสอดคล้องกัน
 * รันด้วย: npx tsx scripts/verify-consistency.ts
 */
import { prisma } from "../src/lib/prisma";
import { utcDate } from "../src/lib/date";
import {
  allowanceReport, companyPnl, driverPnl, expenseReport,
  loadPeriod, revenueReport, vehiclePnl,
} from "../src/lib/reports";

const r2 = (n: number) => Math.round(n * 100) / 100;
let failures = 0;

function check(label: string, actual: number, expected: number, tolerance = 0.05) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "✓" : "✗"} ${label.padEnd(46)} ${r2(actual).toLocaleString().padStart(14)} vs ${r2(expected).toLocaleString().padStart(14)}`,
  );
}

async function main() {
  const from = utcDate(2026, 7, 1);
  const to = utcDate(2026, 7, 31);
  const d = await loadPeriod({ from, to });

  const pnl = companyPnl(d);
  const exp = expenseReport(d);
  const rev = revenueReport(d);
  const veh = vehiclePnl(d);
  const drv = driverPnl(d);
  const allow = allowanceReport(d);

  console.log("ตรวจสอบความสอดคล้องของรายงาน (ก.ค. 2569)\n");

  console.log("รายงานค่าใช้จ่าย ต้องรวมเท่ากับต้นทุนในงบกำไรขาดทุน ทุกมุมมอง:");
  check("รวมทั้งรายงาน", exp.total, pnl.totalCost);
  check("แยกตามประเภท", exp.byCategory.reduce((a, b) => a + b.amount, 0), pnl.totalCost);
  check("แยกตามทะเบียน", exp.byVehicle.reduce((a, b) => a + b.amount, 0), pnl.totalCost);
  check("แยกตาม พขร.", exp.byDriver.reduce((a, b) => a + b.amount, 0), pnl.totalCost);
  check("แยกตามผู้ให้บริการ", exp.bySupplier.reduce((a, b) => a + b.amount, 0), pnl.totalCost);

  console.log("\nรายงานรายได้ ต้องรวมเท่ากับรายได้ในงบกำไรขาดทุน ทุกมุมมอง:");
  check("แยกตามลูกค้า", rev.byCustomer.reduce((a, b) => a + b.amount, 0), pnl.totalRevenue);
  check("แยกตามทะเบียน", rev.byVehicle.reduce((a, b) => a + b.amount, 0), pnl.totalRevenue);
  check("แยกตามประเภทรถ", rev.byVehicleType.reduce((a, b) => a + b.amount, 0), pnl.totalRevenue);
  check("รวมกำไรขาดทุนรายคัน", veh.reduce((a, b) => a + b.revenue, 0), pnl.totalRevenue);

  console.log("\nกำไรรายคันรวม + ค่าใช้จ่ายที่ไม่ผูกทะเบียน ต้องเท่ากับกำไรสุทธิของกิจการ:");
  const unallocated = exp.byVehicle.find((r) => r.key === "__none__")?.amount ?? 0;
  check("กำไรรายคันรวม − ค่าใช้จ่ายส่วนกลาง", veh.reduce((a, b) => a + b.profit, 0) - unallocated, pnl.netProfit);

  console.log("\nเบี้ยเลี้ยงทั้งเดือน (งวด 1 + งวด 2) ต้องเท่ากับที่คิดรวดเดียว:");
  const p1 = allowanceReport(await loadPeriod({ from: utcDate(2026, 7, 1), to: utcDate(2026, 7, 15) }));
  const p2 = allowanceReport(await loadPeriod({ from: utcDate(2026, 7, 16), to: utcDate(2026, 7, 31) }));
  check(
    "เบี้ยเลี้ยงรวม",
    p1.reduce((a, b) => a + b.allowance, 0) + p2.reduce((a, b) => a + b.allowance, 0),
    allow.reduce((a, b) => a + b.allowance, 0),
  );
  check(
    "จ่ายสุทธิรวม",
    p1.reduce((a, b) => a + b.netPay, 0) + p2.reduce((a, b) => a + b.netPay, 0),
    allow.reduce((a, b) => a + b.netPay, 0),
  );

  console.log("\nกำไรขาดทุนราย พขร. ต้องไม่เกินรายได้รวมของกิจการ:");
  check("รายได้ราย พขร. รวม ≤ รายได้กิจการ", Math.min(drv.reduce((a, b) => a + b.revenue, 0), pnl.totalRevenue), drv.reduce((a, b) => a + b.revenue, 0));

  console.log(failures === 0 ? "\nผ่านทุกข้อ ✓" : `\nไม่ผ่าน ${failures} ข้อ ✗`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main();
