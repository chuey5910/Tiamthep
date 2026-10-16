/**
 * ข้อมูลสำหรับ Export ตารางข้อมูล (Excel / PDF) — แถวและคอลัมน์ตรงกับที่เห็นบนจอ
 * ทุกแถวตามตัวกรอง (ไม่ใช่แค่หน้าที่เปิดอยู่) · คอลัมน์ = คอลัมน์ในตาราง · ตัวเลือกแปลงเป็นข้อความที่คนอ่าน
 */

import { loadOptions, type Resource } from "./crud";
import { crudQuery, describeQuery } from "./crud-query";
import { formatThaiDate } from "./date";
import type { SearchParams } from "./params";
import { prisma } from "./prisma";

export type ExportCell = string | number | null;

export type ExportTable = {
  title: string;
  /** เงื่อนไขที่กรอง (ข้อความ) */
  filterText: string;
  headers: string[];
  /** คอลัมน์ไหนเป็นตัวเลข/เงิน (Excel ใส่รูปแบบตัวเลข) */
  kinds: ("money" | "num" | "text")[];
  rows: ExportCell[][];
  /** ชื่อไฟล์ไม่รวมนามสกุล — อักษรอังกฤษเท่านั้น (เบราว์เซอร์ทิ้งชื่อไทยในไฟล์ดาวน์โหลด) */
  fileBase: string;
};

export async function crudExportTable(resource: Resource, searchParams: SearchParams): Promise<ExportTable> {
  const [options, cq] = await Promise.all([loadOptions(resource), crudQuery(resource, searchParams)]);
  const model = (prisma as never as Record<string, { findMany: (a: unknown) => Promise<Record<string, unknown>[]> }>)[resource.model];
  const data = await model.findMany({ where: cq.where, orderBy: resource.orderBy });

  const fields = resource.fields.filter((f) => !f.hideInTable);
  const label = (field: string, value: string) => options[field]?.find((o) => o.value === value)?.label ?? value;

  const cell = (f: (typeof fields)[number], v: unknown): ExportCell => {
    if (v == null || v === "") return null;
    if (options[f.name]?.length) {
      const hit = options[f.name].find((o) => o.value === String(v));
      if (hit) return hit.label;
    }
    if (v instanceof Date) return formatThaiDate(v);
    if (typeof v === "boolean") return v ? "ใช่" : "ไม่";
    if (f.format === "money" || f.format === "num") return Number(v);
    if (f.format === "date") return formatThaiDate(new Date(String(v)));
    return String(v);
  };

  return {
    title: resource.title,
    filterText: describeQuery(resource, cq, label),
    headers: fields.map((f) => f.label),
    kinds: fields.map((f) => (f.format === "money" ? "money" : f.format === "num" ? "num" : "text")),
    rows: data.map((r) => fields.map((f) => cell(f, r[f.name]))),
    fileBase: [resource.key, cq.from, cq.to].filter(Boolean).join("_"),
  };
}
