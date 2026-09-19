"use server";

import { requireWrite } from "@/lib/auth";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

export type Result = { ok: boolean; error?: string };

function str(f: FormData, k: string) {
  return String(f.get(k) ?? "").trim();
}
function numOrNull(f: FormData, k: string): number | null {
  const s = str(f, k);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** สร้าง/แก้ไขเส้นทาง พร้อมระยะทาง อัตราสิ้นเปลืองเป้าหมาย และเบี้ยเลี้ยง */
export async function saveRoute(id: number | null, form: FormData): Promise<Result> {
  await requireWrite();
  const origin = str(form, "origin");
  const destination = str(form, "destination");
  const vehicleType = str(form, "vehicleType");

  if (!origin || !destination) return { ok: false, error: "กรุณาเลือกต้นทางและปลายทาง" };
  if (origin === destination) return { ok: false, error: "ต้นทางกับปลายทางต้องไม่ใช่ที่เดียวกัน" };
  if (!vehicleType) return { ok: false, error: "กรุณาเลือกประเภทรถ" };

  const targetKmPerL = numOrNull(form, "targetKmPerL");
  if (targetKmPerL != null && targetKmPerL <= 0) {
    return { ok: false, error: "อัตราสิ้นเปลืองเป้าหมายต้องมากกว่า 0" };
  }

  const data = {
    origin,
    destination,
    vehicleType,
    priceUnit: str(form, "priceUnit") === "ต่อตัน" ? "ต่อตัน" : "ต่อเที่ยว",
    distanceKm: numOrNull(form, "distanceKm"),
    targetKmPerL,
    allowance: numOrNull(form, "allowance") ?? 0,
    note: str(form, "note") || null,
    active: form.get("active") === "on",
  };

  try {
    if (id) await prisma.route.update({ where: { id }, data });
    else await prisma.route.create({ data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique constraint")) {
      return { ok: false, error: "มีเส้นทางนี้ (ต้นทาง+ปลายทาง+ประเภทรถ) อยู่แล้ว" };
    }
    return { ok: false, error: msg };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteRoute(id: number): Promise<Result> {
  await requireWrite();
  const used = await prisma.job.count({ where: { routeId: id } });
  if (used > 0) {
    return { ok: false, error: `ลบไม่ได้ เพราะมีงาน ${used} ขาอ้างถึงเส้นทางนี้ — ให้ปิดใช้งานแทน` };
  }
  try {
    await prisma.route.delete({ where: { id } });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ลบไม่สำเร็จ" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export type PriceInput = { bandId: number; customerPrice: number | null; outsourcePrice: number | null };

/**
 * บันทึกตารางราคาทั้งหมดของเส้นทางหนึ่ง (ราคาลูกค้า + ราคาจ่ายรถร่วม ทุกช่วงราคาน้ำมัน)
 * รับค่าตามที่เห็นบนหน้าจอทั้งตาราง — ช่วงที่ว่างทั้งสองช่องถือว่าไม่มีราคา จะถูกลบออก
 */
export async function savePrices(routeId: number, rows: PriceInput[]): Promise<Result & { saved?: number }> {
  await requireWrite();
  const bands = await prisma.priceBand.findMany({ select: { id: true } });
  const known = new Set(bands.map((b) => b.id));

  for (const r of rows) {
    if (!known.has(r.bandId)) return { ok: false, error: "ช่วงราคาน้ำมันไม่ตรงกับในระบบ — รีเฟรชหน้าแล้วลองใหม่" };
    for (const v of [r.customerPrice, r.outsourcePrice]) {
      if (v != null && (!Number.isFinite(v) || v < 0)) return { ok: false, error: "ราคาต้องเป็นตัวเลข 0 ขึ้นไป" };
    }
  }

  let saved = 0;
  const ops = rows.map((r) => {
    if (r.customerPrice == null && r.outsourcePrice == null) {
      return prisma.routePrice.deleteMany({ where: { routeId, bandId: r.bandId } });
    }
    saved++;
    return prisma.routePrice.upsert({
      where: { routeId_bandId: { routeId, bandId: r.bandId } },
      create: { routeId, bandId: r.bandId, customerPrice: r.customerPrice, outsourcePrice: r.outsourcePrice },
      update: { customerPrice: r.customerPrice, outsourcePrice: r.outsourcePrice },
    });
  });

  try {
    await prisma.$transaction(ops);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "บันทึกราคาไม่สำเร็จ" };
  }

  revalidatePath("/", "layout");
  return { ok: true, saved };
}

/**
 * อ่านราคาทั้งชุดของเส้นทางอื่นมาให้หน้าจอ (ใช้ตอนเพิ่มเส้นทางขากลับ)
 * ไม่เขียนลงฐานข้อมูล — ผู้ใช้ตรวจ/แก้บนหน้าจอแล้วกดบันทึกเอง
 */
export async function copyPricesFrom(sourceRouteId: number): Promise<Result & { prices?: PriceInput[] }> {
  await requireWrite();
  const source = await prisma.routePrice.findMany({ where: { routeId: sourceRouteId } });
  if (!source.length) return { ok: false, error: "เส้นทางที่เลือกยังไม่มีราคา" };
  return {
    ok: true,
    prices: source.map((p) => ({ bandId: p.bandId, customerPrice: p.customerPrice, outsourcePrice: p.outsourcePrice })),
  };
}
