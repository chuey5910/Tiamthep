"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

export async function saveSettings(form: FormData): Promise<{ ok: boolean; error?: string }> {
  const entries: { key: string; value: string }[] = [
    { key: "companyName", value: String(form.get("companyName") ?? "").trim() },
    { key: "companyTaxId", value: String(form.get("companyTaxId") ?? "").trim() },
    { key: "fuelBuybackRate", value: String(form.get("fuelBuybackRate") ?? "").trim() },
    { key: "docAlertDays", value: String(form.get("docAlertDays") ?? "").trim() },
  ];

  if (!entries[0].value) return { ok: false, error: "กรุณากรอกชื่อบริษัท" };

  const rate = Number(entries[2].value);
  if (!Number.isFinite(rate) || rate < 0) return { ok: false, error: "อัตราซื้อคืนน้ำมันต้องเป็นตัวเลขที่ไม่ติดลบ" };

  const days = Number(entries[3].value);
  if (!Number.isInteger(days) || days < 0) return { ok: false, error: "จำนวนวันแจ้งเตือนต้องเป็นจำนวนเต็มไม่ติดลบ" };

  await prisma.$transaction(
    entries.map((e) =>
      prisma.setting.upsert({ where: { key: e.key }, create: e, update: { value: e.value } }),
    ),
  );

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * ลบข้อมูลตัวอย่างที่มาพร้อมการติดตั้ง
 * ลบเฉพาะรายการที่หมายเหตุระบุว่าเป็นข้อมูลตัวอย่าง — ข้อมูลจริงไม่ถูกแตะ
 */
export async function clearDemoData(): Promise<{ ok: boolean; error?: string; removed?: number }> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const demoJobs = await tx.job.findMany({ where: { note: "ข้อมูลตัวอย่าง" }, select: { tripCode: true } });
      const tripCodes = [...new Set(demoJobs.map((j) => j.tripCode))];

      const counts = [
        (await tx.job.deleteMany({ where: { note: "ข้อมูลตัวอย่าง" } })).count,
        (await tx.fuelEntry.deleteMany({ where: { note: "ข้อมูลตัวอย่าง" } })).count,
        (await tx.travelAdvance.deleteMany({ where: { note: "ข้อมูลตัวอย่าง" } })).count,
        (await tx.expense.deleteMany({ where: { note: "ข้อมูลตัวอย่าง" } })).count,
        (await tx.fuelBonusOverride.deleteMany({ where: { tripCode: { in: tripCodes } } })).count,
        (await tx.vehiclePairing.deleteMany({ where: { note: { contains: "ข้อมูลตัวอย่าง" } } })).count,
        (await tx.vehicle.deleteMany({ where: { plate: { startsWith: "ตัวอย่าง-" } } })).count,
      ];
      return counts.reduce((a, b) => a + b, 0);
    });

    revalidatePath("/", "layout");
    return { ok: true, removed: result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ลบไม่สำเร็จ" };
  }
}
