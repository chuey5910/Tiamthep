"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseDate } from "@/lib/date";

type Result = { ok: boolean; error?: string };

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** รหัสอุปกรณ์ถัดไปในรูป TU00001 — ต่อจากเลขสูงสุดที่มีอยู่ */
async function nextUnitCode(): Promise<string> {
  const last = await prisma.serialUnit.findFirst({
    where: { code: { startsWith: "TU" } },
    orderBy: { code: "desc" },
  });
  const n = last ? Number(last.code.slice(2)) : 0;
  return `TU${String((Number.isFinite(n) ? n : 0) + 1).padStart(5, "0")}`;
}

/** รับอุปกรณ์รายชิ้นเข้าสต็อก — 1 ชิ้น = 1 แถว เพื่อติดตาม serial ได้ตลอดอายุการใช้งาน */
export async function createSerialUnits(form: FormData): Promise<Result> {
  const receivedAt = parseDate(str(form, "receivedAt"));
  if (!receivedAt) return { ok: false, error: "กรุณากรอกวันที่รับเข้า" };

  const itemCode = str(form, "itemCode");
  if (!itemCode) return { ok: false, error: "กรุณาเลือกสินค้า" };

  const qty = Number(str(form, "qty") || "1");
  if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
    return { ok: false, error: "จำนวนต้องเป็นจำนวนเต็ม 1-50 ชิ้น" };
  }

  const cost = Number(str(form, "cost") || "0");
  if (!Number.isFinite(cost) || cost < 0) return { ok: false, error: "ราคาทุนต้องเป็นตัวเลขที่ไม่ติดลบ" };

  // serial กรอกได้ทีละหลายตัว คั่นด้วยบรรทัดใหม่หรือจุลภาค
  const serials = str(form, "serials")
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (serials.length > 0 && serials.length !== qty) {
    return { ok: false, error: `กรอก Serial มา ${serials.length} ตัว แต่จำนวนที่รับเข้าคือ ${qty} ชิ้น — ต้องเท่ากัน` };
  }

  const brand = str(form, "brand") || null;
  const vendor = str(form, "vendor") || null;

  let code = await nextUnitCode();
  let n = Number(code.slice(2));

  try {
    await prisma.$transaction(
      Array.from({ length: qty }, (_, i) => {
        const data = {
          code: `TU${String(n + i).padStart(5, "0")}`,
          itemCode,
          receivedAt,
          brand,
          serial: serials[i] ?? null,
          cost,
          vendor,
        };
        return prisma.serialUnit.create({ data });
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique constraint")) return { ok: false, error: "รหัสอุปกรณ์ซ้ำ — ลองบันทึกอีกครั้ง" };
    return { ok: false, error: msg };
  }

  // อุปกรณ์รายชิ้นก็ต้องเข้าสต็อกรวมด้วย ไม่งั้นยอดคงเหลือจะไม่ตรง
  await prisma.stockIn.create({
    data: {
      date: receivedAt,
      itemCode,
      qty,
      unitCost: cost,
      vendor,
      billNo: str(form, "billNo") || null,
      note: `รับเข้าอุปกรณ์รายชิ้น ${code} เป็นต้นไป`,
    },
  });

  void code;
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteSerialUnit(code: string): Promise<Result> {
  const used = await prisma.stockOut.count({
    where: { OR: [{ newUnitCode: code }, { oldUnitCode: code }] },
  });
  if (used > 0) return { ok: false, error: "ลบไม่ได้ เพราะอุปกรณ์ชิ้นนี้ถูกเบิกใช้ไปแล้ว" };

  try {
    await prisma.serialUnit.delete({ where: { code } });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ลบไม่สำเร็จ" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** บันทึก/แก้ไขสถานะของเก่าที่ถอดออกมา */
export async function saveScrap(unitCode: string, form: FormData): Promise<Result> {
  const treadRaw = str(form, "treadMm");
  const priceRaw = str(form, "salePrice");
  const soldAt = parseDate(str(form, "soldAt"));
  const status = str(form, "status") || "รอขาย";

  const data = {
    treadMm: treadRaw === "" ? null : Number(treadRaw),
    status,
    buyer: str(form, "buyer") || null,
    salePrice: priceRaw === "" ? null : Number(priceRaw),
    soldAt,
    note: str(form, "note") || null,
  };

  if (data.treadMm != null && !Number.isFinite(data.treadMm)) return { ok: false, error: "ดอกยางต้องเป็นตัวเลข" };
  if (data.salePrice != null && !Number.isFinite(data.salePrice)) return { ok: false, error: "ราคาขายต้องเป็นตัวเลข" };
  if (status === "ขายแล้ว" && data.salePrice == null) {
    return { ok: false, error: "สถานะ 'ขายแล้ว' ต้องกรอกราคาขายด้วย" };
  }

  try {
    await prisma.scrapPart.upsert({
      where: { unitCode },
      create: { unitCode, ...data },
      update: data,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
