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

/** บันทึกตารางราคาทั้งหมดของเส้นทางหนึ่ง (ราคาลูกค้า + ราคาจ่ายรถร่วม ทุกช่วงราคาน้ำมัน) */
export async function savePrices(routeId: number, form: FormData): Promise<Result> {
  await requireWrite();
  const bands = await prisma.priceBand.findMany({ orderBy: { sort: "asc" } });

  const ops = bands.map((band) => {
    const c = String(form.get(`c_${band.id}`) ?? "").trim();
    const o = String(form.get(`o_${band.id}`) ?? "").trim();
    const customerPrice = c === "" ? null : Number(c);
    const outsourcePrice = o === "" ? null : Number(o);

    if (customerPrice == null && outsourcePrice == null) {
      return prisma.routePrice.deleteMany({ where: { routeId, bandId: band.id } });
    }
    return prisma.routePrice.upsert({
      where: { routeId_bandId: { routeId, bandId: band.id } },
      create: { routeId, bandId: band.id, customerPrice, outsourcePrice },
      update: { customerPrice, outsourcePrice },
    });
  });

  try {
    await prisma.$transaction(ops);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "บันทึกราคาไม่สำเร็จ" };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * เติมราคาช่วงที่เหลือให้อัตโนมัติแบบขั้นบันได
 * ใช้เมื่อรู้ราคาที่ช่วงหนึ่ง แล้วอยากให้ช่วงถัดไปเพิ่มขึ้นทีละเท่าๆ กัน (เหมือนตารางเดิมใน Excel)
 */
export async function fillPriceLadder(
  routeId: number,
  baseBandId: number,
  customerStep: number,
  outsourceStep: number,
): Promise<Result> {
  await requireWrite();
  const bands = await prisma.priceBand.findMany({ orderBy: { sort: "asc" } });
  const baseIndex = bands.findIndex((b) => b.id === baseBandId);
  if (baseIndex < 0) return { ok: false, error: "ไม่พบช่วงราคาที่เลือกเป็นฐาน" };

  const base = await prisma.routePrice.findUnique({
    where: { routeId_bandId: { routeId, bandId: baseBandId } },
  });
  if (!base || (base.customerPrice == null && base.outsourcePrice == null)) {
    return { ok: false, error: "ต้องกรอกราคาของช่วงที่ใช้เป็นฐานก่อน" };
  }

  const ops = bands.map((band, i) => {
    const steps = i - baseIndex;
    const customerPrice =
      base.customerPrice == null ? null : Math.round((base.customerPrice + steps * customerStep) * 100) / 100;
    const outsourcePrice =
      base.outsourcePrice == null ? null : Math.round((base.outsourcePrice + steps * outsourceStep) * 100) / 100;
    return prisma.routePrice.upsert({
      where: { routeId_bandId: { routeId, bandId: band.id } },
      create: { routeId, bandId: band.id, customerPrice, outsourcePrice },
      update: { customerPrice, outsourcePrice },
    });
  });

  try {
    await prisma.$transaction(ops);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "เติมราคาไม่สำเร็จ" };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/** คัดลอกราคาทั้งชุดจากเส้นทางอื่น (ใช้ตอนเพิ่มเส้นทางขากลับ) */
export async function copyPricesFrom(routeId: number, sourceRouteId: number): Promise<Result> {
  await requireWrite();
  if (routeId === sourceRouteId) return { ok: false, error: "เลือกเส้นทางต้นทางที่ต่างจากเส้นทางนี้" };
  const source = await prisma.routePrice.findMany({ where: { routeId: sourceRouteId } });
  if (!source.length) return { ok: false, error: "เส้นทางต้นทางยังไม่มีราคา" };

  try {
    await prisma.$transaction([
      prisma.routePrice.deleteMany({ where: { routeId } }),
      prisma.routePrice.createMany({
        data: source.map((p) => ({
          routeId,
          bandId: p.bandId,
          customerPrice: p.customerPrice,
          outsourcePrice: p.outsourcePrice,
        })),
      }),
    ]);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "คัดลอกไม่สำเร็จ" };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
