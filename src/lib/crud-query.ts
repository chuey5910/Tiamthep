/**
 * เงื่อนไขค้นหาของตารางข้อมูล (CrudPage) — ใช้ที่เดียว ทั้งหน้าจอ และไฟล์ Export (Excel / PDF)
 * ไฟล์ที่ได้จึงตรงกับที่เห็นบนจอเสมอ (คำค้น · dropdown · ช่วงวันที่ · เฉพาะใกล้หมดอายุ)
 */

import type { Resource } from "./crud";
import { formatThaiDate } from "./date";
import type { SearchParams } from "./params";
import { prisma } from "./prisma";

export type CrudQuery = {
  where: Record<string, unknown>;
  q: string;
  from: string;
  to: string;
  filterValues: Record<string, string>;
  onlyExpiring: boolean;
  alertDays: number;
  today: Date;
};

const ymd = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

export async function crudQuery(resource: Resource, searchParams: SearchParams): Promise<CrudQuery> {
  const q = typeof searchParams.q === "string" ? searchParams.q.trim() : "";

  // PostgreSQL เทียบตัวพิมพ์ใหญ่-เล็กเป็นคนละตัว จึงต้องสั่ง insensitive
  // ไม่งั้นค้น "bgc" จะไม่เจอ "BGC"
  const and: Record<string, unknown>[] = [];
  if (q && resource.searchFields?.length) {
    and.push({ OR: resource.searchFields.map((f) => ({ [f]: { contains: q, mode: "insensitive" } })) });
  }

  // dropdown กรองรายคอลัมน์ (?f_ชื่อฟิลด์=ค่า) — เลือกค่าเดียว เหมือน filter บนหัวตารางในชีต
  const filterValues: Record<string, string> = {};
  for (const f of resource.filterFields ?? []) {
    const v = searchParams[`f_${f}`];
    const val = typeof v === "string" ? v.trim() : "";
    if (val) {
      filterValues[f] = val;
      and.push({ [f]: val });
    }
  }

  // เอกสารใกล้หมดอายุ — ใช้จำนวนวันแจ้งเตือนเดียวกับหน้าหลัก (ตั้งค่า → แจ้งเตือนเอกสารล่วงหน้า)
  const expiryFields = resource.expiryFields ?? [];
  let alertDays = 30;
  if (expiryFields.length) {
    const s = await prisma.setting.findUnique({ where: { key: "docAlertDays" } });
    alertDays = Number(s?.value) > 0 ? Number(s!.value) : 30;
  }
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const threshold = new Date(today.getTime() + alertDays * 86400000);
  const onlyExpiring = searchParams.expiring === "1" && expiryFields.length > 0;
  if (onlyExpiring) and.push({ OR: expiryFields.map((f) => ({ [f]: { lte: threshold } })) });

  // ช่วงวันที่ (?from=YYYY-MM-DD&to=YYYY-MM-DD) — ใส่ช่องเดียวก็ได้ (ตั้งแต่… / ถึง…)
  const from = resource.dateRangeField ? ymd(searchParams.from) : "";
  const to = resource.dateRangeField ? ymd(searchParams.to) : "";
  if (from || to) {
    and.push({
      [resource.dateRangeField!]: {
        ...(from ? { gte: new Date(from + "T00:00:00Z") } : {}),
        ...(to ? { lte: new Date(to + "T00:00:00Z") } : {}),
      },
    });
  }

  return { where: and.length ? { AND: and } : {}, q, from, to, filterValues, onlyExpiring, alertDays, today };
}

/** สรุปเงื่อนไขเป็นข้อความ (หัวไฟล์ Export) — เช่น "ช่วงวันที่ 10 ก.ค. 2569 – 20 ก.ค. 2569 · ค้นหา «D002»" */
export function describeQuery(resource: Resource, cq: CrudQuery, optionLabel: (field: string, value: string) => string): string {
  const parts: string[] = [];
  const d = (s: string) => formatThaiDate(new Date(s + "T00:00:00Z"));
  if (cq.from && cq.to) parts.push(`ช่วงวันที่ ${d(cq.from)} – ${d(cq.to)}`);
  else if (cq.from) parts.push(`ตั้งแต่วันที่ ${d(cq.from)}`);
  else if (cq.to) parts.push(`ถึงวันที่ ${d(cq.to)}`);
  else if (resource.dateRangeField) parts.push("ทุกวันที่");
  for (const [f, v] of Object.entries(cq.filterValues)) {
    const label = resource.fields.find((x) => x.name === f)?.label ?? f;
    parts.push(`${label}: ${optionLabel(f, v)}`);
  }
  if (cq.q) parts.push(`ค้นหา «${cq.q}»`);
  if (cq.onlyExpiring) parts.push(`เฉพาะเอกสารใกล้หมดอายุ (${cq.alertDays} วัน)`);
  return parts.join(" · ");
}
