/**
 * ชนิดข้อมูลและป้ายชื่อเกี่ยวกับสิทธิ์ผู้ใช้
 *
 * แยกออกมาจาก auth.ts เพราะไฟล์นี้ต้องใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และฝั่งเบราว์เซอร์
 * (auth.ts เรียก next/headers และ prisma ซึ่ง client component ใช้ไม่ได้)
 */

export type SessionUser = {
  id: string;
  username: string;
  name: string;
  role: string;
  status: string;
};

export type Role = "ADMIN" | "STAFF" | "VIEWER";

export const ROLE_LABEL: Record<string, string> = {
  ADMIN: "ผู้ดูแลระบบ",
  STAFF: "พนักงาน",
  VIEWER: "ดูอย่างเดียว",
};

export const STATUS_LABEL: Record<string, string> = {
  PENDING: "รออนุมัติ",
  ACTIVE: "ใช้งานได้",
  SUSPENDED: "ถูกระงับ",
};

export type LogAction =
  | "LOGIN"
  | "LOGOUT"
  | "REGISTER"
  | "APPROVE"
  | "REJECT"
  | "SUSPEND"
  | "REACTIVATE"
  | "ROLE_CHANGE"
  | "PASSWORD_CHANGE";

export const ACTION_LABEL: Record<string, string> = {
  LOGIN: "เข้าระบบ",
  LOGOUT: "ออกจากระบบ",
  REGISTER: "สมัครใช้งาน",
  APPROVE: "อนุมัติผู้ใช้",
  REJECT: "ปฏิเสธคำขอ",
  SUSPEND: "ระงับการใช้งาน",
  REACTIVATE: "เปิดใช้งานอีกครั้ง",
  ROLE_CHANGE: "เปลี่ยนสิทธิ์",
  PASSWORD_CHANGE: "เปลี่ยนรหัสผ่าน",
};

/** VIEWER ดูได้อย่างเดียว ห้ามบันทึกหรือแก้ไขอะไร */
export function canWrite(user: SessionUser | null): boolean {
  return user?.role === "ADMIN" || user?.role === "STAFF";
}

export function isAdmin(user: SessionUser | null): boolean {
  return user?.role === "ADMIN";
}

/** เวลาที่บัญชียังถูกล็อกอยู่ (นาที) — 0 คือไม่ได้ถูกล็อก */
export function lockRemainingMinutes(lockedUntil: Date | null): number {
  if (!lockedUntil) return 0;
  const ms = lockedUntil.getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 60000) : 0;
}
