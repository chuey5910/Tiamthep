/**
 * อ่านค่าจากข้อความ OCR ของ "ตั๋วเรือ" (ใบชั่งน้ำหนัก บริษัท ศรีราชา ฮาร์เบอร์)
 *
 * 1 รูปมีตั๋วได้หลายใบ (ถ่ายรวม 4 ใบ) → แยกเป็นทีละใบก่อน แล้วอ่าน:
 *   เลขที่ตั๋ว · วันที่ (วัน-เวลาเข้า) · นน.เข้า / นน.ออก / นน.สุทธิ · ทะเบียนในตั๋ว · ชื่อ พขร.
 *
 * หลัก "ไม่เดา": อ่านไม่ได้/ไม่ชัด = null ให้คนกรอก
 * น้ำหนักต้องผ่านสูตร นน.ออก − นน.เข้า = นน.สุทธิ ถึงจะนับว่าอ่านถูก (ตรวจที่ ship-ticket.ts)
 * ไฟล์นี้ไม่แตะฐานข้อมูล — ทดสอบได้ด้วยข้อความล้วน
 */

export type ParsedTicket = {
  /** ข้อความของใบนี้ (หลังแยกใบแล้ว) */
  text: string;
  ticketNo: string | null;
  date: Date | null;
  /** กิโลกรัม */
  weightIn: number | null;
  weightOut: number | null;
  weightNet: number | null;
  /** ทะเบียนที่พิมพ์ในตั๋ว เช่น "70-1853" (ไว้เทียบกับชื่อโฟลเดอร์) */
  plate: string | null;
  /** ชื่อ พขร. ที่พิมพ์ท้ายตั๋ว เช่น "นายเมือง ศรีสะพุง" */
  driverName: string | null;
};

/** ปรับข้อความ OCR ให้เทียบง่าย: สระ ำ ที่แยกร่าง · เลขไทย · จุลภาคเต็มความกว้าง · อักขระล่องหน */
export function normalizeOcr(text: string): string {
  return text
    .replace(/ํา/g, "ำ") // ํ + า → ำ
    .replace(/นํ้า/g, "น้ำ") // นํ้า → น้ำ
    .replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50))
    .replace(/[，،]/g, ",")
    .replace(/[​‌‍﻿]/g, "")
    .replace(/\r/g, "");
}

const HEADER = /ใบ\s*ชั่ง\s*น\s*้?\s*[ำา]?\s*หนัก/g;
const TICKET_NO = /เลข\s*ที่\s*[:：.]?\s*(\d{8,12})(?!\d)/g;

/** แยกข้อความทั้งรูปเป็นทีละใบ — ใช้หัว "ใบชั่งน้ำหนัก" หรือ "เลขที่ …" เป็นจุดตัด (อันไหนเจอมากกว่า) */
export function splitTickets(text: string): string[] {
  const t = normalizeOcr(text);
  const heads = [...t.matchAll(HEADER)].map((m) => m.index!);
  const nos = [...t.matchAll(TICKET_NO)].map((m) => m.index!);
  const cuts = heads.length >= nos.length ? heads : nos;
  if (cuts.length < 2) return t.trim() ? [t] : [];
  const parts: string[] = [];
  for (let i = 0; i < cuts.length; i++) {
    parts.push(t.slice(cuts[i], i + 1 < cuts.length ? cuts[i + 1] : undefined));
  }
  return parts.filter((p) => p.trim());
}

/** น้ำหนัก (กก.) — 11,450 / 11.450 (OCR อ่านจุลภาคเป็นจุด) / 11450 */
const KG = "(\\d{1,3}(?:[,.]\\d{3})+|\\d{4,6})(?![\\d/:])";
const kg = (s: string) => Number(s.replace(/[,.]/g, ""));
const plausible = (n: number) => n >= 500 && n <= 90000;

function labeled(t: string, label: string): number | null {
  const m = t.match(new RegExp(`${label}[^\\d\\n]{0,15}${KG}`));
  if (!m) return null;
  const n = kg(m[1]);
  return plausible(n) ? n : null;
}

/**
 * ตาข่ายสำรอง: OCR บางทีแยกหัวข้อกับตัวเลขออกจากกัน (ป้ายอยู่ชุดหนึ่ง ตัวเลขอยู่อีกชุด)
 * → เก็บตัวเลขที่หน้าตาเป็นน้ำหนักทั้งหมด แล้วหา 3 ตัวที่ "ออก − เข้า = สุทธิ" พอดี
 * ลำดับในตั๋วคือ เข้า → ออก → สุทธิ เสมอ จึงบังคับลำดับตำแหน่งในข้อความด้วย
 * (ไม่งั้น 21,320 / 33,330 / 12,010 ก็ "ลบกันลงตัว" ได้อีกชุด)
 * ต้องเจอชุดเดียวเท่านั้น — เจอหลายชุด = ไม่รู้ว่าชุดไหนจริง → ไม่เดา
 */
function weightTriple(t: string): { in: number; out: number; net: number } | null {
  const cleaned = t
    .replace(/\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}/g, " ") // วันที่
    .replace(/\d{1,2}:\d{2}(:\d{2})?/g, " ") // เวลา
    .replace(/\d{1,3}\s*-\s*\d{3,4}/g, " ") // ทะเบียนรถ / เบอร์โทร
    .replace(/\d{7,}/g, " "); // เลขที่ตั๋ว / เลขผู้เสียภาษี
  // ตัวเลขพร้อมตำแหน่งที่เจอครั้งแรก
  const pos = new Map<number, number>();
  for (const m of cleaned.matchAll(new RegExp(KG, "g"))) {
    const n = kg(m[1]);
    if (plausible(n) && !pos.has(n)) pos.set(n, m.index!);
  }
  const found: { in: number; out: number; net: number }[] = [];
  for (const [a, pa] of pos)
    for (const [b, pb] of pos) {
      if (b <= a) continue;
      const net = b - a;
      const pn = pos.get(net);
      if (pn == null || net === a) continue;
      // ลำดับในตั๋ว: เข้า (a หรือ b ตัวที่มาก่อน) … สุทธิ มาท้ายสุด
      if (pn > pa && pn > pb) found.push(pa < pb ? { in: a, out: b, net } : { in: b, out: a, net });
    }
  return found.length === 1 ? found[0] : null;
}

function parseDate(t: string): Date | null {
  // วัน-เวลาเข้า ก่อน (วันที่รถเข้าชั่ง) — ไม่เจอค่อยใช้วันที่แรกในใบ
  const after = t.search(/เวลา\s*เข้า/);
  const re = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})(?!\d)/;
  const m = (after >= 0 ? t.slice(after).match(re) : null) ?? t.match(re);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  if (y > 2400) y -= 543; // ปี พ.ศ.
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2020 || y > 2100) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCDate() === d ? date : null;
}

export function parseTicket(segment: string): ParsedTicket {
  const t = normalizeOcr(segment);

  const noM = t.match(/เลข\s*ที่\s*[:：.]?\s*(\d{8,12})(?!\d)/) ?? t.match(/(?<![\d\-])(\d{10})(?![\d\-])/);
  const plateM = t.match(/ทะเบียน\s*รถ\s*[:：]?\s*(\d{1,3})\s*-\s*(\d{3,4})/);
  const drvM = t.match(/(นางสาว|นาย|นาง|น\.ส\.)\s*([ก-๏]+)\s+([ก-๏]+)/);

  let weightIn = labeled(t, "(?:นน|น\\.น)\\.?\\s*เข");
  let weightOut = labeled(t, "(?:นน|น\\.น)\\.?\\s*ออ");
  let weightNet = labeled(t, "(?:นน|น\\.น)\\.?\\s*สุ");
  const ok = weightIn != null && weightOut != null && weightNet != null && Math.abs(weightOut - weightIn) === weightNet;
  if (!ok) {
    const tri = weightTriple(t);
    if (tri) {
      weightIn = tri.in;
      weightOut = tri.out;
      weightNet = tri.net;
    }
  }

  return {
    text: t.trim(),
    ticketNo: noM ? noM[1] : null,
    date: parseDate(t),
    weightIn,
    weightOut,
    weightNet,
    plate: plateM ? `${plateM[1]}-${plateM[2]}` : null,
    driverName: drvM ? `${drvM[1]}${drvM[2]} ${drvM[3]}` : null,
  };
}

/** ทั้งรูป → รายการตั๋วทีละใบ */
export function parseTicketPhoto(text: string): ParsedTicket[] {
  return splitTickets(text).map(parseTicket);
}

/** น้ำหนักผ่านสูตร ออก − เข้า = สุทธิ ไหม (ไม่ผ่าน = ถือว่าอ่านไม่ชัด) */
export function weightVerified(p: { weightIn: number | null; weightOut: number | null; weightNet: number | null }): boolean {
  return p.weightIn != null && p.weightOut != null && p.weightNet != null && Math.abs(p.weightOut - p.weightIn) === p.weightNet;
}

/** ชื่อคนสำหรับเทียบ — ตัดคำนำหน้า ช่องว่าง และแก้สระ ำ */
export function nameKey(name: string): string {
  return normalizeOcr(name)
    .replace(/^(นางสาว|นาย|นาง|น\.ส\.|คุณ)\s*/, "")
    .replace(/\s+/g, "")
    .trim();
}

/** ทะเบียนสำหรับเทียบ — เอาแค่ตัวเลขกับขีด (ตัดชื่อจังหวัดท้ายทะเบียน เช่น "ลบ") */
export function plateKey(plate: string): string {
  const m = plate.match(/(\d{1,3})\s*-\s*(\d{3,4})/);
  return m ? `${m[1]}-${m[2]}` : plate.replace(/\s+/g, "");
}
