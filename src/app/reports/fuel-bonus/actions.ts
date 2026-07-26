"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

/**
 * แก้ไขลิตรที่ใช้จริงของรอบ
 * ใช้เมื่อ พขร. ไม่ได้เติมน้ำมันในวันจบรอบพอดี ระบบจึงดึงลิตรอัตโนมัติไม่ตรง
 * เว้นว่าง = กลับไปใช้ค่าที่ระบบดึงให้
 */
export async function setActualLitres(tripCode: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    await prisma.fuelBonusOverride.deleteMany({ where: { tripCode } });
  } else {
    const litres = Number(trimmed);
    if (!Number.isFinite(litres) || litres < 0) {
      return { ok: false, error: "กรุณากรอกจำนวนลิตรเป็นตัวเลขที่ไม่ติดลบ" };
    }
    await prisma.fuelBonusOverride.upsert({
      where: { tripCode },
      create: { tripCode, actualLitres: litres, note: "แก้ไขเอง" },
      update: { actualLitres: litres },
    });
  }
  revalidatePath("/reports/fuel-bonus");
  return { ok: true };
}
