"use server";

import { revalidatePath } from "next/cache";
import { requireWrite } from "@/lib/auth";
import { resolveDuplicateRow, runSheetImport, type SheetImportResult } from "@/lib/sheet-jobs";

/** ดึงงานสถานะ «ยืนยัน» จากชีตสั่งงานไลน์เข้าฐานข้อมูล — เรียกซ้ำได้ ไม่เกิดข้อมูลซ้ำ */
export async function importFromSheet(): Promise<SheetImportResult> {
  await requireWrite();
  const result = await runSheetImport();
  if (result.ok && result.imported > 0) revalidatePath("/", "layout");
  return result;
}

/**
 * คนตัดสินแถวรหัสซ้ำที่ระบบตัดสินเองไม่ได้ — เขียนลงชีตผ่าน API แล้วดึงงานใหม่ทันที
 * ผลที่คืนคือผลดึงงานรอบใหม่ หน้าเว็บจึงเห็นสถานะล่าสุดเสมอ
 */
export async function resolveDuplicate(
  rowNo: number,
  jobId: string,
  action: "rename" | "cancel",
): Promise<SheetImportResult> {
  await requireWrite();
  const res = await resolveDuplicateRow(rowNo, jobId, action);
  if (!res.ok) {
    return { ok: false, error: res.error, imported: 0, failed: 0, pendingReview: 0, advancesSynced: 0, refreshed: 0, duplicates: [], renumbered: [], rows: [] };
  }
  const result = await runSheetImport();
  if (result.ok && result.imported > 0) revalidatePath("/", "layout");
  return result;
}
