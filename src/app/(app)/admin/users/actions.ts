"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  checkPasswordStrength,
  hashPassword,
  requireAdmin,
  writeLog,
  type LogAction,
} from "@/lib/auth";

export type Result = { ok: boolean; error?: string; message?: string };

/** ผู้ดูแลคนสุดท้ายที่ยังใช้งานได้ ห้ามถูกถอดสิทธิ์หรือระงับ ไม่งั้นจะไม่มีใครเข้าจัดการระบบได้ */
async function wouldRemoveLastAdmin(userId: string): Promise<boolean> {
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.role !== "ADMIN" || target.status !== "ACTIVE") return false;
  const activeAdmins = await prisma.user.count({ where: { role: "ADMIN", status: "ACTIVE" } });
  return activeAdmins <= 1;
}

async function act(
  userId: string,
  action: LogAction,
  data: Record<string, unknown>,
  reason: string,
): Promise<Result> {
  const admin = await requireAdmin();
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return { ok: false, error: "ไม่พบผู้ใช้รายนี้" };

  await prisma.user.update({ where: { id: userId }, data });
  await writeLog({
    action,
    username: target.username,
    userId: target.id,
    success: true,
    reason: `${reason} (โดย ${admin.username})`,
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function approveUser(userId: string, role: string): Promise<Result> {
  const admin = await requireAdmin();
  if (!["ADMIN", "STAFF", "VIEWER"].includes(role)) return { ok: false, error: "สิทธิ์ไม่ถูกต้อง" };

  return act(
    userId,
    "APPROVE",
    { status: "ACTIVE", role, approvedAt: new Date(), approvedById: admin.id, failedLogins: 0, lockedUntil: null },
    `อนุมัติให้ใช้งาน สิทธิ์ ${role}`,
  );
}

export async function rejectUser(userId: string): Promise<Result> {
  const admin = await requireAdmin();
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return { ok: false, error: "ไม่พบผู้ใช้รายนี้" };
  if (target.status !== "PENDING") {
    return { ok: false, error: "ปฏิเสธได้เฉพาะคำขอที่ยังรออนุมัติ — ถ้าจะปิดการใช้งานให้กดระงับแทน" };
  }

  // เก็บประวัติไว้ก่อนลบบัญชี เพื่อให้ยังตรวจย้อนหลังได้ว่าเคยมีใครขอเข้ามาบ้าง
  await writeLog({
    action: "REJECT",
    username: target.username,
    userId: null,
    success: true,
    reason: `ปฏิเสธคำขอสมัครของ "${target.name}" (โดย ${admin.username})`,
  });
  await prisma.user.delete({ where: { id: userId } });

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function suspendUser(userId: string): Promise<Result> {
  if (await wouldRemoveLastAdmin(userId)) {
    return { ok: false, error: "ระงับไม่ได้ — นี่เป็นผู้ดูแลระบบคนสุดท้ายที่ใช้งานได้" };
  }
  // ตัดเซสชันที่เปิดค้างอยู่ด้วย ไม่งั้นยังใช้งานต่อได้จนกว่าจะปิดเบราว์เซอร์
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return act(userId, "SUSPEND", { status: "SUSPENDED" }, "ระงับการใช้งาน");
}

export async function reactivateUser(userId: string): Promise<Result> {
  return act(userId, "REACTIVATE", { status: "ACTIVE", failedLogins: 0, lockedUntil: null }, "เปิดใช้งานอีกครั้ง");
}

export async function changeRole(userId: string, role: string): Promise<Result> {
  if (!["ADMIN", "STAFF", "VIEWER"].includes(role)) return { ok: false, error: "สิทธิ์ไม่ถูกต้อง" };
  if (role !== "ADMIN" && (await wouldRemoveLastAdmin(userId))) {
    return { ok: false, error: "เปลี่ยนสิทธิ์ไม่ได้ — นี่เป็นผู้ดูแลระบบคนสุดท้ายที่ใช้งานได้" };
  }
  return act(userId, "ROLE_CHANGE", { role }, `เปลี่ยนสิทธิ์เป็น ${role}`);
}

/** ปลดล็อกบัญชีที่ถูกล็อกเพราะใส่รหัสผิดหลายครั้ง */
export async function unlockUser(userId: string): Promise<Result> {
  return act(userId, "REACTIVATE", { failedLogins: 0, lockedUntil: null }, "ปลดล็อกบัญชี");
}

/** ตั้งรหัสผ่านใหม่ให้ผู้ใช้ กรณีลืมรหัส */
export async function resetPassword(userId: string, password: string): Promise<Result> {
  const admin = await requireAdmin();
  const problem = checkPasswordStrength(password);
  if (problem) return { ok: false, error: problem };

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return { ok: false, error: "ไม่พบผู้ใช้รายนี้" };

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null },
  });
  // บังคับให้เข้าระบบใหม่ทุกเครื่อง
  await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });

  await writeLog({
    action: "PASSWORD_CHANGE",
    username: target.username,
    userId: target.id,
    success: true,
    reason: `ผู้ดูแลตั้งรหัสผ่านใหม่ให้ (โดย ${admin.username})`,
  });

  revalidatePath("/", "layout");
  return { ok: true, message: "ตั้งรหัสผ่านใหม่แล้ว — แจ้งรหัสให้ผู้ใช้แล้วให้เปลี่ยนเองทันทีที่เข้าระบบได้" };
}
