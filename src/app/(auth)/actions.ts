"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  checkPasswordStrength,
  checkUsername,
  clearFailedLogins,
  createSession,
  destroySession,
  hashPassword,
  lockRemainingMinutes,
  normalizeUsername,
  registerFailedLogin,
  verifyPassword,
  writeLog,
  AUTH_LIMITS,
} from "@/lib/auth";

export type AuthResult = { ok: boolean; error?: string; message?: string };

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** หน่วงเวลาเล็กน้อยตอนล็อกอินล้มเหลว ทำให้ยิงเดารหัสรัวๆ ได้ช้าลง */
function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function login(form: FormData): Promise<AuthResult> {
  const username = normalizeUsername(str(form, "username"));
  const password = str(form, "password");
  const next = str(form, "next");

  if (!username || !password) {
    return { ok: false, error: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน" };
  }

  const user = await prisma.user.findUnique({ where: { username } });

  // ข้อความเดียวกันทั้งกรณีไม่มีบัญชีและรหัสผิด — ไม่บอกใบ้ว่าชื่อผู้ใช้ไหนมีอยู่จริง
  const wrongCredentials = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";

  if (!user) {
    await writeLog({ action: "LOGIN", username, success: false, reason: "ไม่พบชื่อผู้ใช้นี้" });
    await delay(400);
    return { ok: false, error: wrongCredentials };
  }

  const lockedMinutes = lockRemainingMinutes(user.lockedUntil);
  if (lockedMinutes > 0) {
    await writeLog({
      action: "LOGIN",
      username,
      userId: user.id,
      success: false,
      reason: `บัญชีถูกล็อกชั่วคราว เหลืออีก ${lockedMinutes} นาที`,
    });
    return {
      ok: false,
      error: `ใส่รหัสผิดหลายครั้งเกินไป บัญชีถูกล็อกชั่วคราว กรุณารออีก ${lockedMinutes} นาที`,
    };
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk) {
    await registerFailedLogin(user.id, user.failedLogins);
    const left = AUTH_LIMITS.MAX_FAILED - (user.failedLogins + 1);
    await writeLog({
      action: "LOGIN",
      username,
      userId: user.id,
      success: false,
      reason: "รหัสผ่านไม่ถูกต้อง",
    });
    await delay(400);
    return {
      ok: false,
      error:
        left > 0
          ? `${wrongCredentials} (เหลืออีก ${left} ครั้งก่อนบัญชีถูกล็อกชั่วคราว)`
          : `${wrongCredentials} — บัญชีถูกล็อก ${AUTH_LIMITS.LOCK_MINUTES} นาที`,
    };
  }

  // รหัสถูกแล้ว แต่ยังต้องผ่านด่านสถานะบัญชี
  if (user.status === "PENDING") {
    await writeLog({
      action: "LOGIN",
      username,
      userId: user.id,
      success: false,
      reason: "บัญชียังรอผู้ดูแลอนุมัติ",
    });
    return {
      ok: false,
      error: "บัญชีของคุณยังรอผู้ดูแลอนุมัติ กรุณาติดต่อผู้ดูแลระบบเพื่อเปิดใช้งาน",
    };
  }

  if (user.status === "SUSPENDED") {
    await writeLog({
      action: "LOGIN",
      username,
      userId: user.id,
      success: false,
      reason: "บัญชีถูกระงับการใช้งาน",
    });
    return { ok: false, error: "บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ" };
  }

  await clearFailedLogins(user.id);
  await createSession(user.id);
  await writeLog({ action: "LOGIN", username, userId: user.id, success: true });

  // กัน open redirect — รับเฉพาะเส้นทางภายในเว็บนี้
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  redirect(safeNext);
}

export async function register(form: FormData): Promise<AuthResult> {
  const username = normalizeUsername(str(form, "username"));
  const name = str(form, "name");
  const phone = str(form, "phone");
  const password = str(form, "password");
  const confirm = str(form, "confirm");

  if (!name) return { ok: false, error: "กรุณากรอกชื่อ-นามสกุล" };

  const usernameError = checkUsername(username);
  if (usernameError) return { ok: false, error: usernameError };

  if (password !== confirm) return { ok: false, error: "รหัสผ่านทั้งสองช่องไม่ตรงกัน" };

  const passwordError = checkPasswordStrength(password);
  if (passwordError) return { ok: false, error: passwordError };

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    await writeLog({ action: "REGISTER", username, success: false, reason: "ชื่อผู้ใช้ซ้ำ" });
    return { ok: false, error: "ชื่อผู้ใช้นี้มีคนใช้แล้ว กรุณาเลือกชื่ออื่น" };
  }

  // บัญชีแรกของระบบเป็นผู้ดูแลและใช้งานได้ทันที ไม่งั้นจะไม่มีใครอนุมัติใครได้เลย
  const isFirstUser = (await prisma.user.count()) === 0;

  const user = await prisma.user.create({
    data: {
      username,
      name,
      phone: phone || null,
      passwordHash: await hashPassword(password),
      role: isFirstUser ? "ADMIN" : "STAFF",
      status: isFirstUser ? "ACTIVE" : "PENDING",
      approvedAt: isFirstUser ? new Date() : null,
    },
  });

  await writeLog({
    action: "REGISTER",
    username,
    userId: user.id,
    success: true,
    reason: isFirstUser ? "บัญชีแรกของระบบ ตั้งเป็นผู้ดูแลอัตโนมัติ" : "รอผู้ดูแลอนุมัติ",
  });

  if (isFirstUser) {
    await createSession(user.id);
    await writeLog({ action: "LOGIN", username, userId: user.id, success: true });
    redirect("/");
  }

  return {
    ok: true,
    message:
      "สมัครเรียบร้อยแล้ว — บัญชีของคุณอยู่ระหว่างรอผู้ดูแลอนุมัติ เมื่ออนุมัติแล้วจึงจะเข้าระบบได้ กรุณาแจ้งผู้ดูแลให้ตรวจสอบ",
  };
}

export async function logout(): Promise<void> {
  const user = await destroySession();
  if (user) {
    await writeLog({ action: "LOGOUT", username: user.username, userId: user.id, success: true });
  }
  redirect("/login");
}
