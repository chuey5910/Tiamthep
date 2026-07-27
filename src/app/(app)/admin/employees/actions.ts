"use server";

import { revalidatePath } from "next/cache";
import { normalizeFullName, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type Result = { ok: boolean; error?: string };

const done = (): Result => {
  revalidatePath("/admin/employees");
  return { ok: true };
};

export async function addEmployee(form: FormData): Promise<Result> {
  await requireAdmin();
  const name = normalizeFullName(String(form.get("name") ?? ""));
  const position = String(form.get("position") ?? "").trim();
  if (!name) return { ok: false, error: "กรุณากรอกชื่อ-นามสกุล" };

  const dup = await prisma.employee.findUnique({ where: { name } });
  if (dup) return { ok: false, error: `มีชื่อ "${name}" ในทะเบียนอยู่แล้ว` };

  await prisma.employee.create({ data: { name, position: position || null } });
  return done();
}

export async function toggleEmployee(id: number): Promise<Result> {
  await requireAdmin();
  const emp = await prisma.employee.findUnique({ where: { id } });
  if (!emp) return { ok: false, error: "ไม่พบรายชื่อนี้" };
  await prisma.employee.update({ where: { id }, data: { active: !emp.active } });
  return done();
}

export async function deleteEmployee(id: number): Promise<Result> {
  await requireAdmin();
  const emp = await prisma.employee.findUnique({ where: { id } });
  if (!emp) return { ok: false, error: "ไม่พบรายชื่อนี้" };
  if (emp.userId) {
    return {
      ok: false,
      error: "ลบไม่ได้ — ชื่อนี้มีบัญชีผู้ใช้ผูกอยู่ ให้ปิดใช้งานแทน (บัญชีให้ไประงับที่หน้าจัดการผู้ใช้)",
    };
  }
  await prisma.employee.delete({ where: { id } });
  return done();
}

/** แก้ชื่อ/ตำแหน่ง — ใช้ตอนพิมพ์ชื่อผิดหรือเปลี่ยนตำแหน่ง */
export async function updateEmployee(id: number, form: FormData): Promise<Result> {
  await requireAdmin();
  const name = normalizeFullName(String(form.get("name") ?? ""));
  const position = String(form.get("position") ?? "").trim();
  if (!name) return { ok: false, error: "กรุณากรอกชื่อ-นามสกุล" };

  const dup = await prisma.employee.findFirst({ where: { name, id: { not: id } } });
  if (dup) return { ok: false, error: `มีชื่อ "${name}" ในทะเบียนอยู่แล้ว` };

  await prisma.employee.update({ where: { id }, data: { name, position: position || null } });
  return done();
}
