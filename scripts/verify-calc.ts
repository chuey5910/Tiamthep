import { buildContext, resolveReferencePrice, bandFor, computeJob, priceOnDate, averagePrice } from "../src/lib/calc";
import { prisma } from "../src/lib/prisma";
import { loadPeriod, companyPnl, vehiclePnl, driverPnl, expenseReport, revenueReport, allowanceReport, fuelBonusReport, partnerSettlement } from "../src/lib/reports";
import { utcDate } from "../src/lib/date";

async function main() {
  const ctx = await buildContext();
  console.log("ราคาน้ำมัน:", ctx.fuelPrices.map(p => `${p.date.toISOString().slice(0,10)}=${p.price}`).join(", "));

  const bases = await prisma.fuelPriceBasis.findMany();
  const jobDate = utcDate(2026, 7, 5);
  console.log("\n=== ราคาอ้างอิงสำหรับงานวันที่ 2026-07-05 ===");
  for (const b of bases) {
    const p = resolveReferencePrice(ctx.fuelPrices, b, jobDate);
    const band = bandFor(ctx.bands, p);
    console.log(`  ${b.name.padEnd(34)} → ${p} → ${band?.label}`);
  }

  console.log("\n=== ตรวจสูตรเฉลี่ยด้วยมือ ===");
  console.log("  เฉลี่ย ก.ค. 1-31:", averagePrice(ctx.fuelPrices, utcDate(2026,7,1), utcDate(2026,7,31)), "(คาดหวัง 35.02)");
  console.log("  เฉลี่ย 16 พ.ค. - 15 มิ.ย.:", averagePrice(ctx.fuelPrices, utcDate(2026,5,16), utcDate(2026,6,15)), "(คาดหวัง 34.5)");
  console.log("  ราคา ณ 2026-07-15:", priceOnDate(ctx.fuelPrices, utcDate(2026,7,15)), "(คาดหวัง 34.94)");

  const d = await loadPeriod({ from: utcDate(2026,7,1), to: utcDate(2026,7,31) });
  console.log(`\n=== ข้อมูล ก.ค. 2026: งาน ${d.ranJobs.length} ขา / เรียกเก็บ ${d.billedJobs.length} ขา ===`);

  const issues = new Map<string, number>();
  for (const [,c] of d.calcs) for (const i of c.issues) issues.set(i, (issues.get(i)??0)+1);
  console.log("ปัญหาที่พบ:", issues.size ? [...issues].map(([k,v])=>`${k} (${v})`).join(" | ") : "ไม่มี");

  const sample = d.billedJobs.slice(0,2);
  for (const j of sample) {
    const c = d.calcs.get(j.id)!;
    console.log(`\n  งาน #${j.id} ${j.origin}→${j.destination} ${j.headPlate}`);
    console.log(`    พขร=${c.driverCode} เจ้าของ=${c.ownerType} น้ำมันอ้างอิง=${c.referencePrice} ช่วง=${c.bandLabel}`);
    console.log(`    หน่วย=${c.priceUnit} น้ำหนัก=${c.billingWeight} เรท=${c.customerRate} รายได้=${c.revenue} จ่ายรถร่วม=${c.outsourcePay}`);
    console.log(`    ระยะทาง=${c.distanceKm} KPI=${c.kpiLitres}L เบี้ยเลี้ยง=${c.allowance}`);
  }

  const pnl = companyPnl(d);
  console.log("\n=== งบกำไรขาดทุน ก.ค. 2026 ===");
  console.log("  รายได้รถบริษัท:", pnl.revenueOwn.toLocaleString());
  console.log("  รายได้งานรถร่วม:", pnl.revenueOutsource.toLocaleString());
  console.log("  รวมรายได้:", pnl.totalRevenue.toLocaleString());
  for (const c of pnl.costs) console.log(`    ${c.label}: ${c.amount.toLocaleString()}`);
  console.log("  รวมต้นทุน:", pnl.totalCost.toLocaleString());
  console.log("  กำไรสุทธิ:", pnl.netProfit.toLocaleString(), `(${pnl.margin}%)`);

  const vp = vehiclePnl(d).filter(r=>r.legs>0);
  console.log("\n=== กำไรขาดทุนรายคัน (เฉพาะที่มีงาน) ===");
  for (const r of vp) console.log(`  ${r.plate} [${r.ownerType}] ขา=${r.legs} รายได้=${r.revenue.toLocaleString()} ต้นทุน=${r.totalCost.toLocaleString()} กำไร=${r.profit.toLocaleString()}`);

  const dp = driverPnl(d).filter(r=>r.legs>0);
  console.log("\n=== กำไรขาดทุนราย พขร. ===");
  for (const r of dp) console.log(`  ${r.driverCode} ${r.name} ขา=${r.legs} รายได้=${r.revenue.toLocaleString()} กำไร=${r.profit.toLocaleString()}`);

  console.log("\n=== ค่าใช้จ่ายแยกประเภท ===");
  const er = expenseReport(d);
  for (const r of er.byCategory) console.log(`  ${r.label}: ${r.amount.toLocaleString()} (${r.share}%)`);
  console.log("  รวม:", er.total.toLocaleString());

  console.log("\n=== รายได้แยกลูกค้า ===");
  for (const r of revenueReport(d).byCustomer) console.log(`  ${r.label}: ${r.amount.toLocaleString()} (${r.share}%)`);

  console.log("\n=== เบี้ยเลี้ยง (ทั้งเดือน) ===");
  for (const r of allowanceReport(d)) console.log(`  ${r.driverCode} ขา=${r.legs} เบี้ยเลี้ยง=${r.allowance} -เงินเดินทาง=${r.advance} +ทางด่วน=${r.toll} +พิเศษน้ำมัน=${r.fuelBonus} => จ่ายสุทธิ=${r.netPay}`);

  console.log("\n=== เงินพิเศษน้ำมัน (5 รอบแรก) ===");
  for (const b of fuelBonusReport(d).slice(0,5)) console.log(`  ${b.tripCode} ขา=${b.legs} KPI=${b.kpiLitres}L ใช้จริง=${b.usedLitres}L ประหยัด=${b.savedLitres}L => ${b.bonus} บาท`);

  const partner = await prisma.partner.findFirst();
  if (partner) {
    const s = partnerSettlement(d, partner.name);
    console.log(`\n=== จ่ายรถร่วม: ${s.partnerName} ===`);
    console.log(`  ค่าบรรทุก=${s.freight.toLocaleString()} หักน้ำมัน=${s.fuelDeduction.toLocaleString()} หักค่าใช้จ่าย=${s.expenseDeduction.toLocaleString()} => จ่ายสุทธิ=${s.netPay.toLocaleString()}`);
    console.log(`  งาน ${s.jobs.length} ขา, เติมน้ำมัน ${s.fuel.length} ครั้ง`);
  }
  await prisma.$disconnect();
}
main();
