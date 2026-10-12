"use server";

import * as XLSX from "xlsx";
import { requireAuth } from "@/lib/auth";
import { RESOURCES } from "@/lib/crud";
import { crudExportTable } from "@/lib/crud-export";
import { formatThaiDateTime } from "@/lib/date";

export type ExcelFile = { ok: true; filename: string; base64: string } | { ok: false; error: string };

/**
 * Excel ของตารางข้อมูล ตามตัวกรองที่เลือกอยู่บนจอ (query = ?q=…&from=…&to=… ของหน้านั้น)
 * ส่งกลับเป็น base64 ให้เบราว์เซอร์บันทึกเอง — ไม่เก็บไฟล์ไว้บนเครื่อง
 */
export async function exportCrudExcel(resourceKey: string, query: string): Promise<ExcelFile> {
  await requireAuth();
  const resource = RESOURCES[resourceKey];
  if (!resource) return { ok: false, error: "ไม่พบตารางนี้" };
  try {
    const t = await crudExportTable(resource, Object.fromEntries(new URLSearchParams(query)));
    const top = [
      [t.title],
      [t.filterText ? `เงื่อนไข: ${t.filterText}` : "ทั้งหมด"],
      [`${t.rows.length.toLocaleString("th-TH")} รายการ · ออกไฟล์เมื่อ ${formatThaiDateTime(new Date())}`],
      [],
    ];
    const ws = XLSX.utils.aoa_to_sheet([...top, t.headers, ...t.rows]);
    // ตัวเลขเงินเป็นตัวเลขจริง (บวกในชีตต่อได้) แสดงลูกน้ำ + ทศนิยม 2 ตำแหน่ง
    t.kinds.forEach((k, c) => {
      if (k === "text") return;
      for (let r = 0; r < t.rows.length; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r: top.length + 1 + r, c })];
        if (cell && typeof cell.v === "number") cell.z = k === "money" ? "#,##0.00" : "#,##0.##";
      }
    });
    ws["!cols"] = t.headers.map((h, c) => ({
      wch: Math.min(48, Math.max(h.length + 2, ...t.rows.slice(0, 500).map((r) => String(r[c] ?? "").length + 2))),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ข้อมูล");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return { ok: true, filename: `${t.fileBase}.xlsx`, base64: buf.toString("base64") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "สร้างไฟล์ไม่สำเร็จ" };
  }
}
