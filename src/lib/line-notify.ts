/**
 * ส่งข้อความเข้าไลน์ถึง "ผู้ดูแล" ผ่านบอทจ่ายงาน-เทียมเทพ
 *
 * ใช้กับเรื่องที่ถ้าไม่มีใครรู้แล้วจะเสียหาย — เช่น สำรองข้อมูลไม่สำเร็จ
 * ส่งเฉพาะ userId ที่ระบุใน LINE_ADMIN_USER_IDS เท่านั้น ไม่ส่งหาคนขับ
 *
 * ต้องตั้งใน .env (ค่าเดียวกับที่ตั้งไว้ใน Script Properties ของไลน์บอท):
 *   LINE_CHANNEL_ACCESS_TOKEN — token จาก LINE Developers Console
 *   LINE_ADMIN_USER_IDS       — userId ของผู้ดูแล คั่นด้วยจุลภาค
 *
 * ไม่ได้ตั้งค่า = ข้ามไปเฉยๆ ไม่ทำให้งานหลักพัง (เช่น สำรองข้อมูลยังต้องทำงานต่อ)
 */

const PUSH_API = "https://api.line.me/v2/bot/message/push";

export type NotifyResult = { sent: number; skipped?: string; errors: string[] };

export function lineAdminConfig(): { token: string; admins: string[] } | { error: string } {
  const token = (process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "").trim();
  const admins = (process.env.LINE_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!token) return { error: "ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN ใน .env" };
  if (admins.length === 0) return { error: "ยังไม่ได้ตั้ง LINE_ADMIN_USER_IDS ใน .env" };
  return { token, admins };
}

/** ส่งข้อความถึงผู้ดูแลทุกคน — ส่งคนหนึ่งไม่ผ่าน ก็ยังส่งคนที่เหลือต่อ */
export async function notifyAdmins(text: string): Promise<NotifyResult> {
  const cfg = lineAdminConfig();
  if ("error" in cfg) return { sent: 0, skipped: cfg.error, errors: [] };

  const errors: string[] = [];
  let sent = 0;
  for (const to of cfg.admins) {
    try {
      const res = await fetch(PUSH_API, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
        // ไลน์จำกัดข้อความละ 5,000 ตัวอักษร — ตัดให้สั้นกว่านั้นไว้ก่อน
        body: JSON.stringify({ to, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
      });
      if (res.ok) sent++;
      else errors.push(`${to.slice(0, 8)}… → ${res.status} ${(await res.text()).slice(0, 120)}`);
    } catch (e) {
      errors.push(`${to.slice(0, 8)}… → ${e instanceof Error ? e.message : "ส่งไม่สำเร็จ"}`);
    }
  }
  return { sent, errors };
}
