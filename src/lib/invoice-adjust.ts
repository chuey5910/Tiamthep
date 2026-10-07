/**
 * «ปรับยอดใบนี้» — ใบวางบิลที่ออกไปแล้ว แต่ภายหลังพบว่าน้ำหนัก/ราคาผิด
 *
 * ขั้นตอนที่เจ้าของเลือก (แบบ ก. เลขที่ใบเดิม):
 *   1. ไปแก้ที่ต้นทางตามปกติ — น้ำหนักที่หน้าบันทึกงาน · ราคาที่หน้าเส้นทาง
 *   2. กด «ปรับยอดใบนี้» → ระบบเทียบ "ตอนออกบิล" กับ "ข้อมูลล่าสุด" ให้ดูทีละขา
 *   3. คนกดยืนยันเอง — ระบบไม่ปรับยอดให้เงียบๆ (ห้ามเดาแทนคน)
 *
 * ยอดใหม่คิดด้วยตัวคำนวณกลาง (calc.ts) + เกลี่ยเศษสตางค์ (allocateSatang) ชุดเดียวกับตอนออกบิล
 * ยอดหลังปรับจึงเท่ากับยอดที่ได้ถ้าออกใบนี้ใหม่วันนี้ทุกสตางค์
 */

import type { Job } from "@prisma/client";
import { allocateSatang, billRate, billingTotals, rateOf } from "./billing";
import { buildContext, computeJob, type JobCalc } from "./calc";
import { formatThaiDate } from "./date";
import { money } from "./format";
import { prisma } from "./prisma";

/** ข้อมูลที่พิมพ์บนใบวางบิล 1 ขา — เก็บลง CustomerBillingLine ตอนออกบิล/ปรับยอด */
export type LineSnap = {
  date: Date;
  plate: string;
  ticketOrigin: string | null;
  origin: string;
  destination: string;
  weightOrigin: number | null;
  weightDest: number | null;
  priceUnit: string;
  rate: number | null;
};

/** ทะเบียนเฉพาะตัวแม่ · ราคาต่อหน่วยย้อนจากยอดจริงถ้าราคาถูกลบ — ตรงกับที่หน้าวางบิลแสดง */
export function snapOf(job: Job, c: JobCalc): LineSnap {
  return {
    date: c.billingDate,
    plate: job.headPlate.trim(),
    ticketOrigin: job.ticketOrigin ?? null,
    origin: job.origin,
    destination: job.destination,
    weightOrigin: job.weightOrigin,
    weightDest: job.weightDest,
    priceUnit: c.priceUnit,
    rate: rateOf(c.priceUnit, c.revenue, c.billingWeight, c.customerRate),
  };
}

type Live = { job: Job; snap: LineSnap; exact: number; issues: string[] };

/** คำนวณขาตามรหัสงานตรงๆ (ไม่ผ่านช่วงวันที่) — ขาที่ถูกแก้วันที่ข้ามเดือนก็ยังหาเจอ */
export async function priceJobsLive(jobIds: number[]): Promise<Map<number, Live>> {
  if (jobIds.length === 0) return new Map();
  const [jobs, ctx] = await Promise.all([prisma.job.findMany({ where: { id: { in: jobIds } } }), buildContext()]);
  return new Map(
    jobs.map((j) => {
      const c = computeJob(ctx, j);
      return [j.id, { job: j, snap: snapOf(j, c), exact: c.revenue, issues: c.issues }];
    }),
  );
}

/** แปลงแถวในฐานข้อมูลเป็น LineSnap — ใบที่ออกก่อนมีช่องเก็บข้อมูล (priceUnit ว่าง) = null */
export function storedSnap(l: {
  date: Date | null;
  plate: string | null;
  ticketOrigin: string | null;
  origin: string | null;
  destination: string | null;
  weightOrigin: number | null;
  weightDest: number | null;
  priceUnit: string | null;
  rate: number | null;
}): LineSnap | null {
  if (l.priceUnit == null || l.date == null) return null;
  return {
    date: l.date,
    plate: l.plate ?? "",
    ticketOrigin: l.ticketOrigin,
    origin: l.origin ?? "",
    destination: l.destination ?? "",
    weightOrigin: l.weightOrigin,
    weightDest: l.weightDest,
    priceUnit: l.priceUnit,
    rate: l.rate,
  };
}

export type AdjustChange = {
  seq: number;
  date: string;
  plate: string;
  /** เปลี่ยนอะไรบ้าง เช่น "น้ำหนักปลายทาง 30.63 → 31.63 ตัน" */
  what: string[];
  oldAmount: number;
  newAmount: number;
};

export type AdjustPreview =
  | {
      ok: true;
      billingId: number;
      invoiceNo: string;
      customer: string;
      oldAmount: number;
      newAmount: number;
      legs: number;
      changes: AdjustChange[];
      /** ข้อความเพิ่มเติม เช่น ขาถูกลบ / ช่วงงานขยาย / ใบเก่าไม่มีน้ำหนักเดิมให้เทียบ */
      notes: string[];
      /** ไม่มีอะไรต่าง — ไม่ต้องปรับ */
      same: boolean;
      /** ลายนิ้วมือของยอดใหม่ — ตอนยืนยันต้องตรงกับที่เห็น กันข้อมูลเปลี่ยนระหว่างรอ */
      token: string;
    }
  | { ok: false; error: string };

const w2 = (n: number | null) => (n == null ? "-" : money(n));
const near = (a: number | null, b: number | null) => (a == null || b == null ? a === b : Math.abs(a - b) < 0.005);

function rateText(priceUnit: string, rate: number | null): string {
  const r = billRate(priceUnit, rate);
  return `${r.value == null ? "-" : money(r.value)} บาท/${r.unit}`;
}

/** เทียบข้อมูลบนใบ (ตอนออกบิล) กับข้อมูลล่าสุด — คืนรายการที่ต่าง */
function diffSnap(old: LineSnap, now: LineSnap): string[] {
  const out: string[] = [];
  const d = (a: Date) => formatThaiDate(a);
  if (d(old.date) !== d(now.date)) out.push(`วันที่ ${d(old.date)} → ${d(now.date)}`);
  if (old.plate !== now.plate) out.push(`ทะเบียน ${old.plate} → ${now.plate}`);
  if ((old.ticketOrigin ?? "") !== (now.ticketOrigin ?? ""))
    out.push(`เลขที่ตั๋ว ${old.ticketOrigin ?? "-"} → ${now.ticketOrigin ?? "-"}`);
  if (old.origin !== now.origin) out.push(`ต้นทาง ${old.origin} → ${now.origin}`);
  if (old.destination !== now.destination) out.push(`ปลายทาง ${old.destination} → ${now.destination}`);
  if (!near(old.weightOrigin, now.weightOrigin))
    out.push(`น้ำหนักต้นทาง ${w2(old.weightOrigin)} → ${w2(now.weightOrigin)} ตัน`);
  if (!near(old.weightDest, now.weightDest)) out.push(`น้ำหนักปลายทาง ${w2(old.weightDest)} → ${w2(now.weightDest)} ตัน`);
  const ro = rateText(old.priceUnit, old.rate);
  const rn = rateText(now.priceUnit, now.rate);
  if (ro !== rn) out.push(`ราคา ${ro} → ${rn}`);
  return out;
}

/** เตรียมผลการปรับยอด (ยังไม่บันทึก) — ใช้ทั้งตอนโชว์ให้ดูและตอนกดยืนยัน */
export async function previewAdjust(billingId: number) {
  const inv = await prisma.customerBilling.findUnique({
    where: { id: billingId },
    include: { lines: true, customer: true },
  });
  if (!inv) return { ok: false, error: "ไม่พบใบวางบิลนี้ — อาจถูกยกเลิกไปแล้ว กดโหลดหน้าใหม่" } as const;
  if (inv.lines.length === 0) return { ok: false, error: "ใบนี้ไม่เหลือขาเลย (งานถูกลบหมด) — ยกเลิกใบนี้ที่หน้าวางบิลลูกค้า" } as const;

  const live = await priceJobsLive(inv.lines.map((l) => l.jobId));
  const rows = inv.lines.map((l) => ({ line: l, now: live.get(l.jobId)! }));

  // ขาที่ย้ายไปเป็นของลูกค้าอื่น / ข้อมูลยังไม่ครบ — ปรับไม่ได้ ต้องไปแก้ก่อน
  const moved = rows.filter((r) => r.now.job.customerId !== inv.customerId);
  if (moved.length > 0) {
    const r = moved[0].now;
    return {
      ok: false,
      error: `ขา ${formatThaiDate(r.snap.date)} ${r.snap.plate} ถูกเปลี่ยนเป็นลูกค้ารายอื่นแล้ว — แก้ลูกค้าของงานกลับที่หน้าบันทึกงาน หรือยกเลิกใบนี้แล้วออกใหม่`,
    } as const;
  }
  const broken = rows.filter((r) => r.now.issues.length > 0);
  if (broken.length > 0) {
    const r = broken[0].now;
    return {
      ok: false,
      error: `ขา ${formatThaiDate(r.snap.date)} ${r.snap.plate} ข้อมูลยังไม่ครบ: ${r.issues[0]} — แก้ให้ครบก่อนแล้วกดปรับยอดอีกครั้ง`,
    } as const;
  }

  // เกลี่ยเศษสตางค์ตามลำดับรหัสงาน (เหมือนตอนออกบิล) แล้วค่อยเรียงตามวันที่ให้ตรงกับบนใบ
  rows.sort((a, b) => a.line.jobId - b.line.jobId);
  const satang = allocateSatang(rows.map((r) => r.now.exact));
  const amountByJob = new Map(rows.map((r, i) => [r.line.jobId, satang[i]]));
  rows.sort((a, b) => a.now.snap.date.getTime() - b.now.snap.date.getTime() || a.line.jobId - b.line.jobId);
  const newAmounts = rows.map((r) => amountByJob.get(r.line.jobId)!);
  const newTotal = billingTotals(rows.map((r) => r.now.exact)).amount;

  const changes: AdjustChange[] = [];
  let oldSnapMissing = false;
  rows.forEach((r, i) => {
    const old = storedSnap(r.line);
    if (!old) oldSnapMissing = true;
    const what = old ? diffSnap(old, r.now.snap) : [];
    const moneyChanged = !near(r.line.amount, newAmounts[i]);
    if (what.length === 0 && !moneyChanged) return;
    if (what.length === 0) {
      what.push(old ? "เศษสตางค์เกลี่ยใหม่ให้บวกได้เท่ายอดรวม" : "ยอดต่างจากตอนออกบิล");
    }
    changes.push({
      seq: i + 1,
      date: formatThaiDate(r.now.snap.date),
      plate: r.now.snap.plate,
      what,
      oldAmount: r.line.amount,
      newAmount: newAmounts[i],
    });
  });

  const notes: string[] = [];
  if (inv.legs !== rows.length) notes.push(`ตอนออกบิลมี ${inv.legs} ขา ตอนนี้เหลือ ${rows.length} ขา (งานถูกลบไป)`);
  if (oldSnapMissing && changes.length > 0)
    notes.push("ใบนี้ออกก่อนระบบเก็บน้ำหนัก/ราคาเดิมไว้ จึงบอกได้แค่ยอดเงินที่ต่าง");

  const dates = rows.map((r) => r.now.snap.date.getTime());
  const periodFrom = new Date(Math.min(inv.periodFrom.getTime(), ...dates));
  const periodTo = new Date(Math.max(inv.periodTo.getTime(), ...dates));
  const periodChanged = periodFrom.getTime() !== inv.periodFrom.getTime() || periodTo.getTime() !== inv.periodTo.getTime();
  if (periodChanged) notes.push(`ช่วงงานขยายเป็น ${formatThaiDate(periodFrom)} ถึง ${formatThaiDate(periodTo)} ให้คลุมวันที่ที่แก้`);

  const same =
    changes.length === 0 && near(inv.amount, newTotal) && inv.legs === rows.length && !periodChanged;

  return {
    ok: true,
    billingId: inv.id,
    invoiceNo: inv.invoiceNo,
    customer: `${inv.customer.code} ${inv.customer.name}`,
    oldAmount: inv.amount,
    newAmount: newTotal,
    legs: rows.length,
    changes,
    notes,
    same,
    token: [newTotal.toFixed(2), ...rows.map((r, i) => `${r.line.jobId}:${newAmounts[i].toFixed(2)}`)].join("|"),
    // ไว้ใช้ตอนบันทึก (ไม่ส่งไปหน้าเว็บ)
    _apply: { rows, newAmounts, newTotal, periodFrom, periodTo },
  } as const;
}

/** ข้อความประวัติ บรรทัดละ 1 ขา — เก็บลงฐานข้อมูลไว้ย้อนดู */
export function changeLines(changes: AdjustChange[]): string {
  return changes
    .map((c) => `ลำดับ ${c.seq} · ${c.date} · ${c.plate} · ${c.what.join(" · ")} · ${money(c.oldAmount)} → ${money(c.newAmount)}`)
    .join("\n");
}
