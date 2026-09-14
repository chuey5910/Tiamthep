"use server";

import { requireWrite } from "@/lib/auth";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { RESOURCES, type Field, type Resource } from "@/lib/crud";
import { parseDate } from "@/lib/date";

type ActionResult = { ok: boolean; error?: string };

/**
 * ช่องที่ฐานข้อมูลไม่ยอมรับค่าว่าง (คอลัมน์ไม่ใช่ nullable) — เช่น Lookup.sort ที่เป็น
 * Int มีค่าเริ่มต้น 0 · เว้นว่างในฟอร์มแล้วส่ง null เข้าไป Prisma จะปฏิเสธทั้งแถว
 * จึงต้องรู้ก่อนว่าคอลัมน์ไหนรับ null ได้ แล้ว "ไม่ส่งช่องนั้นไปเลย" เพื่อให้ใช้ค่าเริ่มต้น
 *
 * อ่านจากโครงสร้างจริงของ schema (ไม่ต้องมาไล่ตั้งค่าทีละฟิลด์ให้ตกหล่น)
 */
const NON_NULL_COLUMNS: Map<string, Set<string>> = (() => {
  const map = new Map<string, Set<string>>();
  for (const model of Prisma.dmmf.datamodel.models) {
    const key = model.name.charAt(0).toLowerCase() + model.name.slice(1);
    const cols = new Set<string>();
    for (const f of model.fields) {
      if (f.kind === "scalar" && f.isRequired) cols.add(f.name);
    }
    map.set(key, cols);
  }
  return map;
})();

function acceptsNull(model: string, column: string): boolean {
  return !NON_NULL_COLUMNS.get(model)?.has(column);
}

/** ค่าที่แปลว่า "ผู้ใช้เว้นว่างไว้" — ต่างจาก null ตรงที่จะไม่ถูกส่งเข้าฐานข้อมูล */
const BLANK = Symbol("blank");

function coerce(field: Field, raw: FormDataEntryValue | null): unknown {
  if (field.type === "checkbox") return raw === "on" || raw === "true";

  const s = raw == null ? "" : String(raw).trim();

  if (s === "") {
    if (field.type === "number" && field.required) return 0;
    return BLANK;
  }

  switch (field.type) {
    case "number": {
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }
    case "date":
      return parseDate(s);
    default:
      return s;
  }
}

/** ฟิลด์ที่เป็น relation id ต้องเก็บเป็นตัวเลข */
const NUMERIC_RELATION_FIELDS = new Set(["partnerId", "customerId", "fuelBasisId", "routeId", "bandId"]);

function buildData(resource: Resource, form: FormData, forUpdate: boolean): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const f of resource.fields) {
    if (f.hideInForm) continue;
    if (forUpdate && f.immutable) continue;
    if (f.type !== "checkbox" && !form.has(f.name)) continue;

    let v = coerce(f, form.get(f.name));

    if (v === BLANK) {
      // เว้นว่างในช่องที่คอลัมน์ห้ามเป็น null → ข้ามไปเลย ให้ฐานข้อมูลใช้ค่าเริ่มต้น
      if (!acceptsNull(resource.model, f.name)) continue;
      v = null;
    }

    if (NUMERIC_RELATION_FIELDS.has(f.name) && v != null && v !== "") v = Number(v);
    data[f.name] = v;
  }
  return data;
}

function validate(resource: Resource, data: Record<string, unknown>): string | null {
  for (const f of resource.fields) {
    if (!f.required || f.hideInForm) continue;
    if (!(f.name in data)) continue;
    const v = data[f.name];
    if (v == null || v === "") return `กรุณากรอก "${f.label}"`;
  }
  return null;
}

/** กฎเฉพาะบางตาราง ที่ต้องเติมค่าหรือคุมความถูกต้องเพิ่ม */
async function applyRules(resource: Resource, data: Record<string, unknown>): Promise<string | null> {
  if (resource.model === "expense") {
    // ราคารวมเว้นว่าง = คิดจาก ราคาต่อหน่วย × จำนวน
    const amount = data.amount as number | null;
    if (amount == null || amount === 0) {
      const unitPrice = Number(data.unitPrice ?? 0);
      const qty = Number(data.qty ?? 0);
      data.amount = Math.round(unitPrice * qty * 100) / 100;
    }
  }

  if (resource.model === "vehicle") {
    if (data.ownerType === "รถร่วม" && !data.partnerId) {
      return "รถร่วมต้องระบุชื่อรถร่วม — ถ้ายังไม่มี ให้เพิ่มที่หน้า 'รถร่วม (outsource)' ก่อน";
    }
    if (data.ownerType !== "รถร่วม") data.partnerId = null;
  }

  if (resource.model === "priceBand") {
    const min = Number(data.minPrice);
    const max = Number(data.maxPrice);
    if (Number.isFinite(min) && Number.isFinite(max) && min >= max) {
      return "ช่วงราคาไม่ถูกต้อง — ค่า 'มากกว่า' ต้องน้อยกว่าค่า 'ถึง'";
    }
  }

  if (resource.model === "stockOut") {
    // มูลค่าที่เบิกเว้นว่าง = ราคาทุนล่าสุดที่รับเข้า × จำนวน
    const cost = data.cost as number | null;
    if ((cost == null || cost === 0) && data.itemCode) {
      const last = await prisma.stockIn.findFirst({
        where: { itemCode: String(data.itemCode) },
        orderBy: [{ date: "desc" }, { id: "desc" }],
      });
      data.cost = Math.round((last?.unitCost ?? 0) * Number(data.qty ?? 0) * 100) / 100;
    }
  }

  if (resource.model === "stockIn" || resource.model === "stockOut") {
    if (Number(data.qty ?? 0) <= 0) return "จำนวนต้องมากกว่า 0";
  }

  if (resource.model === "vehiclePairing") {
    if (data.headPlate && data.headPlate === data.trailerPlate) {
      return "ทะเบียนแม่กับหางพ่วงต้องเป็นคนละคัน";
    }
  }

  return null;
}

function idWhere(resource: Resource, id: string): Record<string, unknown> {
  if (resource.idType === "number") return { [resource.idField]: Number(id) };
  if (resource.idType === "date") return { [resource.idField]: parseDate(id) };
  return { [resource.idField]: id };
}

function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("Unique constraint")) return "มีข้อมูลนี้อยู่แล้ว (ค่าซ้ำกับแถวเดิม)";
  if (msg.includes("Foreign key constraint")) {
    return "ลบไม่ได้ เพราะมีข้อมูลอื่นอ้างถึงอยู่ — ให้ปิดใช้งานแทนการลบ";
  }
  if (msg.includes("Record to update not found") || msg.includes("Record to delete does not exist")) {
    return "ไม่พบข้อมูลที่ต้องการแก้ไข (อาจถูกลบไปแล้ว)";
  }
  return msg;
}

export async function createRecord(resourceKey: string, form: FormData): Promise<ActionResult> {
  await requireWrite();
  const resource = RESOURCES[resourceKey];
  if (!resource) return { ok: false, error: "ไม่พบตารางนี้" };

  const data = buildData(resource, form, false);
  const invalid = validate(resource, data);
  if (invalid) return { ok: false, error: invalid };
  const ruleError = await applyRules(resource, data);
  if (ruleError) return { ok: false, error: ruleError };

  try {
    await (prisma as never as Record<string, { create: (a: unknown) => Promise<unknown> }>)[resource.model].create({
      data,
    });
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateRecord(resourceKey: string, id: string, form: FormData): Promise<ActionResult> {
  await requireWrite();
  const resource = RESOURCES[resourceKey];
  if (!resource) return { ok: false, error: "ไม่พบตารางนี้" };

  const data = buildData(resource, form, true);
  const invalid = validate(resource, data);
  if (invalid) return { ok: false, error: invalid };
  const ruleError = await applyRules(resource, data);
  if (ruleError) return { ok: false, error: ruleError };

  try {
    await (
      prisma as never as Record<string, { update: (a: unknown) => Promise<unknown> }>
    )[resource.model].update({ where: idWhere(resource, id), data });
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteRecord(resourceKey: string, id: string): Promise<ActionResult> {
  await requireWrite();
  const resource = RESOURCES[resourceKey];
  if (!resource) return { ok: false, error: "ไม่พบตารางนี้" };

  try {
    await (
      prisma as never as Record<string, { delete: (a: unknown) => Promise<unknown> }>
    )[resource.model].delete({ where: idWhere(resource, id) });
  } catch (e) {
    return { ok: false, error: friendlyError(e) };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
