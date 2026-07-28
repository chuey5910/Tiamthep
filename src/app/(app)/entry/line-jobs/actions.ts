"use server";

import { revalidatePath } from "next/cache";
import { requireWrite } from "@/lib/auth";
import { runSheetImport, type SheetImportResult } from "@/lib/sheet-jobs";

/** ดึงงานสถานะ «ยืนยัน» จากชีตสั่งงานไลน์เข้าฐานข้อมูล — เรียกซ้ำได้ ไม่เกิดข้อมูลซ้ำ */
export async function importFromSheet(): Promise<SheetImportResult> {
  await requireWrite();
  const result = await runSheetImport();
  if (result.ok && result.imported > 0) revalidatePath("/", "layout");
  return result;
}
