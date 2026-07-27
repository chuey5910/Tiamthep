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
  normalizeFullName,
  normalizeUsername,
  registerFailedLogin,
  verifyPassword,
  writeLog,
  AUTH_LIMITS,
} from "@/lib/auth";
import { EMPLOYEE_CHECK_ERROR, type EmployeeCheck } from "@/lib/roles";

export type AuthResult = { ok: boolean; error?: string; message?: string };

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/**
 * ตรวจชื่อผู้สมัครกับทะเบียนพนักงานบริษัท — ใช้ทั้งตอนพิมพ์ในหน้าสมัคร
 * (เปิด/ปิดปุ่ม) และตรวจซ้ำจริงอีกครั้งใน register() ตอนกดส่ง
 */
export async function checkEmployeeName(rawName: string): Promise<EmployeeCheck> {
  if ((await prisma.user.count()) === 0) return "first";
  const name = normalizeFullName(rawName);
  if (!name) return "notfound";
  const emp = await prisma.employee.findUnique({ where: { name } });
  if (!emp) return "notfound";
  if (!emp.active) return "inactive";
  if (emp.userId) return "taken";
  return "ok";
}

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

  // นโยบายบริษัท: ต้องมีชื่อในทะเบียนพนักงานจึงสมัครได้ และ 1 ชื่อ = 1 บัญชี
  // (ยกเว้นบัญชีแรกตอนตั้งค่าระบบ ซึ่งทะเบียนพนักงานยังว่างอยู่)
  const empName = normalizeFullName(name);
  if (!isFirstUser) {
    const check: EmployeeCheck = await checkEmployeeName(empName);
    if (check !== "ok") {
      const reasonMap: Record<string, string> = {
        notfound: "ไม่พบชื่อในทะเบียนพนักงาน",
        taken: "ชื่อพนักงานนี้มีบัญชีแล้ว",
        inactive: "ชื่อพนักงานถูกปิดใช้งาน",
      };
      await writeLog({
        action: "REGISTER",
        username,
        success: false,
        reason: `${reasonMap[check] ?? check}: ${empName}`,
      });
      return { ok: false, error: EMPLOYEE_CHECK_ERROR[check as keyof typeof EMPLOYEE_CHECK_ERROR] };
    }
  }

  const passwordHash = await hashPassword(password);
  // สร้างบัญชีและจองรายชื่อพนักงานใน transaction เดียว — สมัครพร้อมกัน
  // สองเครื่องด้วยชื่อเดียวกัน จะสำเร็จได้แค่รายเดียว (updateMany เช็ค userId ว่าง)
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        username,
        name: empName,
        phone: phone || null,
        passwordHash,
        role: isFirstUser ? "ADMIN" : "STAFF",
        status: isFirstUser ? "ACTIVE" : "PENDING",
        approvedAt: isFirstUser ? new Date() : null,
      },
    });
    if (!isFirstUser) {
      const claimed = await tx.employee.updateMany({
        where: { name: empName, userId: null, active: true },
        data: { userId: created.id },
      });
      if (claimed.count !== 1) {
        throw new Error("EMPLOYEE_TAKEN");
      }
    }
    return created;
  }).catch(async (e) => {
    if (e instanceof Error && e.message === "EMPLOYEE_TAKEN") return null;
    throw e;
  });

  if (!user) {
    await writeLog({
      action: "REGISTER",
      username,
      success: false,
      reason: `ชื่อพนักงานถูกจองตัดหน้า: ${empName}`,
    });
    return { ok: false, error: EMPLOYEE_CHECK_ERROR.taken };
  }

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
