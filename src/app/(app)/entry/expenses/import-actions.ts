"use server";

import { revalidatePath } from "next/cache";
import { requireWrite } from "@/lib/auth";
import { expenseTemplate, parseExpenseFile, saveExpenseRows, toPreview, type ImportPreview } from "@/lib/expense-import";

const MAX_BYTES = 5 * 1024 * 1024;

async function readFile(form: FormData): Promise<Buffer | string> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return "ยังไม่ได้เลือกไฟล์";
  if (file.size > MAX_BYTES) return "ไฟล์ใหญ่เกิน 5 MB — แบ่งเป็นหลายไฟล์";
  return Buffer.from(await file.arrayBuffer());
}

/** อ่านไฟล์แล้วตรวจทีละแถว — ยังไม่บันทึก */
export async function previewExpenseImport(form: FormData): Promise<ImportPreview> {
  await requireWrite();
  const buf = await readFile(form);
  if (typeof buf === "string") return { ok: false, error: buf };
  const r = await parseExpenseFile(buf);
  if (!r.ok) return r;
  return { ok: true, rows: toPreview(r.rows), skipped: r.skipped, missingHeaders: r.missingHeaders };
}

/** บันทึกแถวที่ติ๊ก — อ่านไฟล์ใหม่ฝั่งเซิร์ฟเวอร์ (ไม่เชื่อค่าจากหน้าเว็บ) · แถวที่มี ❌ ไม่บันทึกแม้ส่งมา */
export async function commitExpenseImport(form: FormData): Promise<{ ok: true; saved: number; amount: number } | { ok: false; error: string }> {
  await requireWrite();
  const buf = await readFile(form);
  if (typeof buf === "string") return { ok: false, error: buf };
  const lines = String(form.get("lines") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  if (lines.length === 0) return { ok: false, error: "ยังไม่ได้ติ๊กแถวที่จะนำเข้า" };
  const r = await parseExpenseFile(buf);
  if (!r.ok) return r;
  try {
    const res = await saveExpenseRows(r.rows, lines);
    revalidatePath("/", "layout");
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" };
  }
}

/** แบบฟอร์มเปล่า — หัวคอลัมน์ตรงกับที่ตัวนำเข้ารับ */
export async function expenseTemplateFile(): Promise<{ filename: string; base64: string }> {
  await requireWrite();
  return { filename: "expenses-template.xlsx", base64: expenseTemplate().toString("base64") };
}
