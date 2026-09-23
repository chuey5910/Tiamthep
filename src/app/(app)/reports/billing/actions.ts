"use server";

import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";
import { requireAuth, requireWrite } from "@/lib/auth";
import { buildContext, computeJob } from "@/lib/calc";
import { allocateSatang, billingTotals, cleanRate, nextInvoiceNo, rateLabel, taxDefaults } from "@/lib/billing";
import { addDays, formatThaiDate, startOfDay } from "@/lib/date";
import { PRICE_UNITS } from "@/lib/price-unit";
import { prisma } from "@/lib/prisma";

export type ActionResult = { ok: true; invoiceNo?: string } | { ok: false; error: string };
export type ExcelFile = { ok: true; filename: string; base64: string } | { ok: false; error: string };

/**
 * คำนวณค่าบรรทุกของขาที่เลือก + อัตราภาษีของลูกค้ารายนั้น
 * ใช้ตัวคำนวณกลางตัวเดียวกับรายงาน ยอดจึงตรงกับที่เห็นบนหน้าจอเสมอ
 */
async function priceSelectedJobs(customerId: number, jobIds: number[]) {
  const jobs = await prisma.job.findMany({ where: { id: { in: jobIds } } });
  const ctx = await buildContext();
  const settings = new Map((await prisma.setting.findMany()).map((s) => [s.key, s.value]));
  const defaults = taxDefaults(settings);
  const customer = ctx.customerById.get(customerId);

  const rows = jobs.map((j) => ({ job: j, calc: computeJob(ctx, j) }));
  const vatRate = cleanRate(customer?.vatRate ?? null, defaults.vatRate);
  const whtRate = cleanRate(customer?.whtRate ?? null, defaults.whtRate);

  return { ctx, customer, rows, vatRate, whtRate };
}

/**
 * ออกใบวางบิลจากขาที่ติ๊กเลือกไว้
 *
 * กันพลาด 4 ชั้น — เงินผิดไม่ได้:
 *   1. ขาต้องเป็นของลูกค้ารายนี้จริง
 *   2. ขาที่ข้อมูลยังไม่ครบ (ราคายังไม่ตั้ง / น้ำหนักผิดหน่วย) ออกบิลไม่ได้
 *   3. ขาที่อยู่ในใบอื่นแล้ว ออกซ้ำไม่ได้ (jobId เป็น unique ในตารางบรรทัดบิล)
 *   4. ทั้งหมดอยู่ใน transaction เดียว — ล้มกลางทางแล้วไม่เหลือใบครึ่งใบ
 */
export async function createInvoice(customerId: number, jobIds: number[]): Promise<ActionResult> {
  const user = await requireWrite();
  try {
    const ids = [...new Set(jobIds)].filter((n) => Number.isInteger(n));
    if (ids.length === 0) return { ok: false, error: "ยังไม่ได้เลือกขาที่จะวางบิล" };

    const { customer, rows, vatRate, whtRate } = await priceSelectedJobs(customerId, ids);
    if (!customer) return { ok: false, error: "ไม่พบลูกค้ารายนี้ในฐานข้อมูล" };
    if (rows.length !== ids.length) return { ok: false, error: "มีขาที่เลือกไว้ถูกลบไปแล้ว — กดโหลดหน้าใหม่แล้วลองอีกครั้ง" };

    const wrongCustomer = rows.filter((r) => r.job.customerId !== customerId);
    if (wrongCustomer.length > 0) {
      return { ok: false, error: `มี ${wrongCustomer.length} ขาที่ไม่ใช่ของลูกค้ารายนี้ — กดโหลดหน้าใหม่แล้วลองอีกครั้ง` };
    }

    const problems = rows.filter((r) => r.calc.issues.length > 0);
    if (problems.length > 0) {
      return {
        ok: false,
        error: `มี ${problems.length} ขาที่ข้อมูลยังไม่ครบ ออกบิลไม่ได้ — ${problems[0].calc.issues[0]}`,
      };
    }

    const already = await prisma.customerBillingLine.findMany({
      where: { jobId: { in: ids } },
      include: { billing: { select: { invoiceNo: true } } },
    });
    if (already.length > 0) {
      const nos = [...new Set(already.map((a) => a.billing.invoiceNo))].join(", ");
      return { ok: false, error: `มี ${already.length} ขาที่วางบิลไปแล้วในใบ ${nos} — กดโหลดหน้าใหม่` };
    }

    const dates = rows.map((r) => r.calc.billingDate.getTime());
    const periodFrom = new Date(Math.min(...dates));
    const periodTo = new Date(Math.max(...dates));
    const billedAt = startOfDay(new Date());
    const totals = billingTotals(rows.map((r) => r.calc.revenue), vatRate, whtRate);
    // ยอดรายขาที่เก็บลงบิล = ยอดที่เกลี่ยเศษสตางค์แล้ว บวกทุกบรรทัดได้เท่ายอดรวมเป๊ะ
    const lineAmounts = allocateSatang(rows.map((r) => r.calc.revenue));

    const invoiceNo = await prisma.$transaction(async (tx) => {
      const prefix = `INV-${billedAt.getUTCFullYear() + 543}${String(billedAt.getUTCMonth() + 1).padStart(2, "0")}-`;
      const inMonth = await tx.customerBilling.findMany({
        where: { invoiceNo: { startsWith: prefix } },
        select: { invoiceNo: true },
      });
      const no = nextInvoiceNo(billedAt, inMonth.map((r) => r.invoiceNo));

      await tx.customerBilling.create({
        data: {
          invoiceNo: no,
          customerId,
          periodFrom,
          periodTo,
          billedAt,
          dueAt: addDays(billedAt, customer.creditDays ?? 0),
          legs: totals.legs,
          amount: totals.amount,
          vatRate: totals.vatRate,
          vatAmount: totals.vatAmount,
          whtRate: totals.whtRate,
          whtAmount: totals.whtAmount,
          netAmount: totals.netAmount,
          billedBy: user.name,
          lines: {
            create: rows.map((r, i) => ({ jobId: r.job.id, amount: lineAmounts[i] })),
          },
        },
      });
      return no;
    });

    revalidatePath("/", "layout");
    return { ok: true, invoiceNo };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ออกใบวางบิลไม่สำเร็จ" };
  }
}

/** ยกเลิกใบวางบิล — ขาในใบนั้นกลับมาเป็น "ยังไม่วางบิล" ให้เลือกใหม่ได้ทันที */
export async function cancelInvoice(billingId: number): Promise<ActionResult> {
  await requireWrite();
  try {
    await prisma.customerBilling.delete({ where: { id: billingId } });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ยกเลิกไม่สำเร็จ" };
  }
}

/**
 * ไฟล์ Excel ใบวางบิล — เฉพาะขาที่เลือก คอลัมน์เดียวกับบนหน้าจอเป๊ะ
 * ยอดท้ายไฟล์ผ่าน billingTotals ตัวเดียวกับหน้าจอ จึงไม่มีทางต่างกัน
 */
export async function exportBillingExcel(customerId: number, jobIds: number[]): Promise<ExcelFile> {
  await requireAuth();
  try {
    const ids = [...new Set(jobIds)].filter((n) => Number.isInteger(n));
    if (ids.length === 0) return { ok: false, error: "ยังไม่ได้เลือกขาที่จะออกไฟล์" };

    const { customer, rows, vatRate, whtRate } = await priceSelectedJobs(customerId, ids);
    if (!customer) return { ok: false, error: "ไม่พบลูกค้ารายนี้ในฐานข้อมูล" };

    rows.sort((a, b) => a.calc.billingDate.getTime() - b.calc.billingDate.getTime() || a.job.id - b.job.id);
    const totals = billingTotals(rows.map((r) => r.calc.revenue), vatRate, whtRate);
    const lineAmounts = allocateSatang(rows.map((r) => r.calc.revenue));

    const settings = new Map((await prisma.setting.findMany()).map((s) => [s.key, s.value]));
    const companyName = settings.get("companyName") ?? "บริษัท เทียมเทพ ขนส่ง จำกัด";
    const from = rows.length ? formatThaiDate(rows[0].calc.billingDate) : "";
    const to = rows.length ? formatThaiDate(rows[rows.length - 1].calc.billingDate) : "";

    const head = [
      "ลำดับ",
      "วันที่",
      "ทะเบียนรถ",
      "เลขที่ตั๋วต้นทาง",
      "ต้นทาง",
      "ปลายทาง",
      "น้ำหนักต้นทาง (ตัน)",
      "น้ำหนักปลายทาง (ตัน)",
      "ราคา/หน่วย",
      "ค่าบรรทุก (บาท)",
    ];
    const body = rows.map((r, i) => [
      i + 1,
      formatThaiDate(r.calc.billingDate),
      r.job.headPlate.trim(),
      r.job.ticketOrigin ?? "",
      r.job.origin,
      r.job.destination,
      r.job.weightOrigin ?? "",
      r.job.weightDest ?? "",
      rateLabel(r.calc.priceUnit, r.calc.customerRate),
      lineAmounts[i],
    ]);

    const sheet: (string | number)[][] = [
      [companyName],
      [`ใบวางบิล — ${customer.code} ${customer.name}`],
      [`งานวันที่ ${from} ถึง ${to} · รวม ${totals.legs} ขา`],
      customer.address ? [`ที่อยู่: ${customer.address}`] : [],
      [
        `เลขประจำตัวผู้เสียภาษี: ${customer.taxId ?? "-"}`,
        `สาขา: ${customer.branch ?? "-"}`,
        `เครดิต: ${customer.creditDays} วัน`,
      ],
      [`เกณฑ์น้ำหนักที่ใช้คิดเงิน: ${customer.weightBasis}`],
      [],
      head,
      ...body,
      [],
      ["", "", "", "", "", "", "", "", "ค่าบรรทุกรวม", totals.amount],
      ["", "", "", "", "", "", "", "", `ภาษีมูลค่าเพิ่ม ${totals.vatRate}%`, totals.vatAmount],
      ["", "", "", "", "", "", "", "", "รวมทั้งสิ้น", totals.grandTotal],
      ["", "", "", "", "", "", "", "", `หัก ภาษี ณ ที่จ่าย ${totals.whtRate}%`, -totals.whtAmount],
      ["", "", "", "", "", "", "", "", "ยอดรับสุทธิ", totals.netAmount],
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(sheet);
    ws["!cols"] = [
      { wch: 7 }, { wch: 14 }, { wch: 13 }, { wch: 16 }, { wch: 26 }, { wch: 26 },
      { wch: 19 }, { wch: 20 }, { wch: 14 }, { wch: 16 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, "ใบวางบิล");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    // ชื่อไฟล์ต้องเป็นอักษรอังกฤษ — เบราว์เซอร์ตัดชื่อไฟล์ภาษาไทยทิ้ง แล้วได้ไฟล์ชื่อ "download" ที่เปิดไม่ออก
    const stamp = (d: Date) =>
      `${d.getUTCFullYear() + 543}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
    const span = rows.length
      ? `${stamp(rows[0].calc.billingDate)}-${stamp(rows[rows.length - 1].calc.billingDate)}`
      : "";
    return {
      ok: true,
      filename: `billing-${customer.code}-${span}.xlsx`,
      base64: buf.toString("base64"),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "สร้างไฟล์ไม่สำเร็จ" };
  }
}

/**
 * สร้างเส้นทางที่ยังไม่มีในระบบทีเดียวหลายเส้น
 *
 * ลูกค้ารายเดียวมักมีปลายทางหลายสิบที่ — กดเพิ่มทีละเส้นแล้วพิมพ์ชื่อซ้ำทุกรอบช้าเกินไป
 * ระบบสร้างให้เฉพาะ "โครง" (ต้นทาง ปลายทาง ประเภทรถ หน่วยคิดราคา)
 * ราคายังต้องไปตั้งเอง — ระบบไม่เดาราคาแทนคนเด็ดขาด
 */
export async function createMissingRoutes(
  items: { origin: string; destination: string; vehicleType: string; priceUnit: string }[],
): Promise<{ ok: true; created: number; skipped: number } | { ok: false; error: string }> {
  await requireWrite();
  try {
    const clean = items
      .map((r) => ({
        origin: r.origin.trim(),
        destination: r.destination.trim(),
        vehicleType: r.vehicleType.trim(),
        priceUnit: PRICE_UNITS.includes(r.priceUnit as (typeof PRICE_UNITS)[number]) ? r.priceUnit : "ต่อเที่ยว",
      }))
      .filter((r) => r.origin && r.destination && r.vehicleType);
    if (clean.length === 0) return { ok: false, error: "ยังไม่ได้เลือกเส้นทางที่จะสร้าง" };

    // มีอยู่แล้วก็ข้ามไป ไม่ถือว่าผิด — กดซ้ำได้โดยไม่เกิดข้อมูลซ้ำ
    const created = await prisma.$transaction(async (tx) => {
      let n = 0;
      for (const r of clean) {
        const existing = await tx.route.findUnique({
          where: {
            origin_destination_vehicleType: {
              origin: r.origin,
              destination: r.destination,
              vehicleType: r.vehicleType,
            },
          },
        });
        if (existing) continue;
        await tx.route.create({ data: { ...r, allowance: 0 } });
        n++;
      }
      return n;
    });

    revalidatePath("/", "layout");
    return { ok: true, created, skipped: clean.length - created };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "สร้างเส้นทางไม่สำเร็จ" };
  }
}
