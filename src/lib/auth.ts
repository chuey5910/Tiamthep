/**
 * ระบบล็อกอิน สิทธิ์การใช้งาน และการบันทึกประวัติเข้าระบบ
 *
 * แนวทางที่ใช้
 *  • รหัสผ่านเก็บเป็น scrypt hash พร้อม salt สุ่มรายคน (มากับ Node ไม่ต้องลงเพิ่ม)
 *  • เซสชันเก็บ "hash ของ token" ในฐานข้อมูล ส่วน token จริงอยู่แค่ใน cookie
 *    ถ้าฐานข้อมูลรั่ว คนที่ได้ไปก็ปลอมเป็นผู้ใช้ไม่ได้
 *  • cookie เป็น httpOnly + sameSite=lax และเป็น secure เมื่อรันผ่าน https
 *  • ใส่รหัสผิดติดกันหลายครั้ง จะถูกล็อกชั่วคราว กันการเดารหัส
 */

import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

export const SESSION_COOKIE = "tt_session";
const SESSION_DAYS = 7;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

// ── รหัสผ่าน ──────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const key = await scryptAsync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  // เทียบแบบเวลาคงที่ กันการเดารหัสจากเวลาที่ใช้ตอบ
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** ตรวจความแข็งแรงของรหัสผ่าน — คืนข้อความบอกปัญหา หรือ null ถ้าผ่าน */
export function checkPasswordStrength(password: string): string | null {
  if (password.length < 8) return "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร";
  if (!/[a-zA-Zก-๙]/.test(password)) return "รหัสผ่านต้องมีตัวอักษรอย่างน้อย 1 ตัว";
  if (!/[0-9]/.test(password)) return "รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว";
  const weak = ["password", "12345678", "11111111", "qwertyui", "tt2026", "admin123"];
  if (weak.includes(password.toLowerCase())) return "รหัสผ่านนี้เดาง่ายเกินไป กรุณาตั้งใหม่";
  return null;
}

/** ชื่อผู้ใช้เก็บเป็นตัวพิมพ์เล็กเสมอ กันสมัครซ้ำด้วยตัวพิมพ์ต่างกัน */
export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

/** ตัดช่องว่างซ้ำก่อนเทียบชื่อ — "สมชาย  ใจดี" กับ "สมชาย ใจดี" คือคนเดียวกัน */
export function normalizeFullName(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export function checkUsername(username: string): string | null {
  if (username.length < 3) return "ชื่อผู้ใช้ต้องยาวอย่างน้อย 3 ตัวอักษร";
  if (username.length > 40) return "ชื่อผู้ใช้ยาวเกินไป (ไม่เกิน 40 ตัวอักษร)";
  if (!/^[a-z0-9._@-]+$/.test(username)) {
    return "ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 และ . _ - @ (ไม่มีเว้นวรรคและภาษาไทย)";
  }
  return null;
}

// ── ข้อมูลผู้ใช้และสิทธิ์ ─────────────────────────────────
// นิยามอยู่ใน roles.ts เพราะ client component ต้องใช้ด้วย
export {
  ROLE_LABEL,
  STATUS_LABEL,
  ACTION_LABEL,
  canWrite,
  isAdmin,
  lockRemainingMinutes,
} from "./roles";
export type { SessionUser, Role, LogAction } from "./roles";

import { canWrite, isAdmin } from "./roles";
import type { SessionUser, LogAction } from "./roles";

// ── เซสชัน ────────────────────────────────────────────────

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** ที่อยู่ผู้ใช้และเบราว์เซอร์ สำหรับเก็บลงประวัติ */
export async function requestInfo(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : h.get("x-real-ip");
  return { ip: ip || null, userAgent: h.get("user-agent")?.slice(0, 300) || null };
}

export async function createSession(userId: string): Promise<void> {
  const token = randomUUID() + randomBytes(24).toString("hex");
  const { ip, userAgent } = await requestInfo();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);

  await prisma.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt, ip, userAgent },
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // ระบบนี้ใช้ในวงแลน/Tailscale ผ่าน http — ถ้าตั้ง secure เบราว์เซอร์จะทิ้ง
    // cookie ทันทีเมื่อเข้าจากเครื่องอื่น (อาการ: ล็อกอินได้แต่คลิกหน้าไหนก็เด้งกลับ
    // หน้า login) เข้าได้เฉพาะ localhost บนตัวเครื่อง · วันไหนติดตั้ง HTTPS แล้ว
    // ค่อยตั้ง COOKIE_SECURE=1 ใน .env
    secure: process.env.COOKIE_SECURE === "1",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const user = await getCurrentUser();

  if (token) {
    await prisma.session
      .updateMany({ where: { tokenHash: hashToken(token) }, data: { revokedAt: new Date() } })
      .catch(() => undefined);
  }
  jar.delete(SESSION_COOKIE);
  return user;
}

/** ผู้ใช้ที่กำลังเข้าระบบอยู่ — คืน null ถ้ายังไม่ได้เข้าระบบหรือเซสชันหมดอายุ */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session
    .findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } })
    .catch(() => null);

  if (!session || session.revokedAt) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;
  // ถูกระงับหรือถูกถอนสิทธิ์ระหว่างที่ยังเข้าระบบอยู่ ต้องเด้งออกทันที
  if (session.user.status !== "ACTIVE") return null;

  return {
    id: session.user.id,
    username: session.user.username,
    name: session.user.name,
    role: session.user.role,
    status: session.user.status,
  };
}

/** ใช้ในหน้าเว็บที่ต้องเข้าระบบก่อน — ถ้ายังไม่เข้าระบบจะพาไปหน้าล็อกอิน */
export async function requireAuth(returnTo?: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login");
  }
  return user;
}

/** ใช้ในหน้าที่เฉพาะผู้ดูแลเข้าได้ */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireAuth();
  if (!isAdmin(user)) redirect("/?denied=admin");
  return user;
}

/** ใช้ก่อนบันทึกข้อมูล — VIEWER จะถูกปฏิเสธ */
export async function requireWrite(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canWrite(user)) redirect("/?denied=write");
  return user;
}

// ── ประวัติการเข้าระบบ ─────────────────────────────────────


/**
 * บันทึกประวัติ — ห้าม throw เด็ดขาด
 * ถ้าเขียน log ไม่ได้ ต้องไม่ทำให้ผู้ใช้เข้าระบบไม่ได้ไปด้วย
 */
export async function writeLog(params: {
  action: LogAction;
  username: string;
  userId?: string | null;
  success?: boolean;
  reason?: string | null;
}): Promise<void> {
  try {
    const { ip, userAgent } = await requestInfo();
    await prisma.loginLog.create({
      data: {
        action: params.action,
        username: params.username.slice(0, 100),
        userId: params.userId ?? null,
        success: params.success ?? true,
        reason: params.reason ?? null,
        ip,
        userAgent,
      },
    });
  } catch {
    // เขียนประวัติไม่สำเร็จ ไม่ควรทำให้การทำงานหลักล้มเหลว
  }
}

// ── การล็อกบัญชีเมื่อใส่รหัสผิดบ่อย ─────────────────────────


export async function registerFailedLogin(userId: string, current: number): Promise<void> {
  const failed = current + 1;
  await prisma.user.update({
    where: { id: userId },
    data: {
      failedLogins: failed,
      lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000) : null,
    },
  });
}

export async function clearFailedLogins(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
}

export const AUTH_LIMITS = { MAX_FAILED, LOCK_MINUTES, SESSION_DAYS };
