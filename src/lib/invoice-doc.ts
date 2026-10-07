/**
 * ข้อมูลของ "ใบวางบิล" หนึ่งใบ ในรูปที่พร้อมพิมพ์/ทำ PDF
 *
 * มี 2 แบบ ใช้หน้าตาเดียวกัน (src/components/InvoiceDocument.tsx):
 *   • ร่าง  — ขาที่ติ๊กเลือกในหน้าวางบิล ยังไม่ได้กดออกบิล
 *   • ใบจริง — ใบที่ออกไปแล้ว (หน้ารายงานการวางบิล) ยอดรายขาใช้ "ยอดที่บันทึกไว้ตอนออกบิล"
 *             เพราะใบที่ส่งลูกค้าไปแล้วต้องเหมือนเดิมเสมอ ถึงข้อมูลงานจะถูกแก้ทีหลัง
 *
 * ตัวเลขเงินมาจาก billingLines (เดินผ่าน calc.ts) + allocateSatang ตัวเดียวกับหน้าวางบิล
 * PDF จึงตรงกับหน้าจอและ Excel ทุกสตางค์
 */

import { allocateSatang, billRate, billingLines, billingTotals } from "./billing";
import { formatThaiDate } from "./date";
import { prisma } from "./prisma";
import { loadPeriod } from "./reports";

export type InvoiceDocRow = {
  seq: number;
  date: string;
  plate: string;
  ticket: string;
  origin: string;
  destination: string;
  weightOrigin: number | null;
  weightDest: number | null;
  /** ราคาต่อหน่วยเป็นตัวเลขล้วน — หน่วยอยู่ที่หัวคอลัมน์ (ต่อกิโลกรัมแปลงเป็นต่อตันแล้ว) */
  rate: number | null;
  rateUnit: "ตัน" | "เที่ยว";
  amount: number;
};

export type InvoiceDoc = {
  companyName: string;
  /** null = ร่าง (ยังไม่ออกเลขที่) */
  invoiceNo: string | null;
  billedAt: string | null;
  dueAt: string | null;
  customer: {
    code: string;
    name: string;
    address: string | null;
    taxId: string | null;
    branch: string | null;
    creditDays: number;
    weightBasis: string;
  };
  period: string;
  rows: InvoiceDocRow[];
  /** หน่วยราคาของทั้งใบ (ใส่บนหัวคอลัมน์) — null = ใบนี้ปนหลายหน่วย ต้องบอกหน่วยในแต่ละช่อง */
  rateUnit: "ตัน" | "เที่ยว" | null;
  sumWeightOrigin: number;
  sumWeightDest: number;
  amount: number;
  /** ขาที่ขอมาแต่หาไม่เจอ (ถูกลบ/ย้ายช่วง) — ต้องบอก ห้ามเงียบ */
  missing: number;
  /** ชื่อไฟล์ตอนบันทึก — ต้องเป็นอักษรอังกฤษ เบราว์เซอร์ทิ้งชื่อไทยในไฟล์ดาวน์โหลด */
  fileName: string;
};

export async function companyName(): Promise<string> {
  try {
    const s = await prisma.setting.findUnique({ where: { key: "companyName" } });
    return s?.value ?? "บริษัท เทียมเทพ ขนส่ง จำกัด";
  } catch {
    return "บริษัท เทียมเทพ ขนส่ง จำกัด";
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** หน่วยเดียวทั้งใบ → ใส่ที่หัวคอลัมน์ · ปนกัน → null (บอกหน่วยในแต่ละช่องแทน) */
function commonUnit(units: ("ตัน" | "เที่ยว")[]): "ตัน" | "เที่ยว" | null {
  const set = new Set(units);
  return set.size === 1 ? units[0] : set.size === 0 ? "ตัน" : null;
}

/** ร่างใบวางบิลจากขาที่ติ๊กเลือก — ลำดับเดียวกับหน้าวางบิล */
export async function draftInvoiceDoc(customerId: number, from: Date, to: Date, jobIds: number[]): Promise<InvoiceDoc | null> {
  const data = await loadPeriod({ from, to });
  const customer = data.ctx.customerById.get(customerId);
  if (!customer) return null;

  const billed = await prisma.customerBillingLine.findMany({
    where: { jobId: { in: data.billedJobs.map((j) => j.id) } },
    include: { billing: { select: { invoiceNo: true } } },
  });
  const invoiceByJob = new Map(billed.map((l) => [l.jobId, l.billing.invoiceNo]));

  const want = new Set(jobIds);
  const lines = billingLines(data, customerId, invoiceByJob).filter((l) => want.has(l.jobId));
  const shown = allocateSatang(lines.map((l) => l.amount));
  const totals = billingTotals(lines.map((l) => l.amount));

  return {
    companyName: await companyName(),
    invoiceNo: null,
    billedAt: null,
    dueAt: null,
    customer: {
      code: customer.code,
      name: customer.name,
      address: customer.address ?? null,
      taxId: customer.taxId ?? null,
      branch: customer.branch ?? null,
      creditDays: customer.creditDays ?? 0,
      weightBasis: customer.weightBasis ?? "น้ำหนักปลายทาง",
    },
    period: `${formatThaiDate(from)} ถึง ${formatThaiDate(to)}`,
    rows: lines.map((l, i) => ({
      seq: i + 1,
      date: formatThaiDate(l.date),
      plate: l.plate, // ทะเบียนแม่อย่างเดียว ไม่ใส่หางพ่วง
      ticket: l.ticketOrigin ?? "-",
      origin: l.origin,
      destination: l.destination,
      weightOrigin: l.weightOrigin,
      weightDest: l.weightDest,
      rate: billRate(l.priceUnit, l.rate).value,
      rateUnit: billRate(l.priceUnit, l.rate).unit,
      amount: shown[i],
    })),
    rateUnit: commonUnit(lines.map((l) => billRate(l.priceUnit, l.rate).unit)),
    sumWeightOrigin: lines.reduce((a, l) => a + (l.weightOrigin ?? 0), 0),
    sumWeightDest: lines.reduce((a, l) => a + (l.weightDest ?? 0), 0),
    amount: totals.amount,
    missing: jobIds.length - lines.length,
    fileName: `billing-${customer.code}-${iso(from)}-${iso(to)}.pdf`,
  };
}

/** ใบวางบิลที่ออกไปแล้ว — ยอดรายขาและยอดรวมใช้ค่าที่บันทึกไว้ตอนออกบิล */
export async function issuedInvoiceDoc(id: number): Promise<InvoiceDoc | null> {
  const inv = await prisma.customerBilling.findUnique({
    where: { id },
    include: { lines: true, customer: true },
  });
  if (!inv) return null;

  const data = await loadPeriod({ from: inv.periodFrom, to: inv.periodTo });
  const amountByJob = new Map(inv.lines.map((l) => [l.jobId, l.amount]));
  const lines = billingLines(data, inv.customerId, new Map()).filter((l) => amountByJob.has(l.jobId));
  const c = inv.customer;

  return {
    companyName: await companyName(),
    invoiceNo: inv.invoiceNo,
    billedAt: formatThaiDate(inv.billedAt),
    dueAt: inv.dueAt ? formatThaiDate(inv.dueAt) : null,
    customer: {
      code: c.code,
      name: c.name,
      address: c.address ?? null,
      taxId: c.taxId ?? null,
      branch: c.branch ?? null,
      creditDays: c.creditDays ?? 0,
      weightBasis: c.weightBasis ?? "น้ำหนักปลายทาง",
    },
    period: `${formatThaiDate(inv.periodFrom)} ถึง ${formatThaiDate(inv.periodTo)}`,
    rows: lines.map((l, i) => ({
      seq: i + 1,
      date: formatThaiDate(l.date),
      plate: l.plate, // ทะเบียนแม่อย่างเดียว ไม่ใส่หางพ่วง
      ticket: l.ticketOrigin ?? "-",
      origin: l.origin,
      destination: l.destination,
      weightOrigin: l.weightOrigin,
      weightDest: l.weightDest,
      rate: billRate(l.priceUnit, l.rate).value,
      rateUnit: billRate(l.priceUnit, l.rate).unit,
      amount: amountByJob.get(l.jobId)!,
    })),
    rateUnit: commonUnit(lines.map((l) => billRate(l.priceUnit, l.rate).unit)),
    sumWeightOrigin: lines.reduce((a, l) => a + (l.weightOrigin ?? 0), 0),
    sumWeightDest: lines.reduce((a, l) => a + (l.weightDest ?? 0), 0),
    // ยอดรวมของใบ = ยอดที่บันทึกตอนออกบิล ไม่คำนวณใหม่
    amount: inv.amount,
    missing: inv.lines.length - lines.length,
    fileName: `${inv.invoiceNo}.pdf`,
  };
}
