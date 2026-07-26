/**
 * รายงานทั้งหมดของระบบ
 *
 * หลักการนับวันที่ (สำคัญ — ใช้เหมือนกันทุกรายงาน):
 *   • รายได้ค่าบรรทุกและค่าจ้างรถร่วม  → นับตาม "วันที่เรียกเก็บเงิน"
 *     (ส่วนใหญ่คือวันขึ้นสินค้า มีบางลูกค้าใช้วันลงสินค้า ตั้งได้รายลูกค้า)
 *   • เบี้ยเลี้ยง จำนวนขา และ KPI น้ำมัน → นับตาม "วันขึ้นสินค้า"
 *   • ค่าน้ำมัน ค่าใช้จ่าย เงินเดินทาง    → นับตามวันที่ของเอกสารนั้นๆ
 */

import { prisma } from "./prisma";
import {
  buildContext,
  computeFuelBonuses,
  computeJob,
  round2,
  type CalcContext,
  type JobCalc,
  type JobInput,
  type TripFuelBonus,
} from "./calc";
import { addDays } from "./date";

export type Period = { from: Date; to: Date };

function inPeriod(d: Date, p: Period): boolean {
  return d.getTime() >= p.from.getTime() && d.getTime() <= p.to.getTime();
}

export type PeriodData = Awaited<ReturnType<typeof loadPeriod>>;

/**
 * โหลดข้อมูลดิบทั้งหมดของช่วงเวลาหนึ่ง แล้วคำนวณรายขาให้เสร็จในรอบเดียว
 * รายงานทุกตัวใช้ผลลัพธ์ก้อนนี้ร่วมกัน จึงไม่มีทางที่ตัวเลขจะขัดกันเอง
 */
export async function loadPeriod(period: Period) {
  const ctx = await buildContext();

  // ขยายช่วงที่ดึงงานออกไปข้างละ 1 เดือน เผื่องานที่วันขึ้นกับวันลงสินค้าคนละเดือน
  const wide = { from: addDays(period.from, -35), to: addDays(period.to, 35) };

  const [jobsRaw, fuel, expenses, advances, overridesRaw, stockOuts, vendorBills, drivers] =
    await Promise.all([
      prisma.job.findMany({
        where: { loadDate: { gte: wide.from, lte: wide.to } },
        orderBy: [{ loadDate: "asc" }, { id: "asc" }],
      }),
      prisma.fuelEntry.findMany({ where: { date: { gte: wide.from, lte: wide.to } } }),
      prisma.expense.findMany({ where: { date: { gte: period.from, lte: period.to } } }),
      prisma.travelAdvance.findMany({ where: { date: { gte: period.from, lte: period.to } } }),
      prisma.fuelBonusOverride.findMany(),
      prisma.stockOut.findMany({ where: { date: { gte: period.from, lte: period.to } } }),
      prisma.vendorBill.findMany({ where: { date: { gte: period.from, lte: period.to } } }),
      prisma.driver.findMany(),
    ]);

  const jobs: JobInput[] = jobsRaw;
  const calcs = new Map<number, JobCalc>();
  for (const j of jobs) calcs.set(j.id, computeJob(ctx, j));

  const overrides = new Map(overridesRaw.map((o) => [o.tripCode, o.actualLitres]));
  const bonuses = computeFuelBonuses(ctx, jobs, calcs, fuel, overrides);

  // งานที่ "เรียกเก็บเงิน" ในช่วงนี้ (ใช้กับรายได้)
  const billedJobs = jobs.filter((j) => inPeriod(calcs.get(j.id)!.billingDate, period));
  // งานที่ "วิ่ง" ในช่วงนี้ (ใช้กับเบี้ยเลี้ยง / จำนวนขา)
  const ranJobs = jobs.filter((j) => inPeriod(j.loadDate, period));
  const fuelInPeriod = fuel.filter((f) => inPeriod(f.date, period));
  const bonusesInPeriod = bonuses.filter((b) => inPeriod(b.endDate, period));

  return {
    ctx,
    period,
    jobs,
    calcs,
    billedJobs,
    ranJobs,
    fuel: fuelInPeriod,
    expenses,
    advances,
    bonuses: bonusesInPeriod,
    allBonuses: bonuses,
    stockOuts,
    vendorBills,
    drivers,
  };
}

const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));

// ─────────────────────────────────────────────────────────────
// 1. กำไรขาดทุน แยกตามทะเบียนรถ
// ─────────────────────────────────────────────────────────────

export type VehiclePnlRow = {
  plate: string;
  vehicleType: string;
  ownerType: string;
  partnerName: string | null;
  legs: number;
  revenue: number;
  fuelCost: number;
  allowance: number;
  toll: number;
  fuelBonus: number;
  otherExpense: number;
  partsCost: number;
  garageCost: number;
  outsourcePay: number;
  totalCost: number;
  profit: number;
};

export function vehiclePnl(d: PeriodData): VehiclePnlRow[] {
  const rows = new Map<string, VehiclePnlRow>();

  const blank = (plate: string): VehiclePnlRow => {
    const v = d.ctx.vehicleByPlate.get(plate);
    return {
      plate,
      vehicleType: v?.vehicleType ?? "-",
      ownerType: v?.ownerType ?? "รถบริษัท",
      partnerName: v?.partner?.name ?? null,
      legs: 0,
      revenue: 0,
      fuelCost: 0,
      allowance: 0,
      toll: 0,
      fuelBonus: 0,
      otherExpense: 0,
      partsCost: 0,
      garageCost: 0,
      outsourcePay: 0,
      totalCost: 0,
      profit: 0,
    };
  };
  const get = (plate: string) => {
    let r = rows.get(plate);
    if (!r) {
      r = blank(plate);
      rows.set(plate, r);
    }
    return r;
  };

  // แสดงรถทุกคันที่มีในฐานข้อมูล แม้เดือนนี้ไม่มีงาน
  for (const v of d.ctx.vehicles) get(v.plate);

  for (const j of d.billedJobs) {
    const c = d.calcs.get(j.id)!;
    const r = get(j.headPlate.trim());
    r.revenue += c.revenue;
    r.outsourcePay += c.outsourcePay;
  }
  for (const j of d.ranJobs) {
    const c = d.calcs.get(j.id)!;
    const r = get(j.headPlate.trim());
    r.legs += 1;
    r.allowance += c.allowance;
  }
  for (const f of d.fuel) get(f.plate.trim()).fuelCost += f.amount;
  for (const a of d.advances) if (a.plate) get(a.plate.trim()).toll += a.toll;
  for (const b of d.bonuses) get(b.plate).fuelBonus += b.bonus;
  for (const e of d.expenses) if (e.plate) get(e.plate.trim()).otherExpense += e.amount;
  for (const s of d.stockOuts) if (s.plate) get(s.plate.trim()).partsCost += s.cost;

  // ค่าแรงอู่: บิลผูกกับใบสั่งซ่อม จึงต้องย้อนไปหาทะเบียนจากรายการเบิก
  const plateByWorkOrder = new Map<string, string>();
  for (const s of d.stockOuts) {
    if (s.workOrder && s.vendor && s.plate) plateByWorkOrder.set(`${s.workOrder}|${s.vendor}`, s.plate.trim());
  }
  for (const b of d.vendorBills) {
    const plate = plateByWorkOrder.get(`${b.workOrder}|${b.vendor}`);
    if (plate) get(plate).garageCost += b.amount;
  }

  for (const r of rows.values()) {
    // รถร่วม: ต้นทุนคือค่าจ้างที่จ่ายให้เขา (ค่าน้ำมัน/ค่าใช้จ่ายที่บริษัทออกแทน หักคืนตอนจ่าย)
    r.totalCost =
      r.ownerType === "รถร่วม"
        ? round2(r.outsourcePay)
        : round2(r.fuelCost + r.allowance + r.toll + r.fuelBonus + r.otherExpense + r.partsCost + r.garageCost);
    r.revenue = round2(r.revenue);
    r.fuelCost = round2(r.fuelCost);
    r.allowance = round2(r.allowance);
    r.toll = round2(r.toll);
    r.fuelBonus = round2(r.fuelBonus);
    r.otherExpense = round2(r.otherExpense);
    r.partsCost = round2(r.partsCost);
    r.garageCost = round2(r.garageCost);
    r.outsourcePay = round2(r.outsourcePay);
    r.profit = round2(r.revenue - r.totalCost);
  }

  return [...rows.values()].sort((a, b) => b.profit - a.profit);
}

// ─────────────────────────────────────────────────────────────
// 2. กำไรขาดทุน แยกตาม พขร.
// ─────────────────────────────────────────────────────────────

export type DriverPnlRow = {
  driverCode: string;
  name: string;
  legs: number;
  revenue: number;
  fuelCost: number;
  allowance: number;
  toll: number;
  fuelBonus: number;
  otherExpense: number;
  totalCost: number;
  profit: number;
};

export function driverPnl(d: PeriodData): DriverPnlRow[] {
  const nameOf = new Map(d.drivers.map((x) => [x.code, `${x.firstName} ${x.lastName}`.trim()]));
  const rows = new Map<string, DriverPnlRow>();
  const get = (code: string) => {
    let r = rows.get(code);
    if (!r) {
      r = {
        driverCode: code,
        name: nameOf.get(code) ?? "(ไม่พบในฐานข้อมูล)",
        legs: 0,
        revenue: 0,
        fuelCost: 0,
        allowance: 0,
        toll: 0,
        fuelBonus: 0,
        otherExpense: 0,
        totalCost: 0,
        profit: 0,
      };
      rows.set(code, r);
    }
    return r;
  };

  for (const x of d.drivers) if (x.active) get(x.code);

  for (const j of d.billedJobs) {
    const c = d.calcs.get(j.id)!;
    if (c.driverCode) get(c.driverCode).revenue += c.revenue;
  }
  for (const j of d.ranJobs) {
    const c = d.calcs.get(j.id)!;
    if (!c.driverCode) continue;
    const r = get(c.driverCode);
    r.legs += 1;
    r.allowance += c.allowance;
  }
  for (const f of d.fuel) if (f.driverCode) get(f.driverCode).fuelCost += f.amount;
  for (const a of d.advances) get(a.driverCode).toll += a.toll;
  for (const b of d.bonuses) if (b.driverCode) get(b.driverCode).fuelBonus += b.bonus;
  for (const e of d.expenses) if (e.driverCode) get(e.driverCode).otherExpense += e.amount;

  for (const r of rows.values()) {
    r.revenue = round2(r.revenue);
    r.fuelCost = round2(r.fuelCost);
    r.allowance = round2(r.allowance);
    r.toll = round2(r.toll);
    r.fuelBonus = round2(r.fuelBonus);
    r.otherExpense = round2(r.otherExpense);
    r.totalCost = round2(r.fuelCost + r.allowance + r.toll + r.fuelBonus + r.otherExpense);
    r.profit = round2(r.revenue - r.totalCost);
  }

  return [...rows.values()].sort((a, b) => b.profit - a.profit);
}

// ─────────────────────────────────────────────────────────────
// 3. งบกำไรขาดทุนของกิจการ
// ─────────────────────────────────────────────────────────────

export type CompanyPnl = {
  revenueOwn: number;
  revenueOutsource: number;
  totalRevenue: number;
  costs: { label: string; amount: number }[];
  totalCost: number;
  netProfit: number;
  margin: number;
};

export function companyPnl(d: PeriodData): CompanyPnl {
  const revenueOwn = sum(
    d.billedJobs.filter((j) => d.calcs.get(j.id)!.ownerType !== "รถร่วม").map((j) => d.calcs.get(j.id)!.revenue),
  );
  const revenueOutsource = sum(
    d.billedJobs.filter((j) => d.calcs.get(j.id)!.ownerType === "รถร่วม").map((j) => d.calcs.get(j.id)!.revenue),
  );
  const totalRevenue = round2(revenueOwn + revenueOutsource);

  const outsourcePlates = new Set(
    d.ctx.vehicles.filter((v) => v.ownerType === "รถร่วม").map((v) => v.plate),
  );
  const isOwn = (plate: string | null | undefined) => !plate || !outsourcePlates.has(plate.trim());

  // ค่าน้ำมันและค่าใช้จ่ายของรถร่วม บริษัทออกแทนแล้วหักคืนตอนจ่ายค่าจ้าง
  // จึงไม่ถือเป็นต้นทุนของบริษัท (ไม่งั้นจะนับซ้ำกับค่าจ้างรถร่วม)
  const fuelOwn = sum(d.fuel.filter((f) => isOwn(f.plate)).map((f) => f.amount));
  const allowance = sum(d.ranJobs.map((j) => d.calcs.get(j.id)!.allowance));
  const toll = sum(d.advances.map((a) => a.toll));
  const fuelBonus = sum(d.bonuses.map((b) => b.bonus));
  const outsourcePay = sum(d.billedJobs.map((j) => d.calcs.get(j.id)!.outsourcePay));
  const parts = sum(d.stockOuts.map((s) => s.cost));
  const garage = sum(d.vendorBills.map((b) => b.amount));

  const byCategory = new Map<string, number>();
  for (const e of d.expenses) {
    if (!isOwn(e.plate)) continue;
    byCategory.set(e.category, round2((byCategory.get(e.category) ?? 0) + e.amount));
  }

  const costs = [
    { label: "ค่าน้ำมัน (เฉพาะรถบริษัท)", amount: fuelOwn },
    { label: "เบี้ยเลี้ยง พขร.", amount: allowance },
    { label: "ค่าทางด่วน (คืน พขร.)", amount: toll },
    { label: "เงินพิเศษค่าน้ำมัน (ซื้อคืน)", amount: fuelBonus },
    { label: "ค่าจ้างรถร่วม", amount: outsourcePay },
    { label: "ต้นทุนอะไหล่จากสต็อก", amount: parts },
    { label: "ค่าแรงอู่ (บิลผู้ขาย)", amount: garage },
    ...[...byCategory.entries()].map(([label, amount]) => ({ label, amount })),
  ].filter((c) => c.amount !== 0);

  const totalCost = sum(costs.map((c) => c.amount));
  const netProfit = round2(totalRevenue - totalCost);

  return {
    revenueOwn,
    revenueOutsource,
    totalRevenue,
    costs,
    totalCost,
    netProfit,
    margin: totalRevenue > 0 ? round2((netProfit / totalRevenue) * 100) : 0,
  };
}

// ─────────────────────────────────────────────────────────────
// 4. รายงานค่าใช้จ่าย
// ─────────────────────────────────────────────────────────────

export type Breakdown = { key: string; label: string; amount: number; share: number }[];

function toBreakdown(m: Map<string, { label: string; amount: number }>): Breakdown {
  const rows = [...m.entries()].map(([key, v]) => ({ key, label: v.label, amount: round2(v.amount) }));
  const total = rows.reduce((a, b) => a + b.amount, 0);
  return rows
    .filter((r) => r.amount !== 0)
    .map((r) => ({ ...r, share: total > 0 ? round2((r.amount / total) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

export type ExpenseReport = {
  byCategory: Breakdown;
  byVehicle: Breakdown;
  byDriver: Breakdown;
  bySupplier: Breakdown;
  total: number;
};

/** รายการต้นทุน 1 บรรทัด — มีมิติครบทั้ง 4 แบบ จึงสรุปมุมไหนก็ได้ยอดรวมเท่ากันเสมอ */
type CostItem = {
  category: string;
  plate: string | null;
  driverCode: string | null;
  supplier: string | null;
  amount: number;
};

/**
 * รวบรวมต้นทุนทุกก้อนของช่วงเวลาไว้เป็นรายการเดียว
 *
 * ขอบเขตเดียวกับงบกำไรขาดทุนเป๊ะ — ยอดรวมของรายงานค่าใช้จ่ายจึงเท่ากับ
 * "รวมต้นทุนและค่าใช้จ่าย" ในงบกำไรขาดทุนเสมอ ไม่ว่าจะดูมุมไหน
 *
 * ค่าน้ำมันและค่าใช้จ่ายของรถร่วมไม่นับที่นี่ เพราะบริษัทออกแทนแล้วหักคืน
 * ตอนจ่ายค่าจ้าง — ต้นทุนจริงของรถร่วมคือ "ค่าจ้างรถร่วม" ก้อนเดียว
 */
function costLedger(d: PeriodData): CostItem[] {
  const items: CostItem[] = [];
  const outsourcePlates = new Set(d.ctx.vehicles.filter((v) => v.ownerType === "รถร่วม").map((v) => v.plate));
  const isOwn = (plate: string | null | undefined) => !plate || !outsourcePlates.has(plate.trim());

  for (const f of d.fuel) {
    if (!isOwn(f.plate) || f.amount === 0) continue;
    items.push({
      category: "น้ำมันเชื้อเพลิง",
      plate: f.plate.trim(),
      driverCode: f.driverCode,
      supplier: f.source === "FleetCard" ? "น้ำมัน Fleet Card" : "น้ำมันปั๊มบริษัท",
      amount: f.amount,
    });
  }

  for (const j of d.ranJobs) {
    const c = d.calcs.get(j.id)!;
    if (c.allowance === 0) continue;
    items.push({
      category: "ค่าเบี้ยเลี้ยง",
      plate: j.headPlate.trim(),
      driverCode: c.driverCode,
      supplier: null,
      amount: c.allowance,
    });
  }

  for (const a of d.advances) {
    if (a.toll === 0) continue;
    items.push({
      category: "ค่าทางด่วน",
      plate: a.plate?.trim() ?? null,
      driverCode: a.driverCode,
      supplier: null,
      amount: a.toll,
    });
  }

  for (const b of d.bonuses) {
    if (b.bonus === 0) continue;
    items.push({
      category: "เงินพิเศษค่าน้ำมัน",
      plate: b.plate,
      driverCode: b.driverCode,
      supplier: null,
      amount: b.bonus,
    });
  }

  for (const j of d.billedJobs) {
    const c = d.calcs.get(j.id)!;
    if (c.outsourcePay === 0) continue;
    items.push({
      category: "ค่าจ้างรถร่วม",
      plate: j.headPlate.trim(),
      driverCode: null,
      supplier: c.partnerName,
      amount: c.outsourcePay,
    });
  }

  for (const e of d.expenses) {
    if (!isOwn(e.plate) || e.amount === 0) continue;
    items.push({
      category: e.category,
      plate: e.plate?.trim() ?? null,
      driverCode: e.driverCode,
      supplier: e.supplier,
      amount: e.amount,
    });
  }

  for (const s of d.stockOuts) {
    if (s.cost === 0) continue;
    items.push({
      category: "อะไหล่จากสต็อก",
      plate: s.plate?.trim() ?? null,
      driverCode: null,
      supplier: s.vendor,
      amount: s.cost,
    });
  }

  const plateByWorkOrder = new Map<string, string>();
  for (const s of d.stockOuts) {
    if (s.workOrder && s.vendor && s.plate) plateByWorkOrder.set(`${s.workOrder}|${s.vendor}`, s.plate.trim());
  }
  for (const b of d.vendorBills) {
    if (b.amount === 0) continue;
    items.push({
      category: "ค่าแรงอู่",
      plate: plateByWorkOrder.get(`${b.workOrder}|${b.vendor}`) ?? null,
      driverCode: null,
      supplier: b.vendor,
      amount: b.amount,
    });
  }

  return items;
}

export function expenseReport(d: PeriodData): ExpenseReport {
  const nameOf = new Map(d.drivers.map((x) => [x.code, `${x.firstName} ${x.lastName}`.trim()]));
  const items = costLedger(d);

  const group = (pick: (i: CostItem) => { key: string; label: string }): Breakdown => {
    const m = new Map<string, { label: string; amount: number }>();
    for (const it of items) {
      const { key, label } = pick(it);
      const cur = m.get(key);
      if (cur) cur.amount += it.amount;
      else m.set(key, { label, amount: it.amount });
    }
    return toBreakdown(m);
  };

  const byCategory = group((i) => ({ key: i.category, label: i.category }));

  return {
    byCategory,
    byVehicle: group((i) => ({
      key: i.plate ?? "__none__",
      label: i.plate ?? "(ค่าใช้จ่ายส่วนกลาง — ไม่ผูกทะเบียน)",
    })),
    byDriver: group((i) => ({
      key: i.driverCode ?? "__none__",
      label: i.driverCode ? `${i.driverCode} ${nameOf.get(i.driverCode) ?? ""}`.trim() : "(ไม่ผูกกับ พขร.)",
    })),
    bySupplier: group((i) => ({
      key: i.supplier ?? "__none__",
      label: i.supplier ?? "(ไม่ระบุผู้ให้บริการ)",
    })),
    total: sum(items.map((i) => i.amount)),
  };
}

// ─────────────────────────────────────────────────────────────
// 5. รายงานรายได้
// ─────────────────────────────────────────────────────────────

export type RevenueReport = {
  byCustomer: Breakdown;
  byVehicle: Breakdown;
  byDriver: Breakdown;
  byVehicleType: Breakdown;
  legsByCustomer: Map<string, number>;
  total: number;
};

export function revenueReport(d: PeriodData): RevenueReport {
  const nameOf = new Map(d.drivers.map((x) => [x.code, `${x.firstName} ${x.lastName}`.trim()]));
  const cus = new Map<string, { label: string; amount: number }>();
  const veh = new Map<string, { label: string; amount: number }>();
  const drv = new Map<string, { label: string; amount: number }>();
  const typ = new Map<string, { label: string; amount: number }>();
  const legs = new Map<string, number>();

  const add = (m: Map<string, { label: string; amount: number }>, key: string, label: string, amt: number) => {
    const cur = m.get(key);
    if (cur) cur.amount += amt;
    else m.set(key, { label, amount: amt });
  };

  for (const j of d.billedJobs) {
    const c = d.calcs.get(j.id)!;
    const customer = d.ctx.customerById.get(j.customerId);
    const ckey = customer?.code ?? String(j.customerId);
    add(cus, ckey, `${ckey} ${customer?.name ?? ""}`.trim(), c.revenue);
    legs.set(ckey, (legs.get(ckey) ?? 0) + 1);
    add(veh, j.headPlate.trim(), j.headPlate.trim(), c.revenue);
    if (c.driverCode) add(drv, c.driverCode, `${c.driverCode} ${nameOf.get(c.driverCode) ?? ""}`.trim(), c.revenue);
    if (c.vehicleType) add(typ, c.vehicleType, c.vehicleType, c.revenue);
  }

  const byCustomer = toBreakdown(cus);
  return {
    byCustomer,
    byVehicle: toBreakdown(veh),
    byDriver: toBreakdown(drv),
    byVehicleType: toBreakdown(typ),
    legsByCustomer: legs,
    total: sum(byCustomer.map((r) => r.amount)),
  };
}

// ─────────────────────────────────────────────────────────────
// 6. สรุปเบี้ยเลี้ยง พขร. รายงวด
// ─────────────────────────────────────────────────────────────

export type AllowanceRow = {
  driverCode: string;
  name: string;
  legs: number;
  allowance: number;
  advance: number;
  toll: number;
  fuelBonus: number;
  netPay: number;
};

/**
 * สูตรตามนโยบายบริษัท (ต่อขา):
 *   เบี้ยเลี้ยงที่ได้จริง = เบี้ยเลี้ยงตามเส้นทาง − เงินเดินทางที่รับไปก่อน + ค่าทางด่วนที่สำรองจ่าย
 * แล้วรวมทั้งงวด (วันที่ 1-15 และ 16-สิ้นเดือน) บวกเงินพิเศษค่าน้ำมัน = ยอดจ่ายพร้อมเงินเดือน
 */
export function allowanceReport(d: PeriodData): AllowanceRow[] {
  const nameOf = new Map(d.drivers.map((x) => [x.code, `${x.firstName} ${x.lastName}`.trim()]));
  const rows = new Map<string, AllowanceRow>();
  const get = (code: string) => {
    let r = rows.get(code);
    if (!r) {
      r = {
        driverCode: code,
        name: nameOf.get(code) ?? "(ไม่พบในฐานข้อมูล)",
        legs: 0,
        allowance: 0,
        advance: 0,
        toll: 0,
        fuelBonus: 0,
        netPay: 0,
      };
      rows.set(code, r);
    }
    return r;
  };

  for (const j of d.ranJobs) {
    const c = d.calcs.get(j.id)!;
    if (!c.driverCode) continue;
    const r = get(c.driverCode);
    r.legs += 1;
    r.allowance += c.allowance;
  }
  for (const a of d.advances) {
    const r = get(a.driverCode);
    r.advance += a.advance;
    r.toll += a.toll;
  }
  for (const b of d.bonuses) if (b.driverCode) get(b.driverCode).fuelBonus += b.bonus;

  for (const r of rows.values()) {
    r.allowance = round2(r.allowance);
    r.advance = round2(r.advance);
    r.toll = round2(r.toll);
    r.fuelBonus = round2(r.fuelBonus);
    r.netPay = round2(r.allowance - r.advance + r.toll + r.fuelBonus);
  }

  return [...rows.values()].filter((r) => r.legs > 0 || r.advance !== 0 || r.netPay !== 0).sort((a, b) =>
    a.driverCode.localeCompare(b.driverCode),
  );
}

// ─────────────────────────────────────────────────────────────
// 7. เงินพิเศษค่าน้ำมัน
// ─────────────────────────────────────────────────────────────

export function fuelBonusReport(d: PeriodData): TripFuelBonus[] {
  return d.bonuses;
}

// ─────────────────────────────────────────────────────────────
// 8. รายงานการจ่ายเงินรถร่วม
// ─────────────────────────────────────────────────────────────

export type PartnerSettlement = {
  partnerName: string;
  freight: number;
  fuelDeduction: number;
  expenseDeduction: number;
  netPay: number;
  jobs: {
    date: Date;
    plate: string;
    route: string;
    customer: string;
    weight: number;
    unit: string;
    amount: number;
  }[];
  fuel: { date: Date; plate: string; source: string; litres: number; pricePerL: number; amount: number }[];
  expenses: { date: Date; plate: string | null; category: string; detail: string | null; amount: number }[];
};

/** ยอดจ่ายรถร่วม = ค่าบรรทุกที่ตกลงกัน − น้ำมันที่บริษัทออกให้ − ค่าใช้จ่ายที่บริษัทจ่ายแทน */
export function partnerSettlement(d: PeriodData, partnerName: string): PartnerSettlement {
  const plates = new Set(
    d.ctx.vehicles.filter((v) => v.partner?.name === partnerName).map((v) => v.plate),
  );

  const jobs = d.billedJobs
    .filter((j) => plates.has(j.headPlate.trim()))
    .map((j) => {
      const c = d.calcs.get(j.id)!;
      const customer = d.ctx.customerById.get(j.customerId);
      return {
        date: c.billingDate,
        plate: j.headPlate.trim(),
        route: `${j.origin} → ${j.destination}`,
        customer: customer?.code ?? customer?.name ?? "-",
        weight: c.billingWeight,
        unit: c.priceUnit,
        amount: c.outsourcePay,
      };
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const fuel = d.fuel
    .filter((f) => plates.has(f.plate.trim()))
    .map((f) => ({
      date: f.date,
      plate: f.plate.trim(),
      source: f.source,
      litres: f.litres,
      pricePerL: f.pricePerL,
      amount: f.amount,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const expenses = d.expenses
    .filter((e) => e.plate && plates.has(e.plate.trim()))
    .map((e) => ({ date: e.date, plate: e.plate, category: e.category, detail: e.detail, amount: e.amount }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const freight = sum(jobs.map((j) => j.amount));
  const fuelDeduction = sum(fuel.map((f) => f.amount));
  const expenseDeduction = sum(expenses.map((e) => e.amount));

  return {
    partnerName,
    freight,
    fuelDeduction,
    expenseDeduction,
    netPay: round2(freight - fuelDeduction - expenseDeduction),
    jobs,
    fuel,
    expenses,
  };
}

// ─────────────────────────────────────────────────────────────
// แจ้งเตือนเอกสารใกล้หมดอายุ
// ─────────────────────────────────────────────────────────────

export type Alert = {
  kind: string;
  subject: string;
  label: string;
  date: Date;
  daysLeft: number;
  severity: "expired" | "soon";
};

export async function documentAlerts(alertDays: number, today = new Date()): Promise<Alert[]> {
  const [vehicles, drivers] = await Promise.all([
    prisma.vehicle.findMany({ where: { active: true } }),
    prisma.driver.findMany({ where: { active: true } }),
  ]);

  const out: Alert[] = [];
  const push = (kind: string, subject: string, label: string, date: Date | null) => {
    if (!date) return;
    const daysLeft = Math.round((date.getTime() - new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())).getTime()) / 86400000);
    if (daysLeft > alertDays) return;
    out.push({ kind, subject, label, date, daysLeft, severity: daysLeft < 0 ? "expired" : "soon" });
  };

  for (const v of vehicles) {
    push("รถ", v.plate, "ภาษีรถ", v.taxDueDate);
    push("รถ", v.plate, "พ.ร.บ.", v.actDueDate);
    push("รถ", v.plate, "ประกันภัย", v.insuranceDue);
    push("รถ", v.plate, "ประกันสินค้า", v.cargoInsDue);
  }
  for (const dr of drivers) {
    push("พขร.", `${dr.code} ${dr.firstName} ${dr.lastName}`.trim(), "ใบขับขี่", dr.licenseExpiry);
  }

  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

// ─────────────────────────────────────────────────────────────
// สต็อกคงเหลือ
// ─────────────────────────────────────────────────────────────

export type StockBalanceRow = {
  code: string;
  name: string;
  unit: string;
  inQty: number;
  outQty: number;
  balance: number;
  reorderPoint: number;
  needsReorder: boolean;
};

export async function stockBalance(): Promise<StockBalanceRow[]> {
  const [items, ins, outs] = await Promise.all([
    prisma.inventoryItem.findMany({ orderBy: { code: "asc" } }),
    prisma.stockIn.groupBy({ by: ["itemCode"], _sum: { qty: true } }),
    prisma.stockOut.groupBy({ by: ["itemCode"], _sum: { qty: true } }),
  ]);
  const inMap = new Map(ins.map((r) => [r.itemCode, r._sum.qty ?? 0]));
  const outMap = new Map(outs.map((r) => [r.itemCode, r._sum.qty ?? 0]));

  return items.map((it) => {
    const inQty = inMap.get(it.code) ?? 0;
    const outQty = outMap.get(it.code) ?? 0;
    const balance = round2(inQty - outQty);
    return {
      code: it.code,
      name: it.name,
      unit: it.unit,
      inQty: round2(inQty),
      outQty: round2(outQty),
      balance,
      reorderPoint: it.reorderPoint,
      needsReorder: balance <= it.reorderPoint,
    };
  });
}
