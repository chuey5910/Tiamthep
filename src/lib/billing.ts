/**
 * วางบิลลูกค้า
 *
 * ค่าบรรทุกของแต่ละขา = ตัวเลขชุดเดียวกับรายงานรายได้เป๊ะ เพราะเดินผ่าน calc.ts ที่เดียวกัน
 * (ขาไหนนับเข้าช่วงไหน ใช้ "วันที่เรียกเก็บเงิน" ของลูกค้ารายนั้น — ขึ้นหรือลงสินค้า)
 *
 * หลักการสำคัญ 2 ข้อ:
 *   1. ระบบไม่รู้เองว่าวางบิลไปหรือยัง — ต้องมีคนติ๊กเลือกขาแล้วกดออกบิล
 *   2. 1 ขา อยู่ได้ใบเดียว (jobId เป็น unique ใน CustomerBillingLine) จึงวางบิลซ้ำไม่ได้
 */

import { round2 } from "./calc";
import { daysInMonth, startOfDay, utcDate } from "./date";
import { isWeightPriced } from "./price-unit";
import type { PeriodData } from "./reports";

/** ค่ากลางเมื่อยังไม่ได้ตั้งในหน้าตั้งค่าระบบ — ตามธรรมเนียมของบริษัทคือวันที่ 25 */
export const DEFAULT_BILLING_DUE_DAY = 25;
export const DEFAULT_VAT_RATE = 7;
export const DEFAULT_WHT_RATE = 1;

/** ทำให้เป็นวันที่ใช้ได้จริง (1-31) ไม่งั้นคืนค่าสำรอง */
export function cleanDueDay(value: unknown, fallback = DEFAULT_BILLING_DUE_DAY): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 31) return fallback;
  return n;
}

/** ทำให้เป็นอัตราภาษีที่ใช้ได้จริง (0-100) ไม่งั้นคืนค่าสำรอง */
export function cleanRate(value: unknown, fallback: number): number {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return fallback;
  return n;
}

/**
 * วันครบกำหนดวางบิลของงวดหนึ่ง
 * เดือนที่สั้นกว่าวันที่กำหนด (เช่น ตั้งวันที่ 31 แต่เดือน ก.พ.) ให้ใช้วันสุดท้ายของเดือน
 */
export function dueDateOf(periodTo: Date, dueDay: number): Date {
  const y = periodTo.getUTCFullYear();
  const m = periodTo.getUTCMonth() + 1;
  return utcDate(y, m, Math.min(dueDay, daysInMonth(y, m)));
}

/** อัตราภาษีกลางของบริษัท (อ่านจากตาราง Setting) */
export type TaxDefaults = { vatRate: number; whtRate: number; dueDay: number };

export function taxDefaults(settings: Map<string, string>): TaxDefaults {
  return {
    vatRate: cleanRate(settings.get("vatRate"), DEFAULT_VAT_RATE),
    whtRate: cleanRate(settings.get("whtRate"), DEFAULT_WHT_RATE),
    dueDay: cleanDueDay(settings.get("billingDueDay")),
  };
}

/** สรุปยอดท้ายบิล — สูตรเดียวใช้ทั้งหน้าจอ Excel และใบที่พิมพ์ ตัวเลขจึงตรงกันเสมอ */
export type BillingTotals = {
  legs: number;
  amount: number;
  vatRate: number;
  vatAmount: number;
  /** ค่าบรรทุก + VAT */
  grandTotal: number;
  whtRate: number;
  whtAmount: number;
  /** ยอดรับสุทธิ = ค่าบรรทุก + VAT − หัก ณ ที่จ่าย */
  netAmount: number;
};

export function billingTotals(amounts: number[], vatRate: number, whtRate: number): BillingTotals {
  const amount = round2(amounts.reduce((a, b) => a + b, 0));
  const vatAmount = round2((amount * vatRate) / 100);
  const whtAmount = round2((amount * whtRate) / 100);
  return {
    legs: amounts.length,
    amount,
    vatRate,
    vatAmount,
    grandTotal: round2(amount + vatAmount),
    whtRate,
    whtAmount,
    netAmount: round2(amount + vatAmount - whtAmount),
  };
}

/** ใบวางบิลที่ออกไปแล้ว (รูปแบบที่หน้าเว็บใช้) */
export type BillingRecord = {
  id: number;
  invoiceNo: string;
  customerId: number;
  periodFrom: Date;
  periodTo: Date;
  billedAt: Date;
  dueAt: Date | null;
  legs: number;
  amount: number;
  netAmount: number;
  billedBy: string | null;
  jobIds: number[];
};

/** 1 บรรทัดในใบวางบิล = 1 ขา */
export type BillingLine = {
  jobId: number;
  /** วันที่เรียกเก็บเงินของขานี้ */
  date: Date;
  plate: string;
  trailerPlate: string | null;
  origin: string;
  destination: string;
  /** น้ำหนักต้นทาง / ปลายทาง (ตัน) — แสดงทั้งคู่ให้ตรวจทานได้ */
  weightOrigin: number | null;
  weightDest: number | null;
  /** ช่องไหนถูกใช้คิดเงิน ตามเกณฑ์ของลูกค้ารายนั้น */
  weightBasis: "น้ำหนักต้นทาง" | "น้ำหนักปลายทาง";
  priceUnit: string;
  /** ราคาต่อหน่วย (null = ยังไม่ได้ตั้งราคา) */
  rate: number | null;
  /** ค่าบรรทุกของขานี้ */
  amount: number;
  /** ประเภทรถของคันที่วิ่งขานี้ (null = ไม่พบทะเบียนในฐานข้อมูลรถ) */
  vehicleType: string | null;
  /** ปัญหาที่ต้องแก้ก่อนวางบิล — มีปัญหา = ติ๊กเลือกไม่ได้ */
  issues: string[];
  /** ปุ่มพาไปแก้ต้นเหตุ — พาไปถึงแถวที่ต้องแก้ ไม่ใช่แค่หน้ารวม */
  fix: { href: string; label: string } | null;
  /** เส้นทางที่ยังไม่มีในฐานข้อมูล — ใช้สร้างรวดเดียวหลายเส้น */
  missingRoute: { origin: string; destination: string; vehicleType: string } | null;
  /** วางบิลไปแล้วในใบไหน (null = ยังไม่วางบิล) */
  invoiceNo: string | null;
};

/** สรุปของลูกค้า 1 รายในช่วงที่เลือก */
export type BillingCustomerRow = {
  customerId: number;
  code: string;
  name: string;
  /** ขาทั้งหมดในช่วงนี้ */
  legs: number;
  billedLegs: number;
  openLegs: number;
  /** ยอดของขาที่ยังไม่วางบิล */
  openAmount: number;
  billedAmount: number;
  /** ขาที่ข้อมูลยังไม่ครบ — วางบิลไม่ได้จนกว่าจะแก้ */
  problemLegs: number;
  /** จำนวนใบวางบิลที่ออกไปแล้วในช่วงนี้ */
  invoices: number;
  dueDay: number;
  dueDaySource: "ลูกค้า" | "ค่ากลาง";
  dueDate: Date;
  /** ข้อความอิสระในข้อมูลลูกค้า — เตือนให้ตั้งวันครบกำหนดเป็นตัวเลขด้วย */
  billingDayNote: string | null;
  /** เลยวันครบกำหนดแล้วแต่ยังมีขาค้าง */
  overdue: boolean;
};

/** ย้อนหาอัตราต่อหน่วยจากยอดจริง เผื่อกรณีราคาถูกลบหลังคำนวณ — ดีกว่าโชว์ขีดเฉยๆ */
function rateOf(priceUnit: string, amount: number, weight: number, rate: number | null): number | null {
  if (rate != null) return rate;
  if (amount === 0) return null;
  if (!isWeightPriced(priceUnit)) return amount;
  const divisor = priceUnit === "ต่อกิโลกรัม" ? weight * 1000 : weight;
  return divisor > 0 ? round2(amount / divisor) : null;
}

/**
 * ปุ่ม "แก้ไข" ต้องพาไปถึงแถวที่ต้องแก้จริง ไม่ใช่แค่หน้ารวมแล้วให้ไปหาเอง
 * ตัดสินจาก "ข้อมูล" ไม่ใช่จากข้อความเตือน — ข้อความเปลี่ยนเมื่อไหร่ลิงก์ก็ไม่พัง
 */
function fixTargetFor(args: {
  jobId: number;
  issues: string[];
  origin: string;
  destination: string;
  vehicleType: string | null;
  plate: string;
  routeId: number | null;
  routeFound: boolean;
  hasTwins: boolean;
  rateMissing: boolean;
}): { href: string; label: string } | null {
  const { jobId, issues, origin, destination, vehicleType, plate, routeId, routeFound, hasTwins, rateMissing } = args;
  if (issues.length === 0) return null;

  // ไม่รู้ประเภทรถ = ทะเบียนยังไม่มีในฐานข้อมูลรถ ต้องไปเพิ่มที่นั่นก่อน
  if (!vehicleType) return { href: `/db/vehicles?edit=${encodeURIComponent(plate)}`, label: "เพิ่มทะเบียนรถ" };

  // เส้นทางซ้ำ — ค้นให้เห็นทุกแถวที่ซ้ำกันทีเดียว จะได้รวมได้
  if (hasTwins) return { href: `/db/routes?q=${encodeURIComponent(origin)}`, label: "รวมเส้นทางซ้ำ" };

  // ยังไม่มีเส้นทางนี้ — เปิดฟอร์มเพิ่มเส้นทางที่เติมชื่อให้แล้ว ไม่ต้องพิมพ์เอง
  if (!routeFound) {
    const qs = new URLSearchParams({ new: "1", origin, destination, vehicleType });
    return { href: `/db/routes?${qs}`, label: "เพิ่มเส้นทาง" };
  }

  // มีเส้นทางแล้วแต่ยังไม่มีราคา — เปิดตารางราคาของเส้นนั้นเลย
  if (rateMissing && routeId != null) return { href: `/db/routes?route=${routeId}`, label: "ตั้งราคา" };

  return { href: `/entry/jobs?edit=${jobId}`, label: "แก้ข้อมูลงาน" };
}

/** รายการขาทั้งหมดของลูกค้ารายหนึ่งในช่วงที่เลือก (เรียงตามวันที่) */
export function billingLines(
  d: PeriodData,
  customerId: number,
  invoiceByJob: Map<number, string>,
): BillingLine[] {
  const customer = d.ctx.customerById.get(customerId);
  const weightBasis = customer?.weightBasis === "น้ำหนักต้นทาง" ? "น้ำหนักต้นทาง" : "น้ำหนักปลายทาง";

  const lines: BillingLine[] = [];
  for (const j of d.billedJobs) {
    if (j.customerId !== customerId) continue;
    const c = d.calcs.get(j.id)!;
    const hasTwins = c.routeId != null && d.ctx.routeTwins.has(c.routeId);
    const rateMissing = c.customerRate == null;
    lines.push({
      jobId: j.id,
      date: c.billingDate,
      plate: j.headPlate.trim(),
      trailerPlate: j.trailerPlate?.trim() || null,
      origin: j.origin,
      destination: j.destination,
      weightOrigin: j.weightOrigin,
      weightDest: j.weightDest,
      weightBasis,
      priceUnit: c.priceUnit,
      rate: rateOf(c.priceUnit, c.revenue, c.billingWeight, c.customerRate),
      amount: c.revenue,
      vehicleType: c.vehicleType,
      issues: c.issues,
      fix: fixTargetFor({
        jobId: j.id,
        issues: c.issues,
        origin: j.origin,
        destination: j.destination,
        vehicleType: c.vehicleType,
        plate: j.headPlate.trim(),
        routeId: c.routeId,
        routeFound: c.routeFound,
        hasTwins,
        rateMissing,
      }),
      missingRoute:
        !c.routeFound && c.vehicleType
          ? { origin: j.origin, destination: j.destination, vehicleType: c.vehicleType }
          : null,
      invoiceNo: invoiceByJob.get(j.id) ?? null,
    });
  }
  lines.sort((a, b) => a.date.getTime() - b.date.getTime() || a.jobId - b.jobId);
  return lines;
}

/**
 * สรุปทุกลูกค้าที่มีงานในช่วงที่เลือก พร้อมสถานะวางบิล
 *
 * แถวขึ้นสีแดงเมื่อ "เลยวันครบกำหนดแล้วยังมีขาค้าง" — ระบบไม่เดาให้ ต้องมีคนกดออกบิลเอง
 */
export function billingCustomers(
  d: PeriodData,
  invoiceByJob: Map<number, string>,
  defaults: TaxDefaults,
  today: Date = new Date(),
): BillingCustomerRow[] {
  const rows = new Map<number, BillingCustomerRow & { invoiceSet: Set<string> }>();

  for (const j of d.billedJobs) {
    const c = d.calcs.get(j.id)!;
    let row = rows.get(j.customerId);
    if (!row) {
      const customer = d.ctx.customerById.get(j.customerId);
      const hasOwnDay = Number.isInteger(customer?.billingDueDay ?? null);
      const dueDay = hasOwnDay ? cleanDueDay(customer!.billingDueDay, defaults.dueDay) : defaults.dueDay;
      row = {
        customerId: j.customerId,
        code: customer?.code ?? String(j.customerId),
        name: customer?.name ?? "(ไม่พบในฐานข้อมูลลูกค้า)",
        legs: 0,
        billedLegs: 0,
        openLegs: 0,
        openAmount: 0,
        billedAmount: 0,
        problemLegs: 0,
        invoices: 0,
        dueDay,
        dueDaySource: hasOwnDay ? "ลูกค้า" : "ค่ากลาง",
        dueDate: dueDateOf(d.period.to, dueDay),
        billingDayNote: customer?.billingDay?.trim() || null,
        overdue: false,
        invoiceSet: new Set<string>(),
      };
      rows.set(j.customerId, row);
    }
    row.legs += 1;
    const invoiceNo = invoiceByJob.get(j.id);
    if (invoiceNo) {
      row.billedLegs += 1;
      row.billedAmount += c.revenue;
      row.invoiceSet.add(invoiceNo);
    } else {
      row.openLegs += 1;
      row.openAmount += c.revenue;
      if (c.issues.length > 0) row.problemLegs += 1;
    }
  }

  const todayT = startOfDay(today).getTime();
  const out: BillingCustomerRow[] = [];
  for (const row of rows.values()) {
    const { invoiceSet, ...rest } = row;
    out.push({
      ...rest,
      invoices: invoiceSet.size,
      openAmount: round2(row.openAmount),
      billedAmount: round2(row.billedAmount),
      overdue: row.openLegs > 0 && todayT >= startOfDay(row.dueDate).getTime(),
    });
  }

  return out.sort(
    (a, b) => Number(b.overdue) - Number(a.overdue) || b.openAmount - a.openAmount || a.code.localeCompare(b.code),
  );
}

/** ข้อความอธิบายราคาต่อหน่วย เช่น "0.261/กก." · "185/ตัน" · "12,000/เที่ยว" */
export function rateLabel(priceUnit: string, rate: number | null): string {
  if (rate == null) return "—";
  const n = rate.toLocaleString("th-TH", { maximumFractionDigits: 3 });
  if (priceUnit === "ต่อกิโลกรัม") return `${n}/กก.`;
  if (priceUnit === "ต่อตัน") return `${n}/ตัน`;
  return `${n}/เที่ยว`;
}

/**
 * เลขที่ใบวางบิลถัดไป — INV-{ปี พ.ศ.}{เดือน}-{ลำดับในเดือนนั้น}
 * เช่น INV-256909-001 · เรียงตามเวลาที่ออกบิล หาย้อนหลังง่าย
 */
export function nextInvoiceNo(billedAt: Date, existingInMonth: string[]): string {
  const prefix = `INV-${billedAt.getUTCFullYear() + 543}${String(billedAt.getUTCMonth() + 1).padStart(2, "0")}-`;
  let max = 0;
  for (const no of existingInMonth) {
    if (!no.startsWith(prefix)) continue;
    const n = Number(no.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}
