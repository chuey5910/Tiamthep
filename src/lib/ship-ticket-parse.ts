/**
 * อ่านค่าจากข้อความ OCR ของ "ตั๋วเรือ" (ใบชั่งน้ำหนัก) — ตัวอ่านกลาง ใช้ได้กับตั๋วทุกแบบ
 * ส่วนที่ต่างกันของแต่ละแบบ (เลขที่กี่หลัก อยู่ตรงไหน) มาจากค่าตั้งใน ship-ticket-formats.ts ห้ามฝังที่นี่
 *
 * 1 รูปมีตั๋วได้หลายใบ (ถ่ายรวม 4 ใบ) → แยกเป็นทีละใบก่อน แล้วอ่าน:
 *   เลขที่ตั๋ว · วันที่ (วัน-เวลาเข้า) · นน.เข้า / นน.ออก / นน.สุทธิ · ทะเบียนในตั๋ว · ชื่อ พขร.
 *
 * หลัก "ไม่เดา": อ่านไม่ได้/ไม่ชัด = null ให้คนกรอก
 * น้ำหนักต้องผ่านสูตร นน.ออก − นน.เข้า = นน.สุทธิ ถึงจะนับว่าอ่านถูก (ตรวจที่ ship-ticket.ts)
 * ไฟล์นี้ไม่แตะฐานข้อมูล — ทดสอบได้ด้วยข้อความล้วน
 */

import { validTicketNo, type TicketFormat } from "./ship-ticket-formats";

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
  /** วัน-เวลาเข้าเต็ม (ถ้ารู้) — ไว้จับคู่กับผลของตัวอ่านที่สอง */
  entryAt?: Date | null;
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
/** "เลขที่ …" — เก็บกว้างไว้ก่อน แล้วค่อยตรวจจำนวนหลักตามแบบตั๋ว (validTicketNo) */
const TICKET_NO = /เลข\s*ที[่]?\s*[:：.]?\s*(\d{6,12})(?!\d)/g;

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

export function parseTicket(segment: string, f: TicketFormat): ParsedTicket {
  const t = normalizeOcr(segment);

  // เลขที่: มีคำว่า "เลขที่" นำหน้า · ไม่เจอ และแบบนี้เลขที่ยาวตายตัว → ตัวเลขที่ยาวพอดี (ใบเดียวในท่อนนี้)
  const [lo, hi] = f.noDigits;
  const noM =
    [...t.matchAll(TICKET_NO)].find((m) => validTicketNo(m[1], f)) ??
    (f.bareNoSingle ? t.match(new RegExp(`(?<![\\d\\-])(\\d{${lo},${hi}})(?![\\d\\-])`)) : null);
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

/** ทั้งรูป → รายการตั๋วทีละใบ (ตามแบบตั๋วของโฟลเดอร์เส้นทาง) */
export function parseTicketPhoto(text: string, f: TicketFormat): ParsedTicket[] {
  const t = normalizeOcr(text);
  const whole = analyse(t, f);
  // จัดเที่ยวจากเวลาได้ → ใช้วิธีอ่านทั้งรูป (ทนต่อการอ่านสลับซ้าย-ขวา)
  if (whole?.entries) return whole.tickets;
  // ตั๋วเรียงแนวตั้ง (ไม่สลับ) → ตัดทีละใบตาม "เลขที่" ได้ตรงๆ
  // แต่ถ้าข้อความสลับซ้าย-ขวา (เลขที่สองใบติดกันโดยไม่มีวัน-เวลาคั่น) ตัดท่อนแล้วน้ำหนักจะตกผิดใบ
  // → ใช้ผลอ่านทั้งรูปที่น้ำหนักว่าง (ให้คนกรอก) แทน ไม่เดา
  if (whole && interleaved(t)) return whole.tickets;
  return splitTickets(text).map((seg) => parseTicket(seg, f));
}

/** ตั๋วซ้าย-ขวาถูกอ่านสลับกันไหม — มี "เลขที่" สองตัวติดกันโดยไม่มีวัน-เวลาคั่นกลาง */
function interleaved(t: string): boolean {
  const nos = [...t.matchAll(TICKET_NO)].map((m) => m.index!);
  const dts = [...t.matchAll(DATETIME)].map((m) => m.index!);
  return nos.some((a, i) => i > 0 && !dts.some((d) => d > nos[i - 1] && d < a));
}

// ─────────────────────────────────────────────────────────────
// อ่านทั้งรูปทีเดียว — สำหรับรูปที่ถ่ายตั๋วหลายใบเรียงซ้าย-ขวา
//
// ปัญหาจริง (รูปจาก CamScanner ตั๋ว 4 ใบ 2×2): OCR อ่านตั๋วซ้ายกับขวาสลับบรรทัดกัน เช่น
//   เลขที่ A … เลขที่ B … นน.เข้า(A) … นน.เข้า(B) … นน.สุทธิ(A) … นน.สุทธิ(B)
// ตัดเป็นท่อนๆ ตาม "เลขที่" แล้วน้ำหนักจะไปตกอยู่ผิดใบ
//
// วิธีนี้: เก็บทุกค่าทั้งรูปเรียงตามลำดับที่เจอ (เลขที่ · เวลาเข้า · ชุดน้ำหนัก) แล้วจับคู่ตามลำดับ
// แต่จะยอมใช้ก็ต่อเมื่อ "ตรวจแล้วลงตัว" เท่านั้น:
//   – จำนวนเลขที่ = จำนวนเวลาเข้า = จำนวนชุดน้ำหนัก
//   – เลขที่ตั๋วเรียงตามเวลาเข้าจริง (ตั๋วออกเลขเรียงตามเวลาชั่ง)
//   – เวลาออกของชุดน้ำหนักต้องหลังเวลาเข้าของใบนั้น และไม่เกิน 6 ชั่วโมง
// ไม่ลงตัว = น้ำหนักว่าง ❌ ให้คนกรอก (ไม่เดา)
// ─────────────────────────────────────────────────────────────

type At<T> = { v: T; at: number };

const DATETIME = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/g;

function toDateTime(m: RegExpMatchArray): Date | null {
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if (y > 2400) y -= 543;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2020 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d, Number(m[4]), Number(m[5]), Number(m[6] ?? 0)));
  return dt.getUTCDate() === d ? dt : null;
}

const dayOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** ค่าน้ำหนักที่อยู่ถัดจากป้าย (บรรทัดเดียวกันหรือบรรทัดถัดไป) — ไม่หยิบเลขที่เป็นส่วนของวันที่/เวลา */
function labeledAll(t: string, label: RegExp): (At<number> & { vat: number })[] {
  const out: (At<number> & { vat: number })[] = [];
  for (const m of t.matchAll(label)) {
    const from = m.index! + m[0].length;
    const v = t.slice(from, from + 30).match(/^([^\d]{0,15}?)(?<![\d\/.,:])(\d{1,3}(?:[,.]\d{3})+|\d{4,6})(?![\d\/:])/);
    if (!v) continue;
    const n = kg(v[2]);
    if (plausible(n)) out.push({ v: n, at: m.index!, vat: from + v[1].length });
  }
  return out;
}

// ป้ายที่ OCR อ่านเพี้ยนบ่อย: นน.เข้า → นน.เขา / นน.เช้า · นน.ออก → นบ.ออก
const LBL_IN = /(?:นน|นบ|บน|น\.น)\s*\.?\s*เ[ขชบ]\s*้?\s*า/g;
const LBL_OUT = /(?:นน|นบ|บน|น\.น)\s*\.?\s*ออ/g;
const LBL_NET = /(?:นน|นบ|บน|น\.น)\s*\.?\s*สุ/g;
const LBL_ENTRY = /เวลา\s*เ[ขชบ]\s*้?\s*า/g;

/** at/outAt/inAt = ตำแหน่งในข้อความ (ไว้ดูว่าอยู่ใกล้เวลาของใบไหน) · pos = ตำแหน่งตัวเลขจริง 3 ตัว (กันหยิบซ้ำ) */
type Triple = { in: number; out: number; net: number; at: number; outAt: number; inAt?: number; pos: number[] };

/** จับชุด เข้า/ออก/สุทธิ ที่ลบกันลงตัว — ทีละ "สุทธิ" ตามลำดับ เลือกคู่ เข้า/ออก ที่อยู่ใกล้ที่สุด */
function triplesOf(t: string): Triple[] {
  const ins = labeledAll(t, LBL_IN);
  const outs = labeledAll(t, LBL_OUT);
  const nets = labeledAll(t, LBL_NET);
  const usedIn = new Set<number>();
  const usedOut = new Set<number>();
  const found: Triple[] = [];
  for (const n of nets) {
    let best: { i: number; o: number; d: number } | null = null;
    outs.forEach((o, oi) => {
      if (usedOut.has(oi)) return;
      ins.forEach((x, ii) => {
        if (usedIn.has(ii) || o.v - x.v !== n.v) return;
        const d = Math.abs(n.at - o.at) + Math.abs(n.at - x.at);
        if (!best || d < best.d) best = { i: ii, o: oi, d };
      });
    });
    if (!best) continue;
    const b = best as { i: number; o: number; d: number };
    usedIn.add(b.i);
    usedOut.add(b.o);
    found.push({ in: ins[b.i].v, out: outs[b.o].v, net: n.v, at: n.at, outAt: outs[b.o].at, inAt: ins[b.i].at, pos: [ins[b.i].vat, outs[b.o].vat, n.vat] });
  }
  return found.sort((a, b) => a.at - b.at);
}

/**
 * ชุดน้ำหนักแบบไม่พึ่งป้าย — OCR ชอบแยกป้ายออกจากตัวเลข (เช่น "นน.สุทธิ / นน.ออก 37,790 กก 26,190 กก")
 * เก็บทุกตัวเลขที่หน้าตาเป็นน้ำหนัก (มีจุลภาคหลักพัน) แล้วหา 3 ตัวที่ ออก − เข้า = สุทธิ พอดี
 * ช่วงค่าตามรถจริง: เข้า (รถเปล่า) 5–20 ตัน · ออก 15–60 ตัน · สุทธิ 5–50 ตัน
 * ตัวเลข 1 ตัวใช้ได้ชุดเดียว · เลือกชุดที่ตัวเลขอยู่ใกล้กันที่สุดก่อน
 */
function looseTriples(t: string, taken: Set<number>): Triple[] {
  const nums: At<number>[] = [];
  for (const m of t.matchAll(/(?<![\d\/.,:\-])(\d{1,2}[,.]\d{3})(?![\d\/:,.])/g)) {
    if (taken.has(m.index!)) continue;
    nums.push({ v: kg(m[1]), at: m.index! });
  }
  const cands: { i: number; o: number; n: number; spread: number }[] = [];
  nums.forEach((x, i) => {
    if (x.v < 5000 || x.v > 20000) return;
    nums.forEach((o, oi) => {
      if (o.v < 15000 || o.v > 60000) return;
      const net = o.v - x.v;
      if (net < 5000 || net > 50000) return;
      nums.forEach((nn, ni) => {
        if (nn.v !== net || ni === i || ni === oi) return;
        const ps = [x.at, o.at, nn.at];
        cands.push({ i, o: oi, n: ni, spread: Math.max(...ps) - Math.min(...ps) });
      });
    });
  });
  cands.sort((a, b) => a.spread - b.spread);
  const used = new Set<number>();
  const out: Triple[] = [];
  for (const c of cands) {
    if (used.has(c.i) || used.has(c.o) || used.has(c.n)) continue;
    used.add(c.i).add(c.o).add(c.n);
    out.push({ in: nums[c.i].v, out: nums[c.o].v, net: nums[c.n].v, at: nums[c.n].at, outAt: nums[c.o].at, inAt: nums[c.i].at, pos: [nums[c.i].at, nums[c.o].at, nums[c.n].at] });
  }
  return out;
}

/** ค่ากลางของการอ่านทั้งรูป — ใช้ดูว่าทำไมใบไหนอ่านไม่ผ่าน (ไว้ปรับตัวอ่านจากรูปจริง) */
export function inspectPhoto(text: string, f: TicketFormat) {
  return analyse(normalizeOcr(text), f);
}

function analyse(t: string, f: TicketFormat) {
  // เลขที่ตั๋ว (ไม่ซ้ำ) ตามลำดับที่เจอในข้อความ
  const nosText: At<string>[] = [];
  for (const m of t.matchAll(TICKET_NO)) if (validTicketNo(m[1], f) && !nosText.some((x) => x.v === m[1])) nosText.push({ v: m[1], at: m.index! });
  // เลขที่ที่คำว่า "เลขที่" ถูก OCR อ่านเพี้ยน ("เกมที่" "เลย" "เกษ" …) — ใช้เฉพาะแบบที่บอกตำแหน่งเลขที่บนใบไว้
  // คุมแคบ 2 ชั้น ไม่ให้ไปหยิบเลขตรงอื่น:
  //   1. ขึ้นต้นเหมือนเลขที่ใบอื่นในรูป (จำนวนหลักตามแบบตั๋ว)
  //   2. บรรทัดถัดไปตรงกับบรรทัดใต้เลขที่ของแบบนั้น (ศรีราชาฮาร์เบอร์ = "Shipment" · ตรวจรูปจริง 226 รูป: 20 ตัว ถูกทั้งหมด)
  if (f.noLineBelow && f.samePrefix > 0) {
    const [lo, hi] = f.noDigits;
    const prefixes = new Set(nosText.map((x) => x.v.slice(0, f.samePrefix)));
    for (const m of t.matchAll(new RegExp(`(?<![\\d\\-\\/.,])(\\d{${lo},${hi}})[ \\t]*\\n([^\\n]*)`, "g")))
      if (f.noLineBelow.test(m[2]) && prefixes.has(m[1].slice(0, f.samePrefix)) && !nosText.some((x) => x.v === m[1]))
        nosText.push({ v: m[1], at: m.index! });
  }
  nosText.sort((a, b) => a.at - b.at);

  // วัน-เวลาทั้งหมดในรูป (ไม่ซ้ำ)
  const allDt: At<Date>[] = [];
  for (const m of t.matchAll(DATETIME)) {
    const d = toDateTime(m);
    if (d && !allDt.some((x) => x.v.getTime() === d.getTime())) allDt.push({ v: d, at: m.index! });
  }
  const sortedDt = [...allDt].sort((a, b) => a.v.getTime() - b.v.getTime());

  // รถคันเดียววิ่งทีละเที่ยว → เรียงเวลาแล้วต้องเป็น เข้า ออก เข้า ออก …
  // จำนวนใบ = จำนวนเที่ยว (ไม่ใช่จำนวนเลขที่ที่อ่านได้ — เลขที่อ่านไม่ออกบางใบ ใบนั้นต้องไม่หาย)
  // รถรอข้ามคืนในท่ามีจริง (เข้า 16:37 ออก 10:25 วันรุ่งขึ้น) จึงเผื่อเที่ยวละไม่เกิน 48 ชม.
  let n = nosText.length;
  let entries: Date[] | null = null;
  let exits: Date[] | null = null;
  const half = sortedDt.length / 2;
  if (Number.isInteger(half) && half >= Math.max(2, nosText.length)) {
    const en = sortedDt.filter((_, i) => i % 2 === 0).map((x) => x.v);
    const ex = sortedDt.filter((_, i) => i % 2 === 1).map((x) => x.v);
    if (en.every((e, k) => ex[k].getTime() - e.getTime() <= 48 * 3600 * 1000)) {
      n = half;
      entries = en;
      exits = ex;
    }
  }
  if (n < 2) return null; // ใบเดียว ใช้วิธีเดิม
  if (!entries) {
    // ไม่ครบ 2 เวลาต่อใบ → ใช้ป้าย "เวลาเข้า" (ต้องได้ครบทุกใบ)
    const exitLabels = [...t.matchAll(/เวลา\s*ออ/g)].map((m) => m.index!);
    const found: At<Date>[] = [];
    for (const m of t.matchAll(LBL_ENTRY)) {
      const e = allDt.find(
        (d) => d.at > m.index! && d.at - m.index! < 160 && !found.some((x) => x.at === d.at) && !exitLabels.some((x) => x > m.index! && x < d.at),
      );
      if (e) found.push(e);
    }
    if (found.length === n) entries = found.map((x) => x.v).sort((a, b) => a.getTime() - b.getTime());
  }

  // เวลาเข้าแต่ละเที่ยว ตามลำดับที่เจอในข้อความ (ซ้ายก่อนขวา แถวบนก่อนแถวล่าง) → เที่ยวที่เท่าไร
  const entryPos = entries
    ? allDt
        .filter((d) => entries!.some((e) => e.getTime() === d.v.getTime()))
        .sort((a, b) => a.at - b.at)
        .map((d) => entries!.findIndex((e) => e.getTime() === d.v.getTime()))
    : [];

  // เลขที่ตั๋ว → เที่ยว
  //   ครบทุกใบ: เรียงเลขน้อย→มาก = เรียงเวลา (ท่าเรือออกเลขเรียงกัน และรูปเดียวคือรถคันเดียว)
  //   ไม่ครบ: จับตามลำดับที่เจอในข้อความ แล้วต้องยังเรียงตามเวลาจริง · ไม่ลงตัว = ว่างทุกใบ ให้คนกรอก (ไม่เดา)
  const nos: (string | null)[] = Array(n).fill(null);
  if (nosText.length === n) {
    [...nosText.map((x) => x.v)].sort().forEach((v, k) => (nos[k] = v));
  } else if (entries && entryPos.length === n && nosText.length < n) {
    // ลองทุกวิธีจับคู่ที่เป็นไปได้ แล้วใช้ก็ต่อเมื่อมี "ทางเดียว" ที่ผ่านทั้งสองข้อ:
    //   – เลขน้อย→มาก ต้องตรงกับเที่ยวเร็ว→ช้า (รถคันเดียว ท่าเรือออกเลขเรียงกัน)
    //   – เวลาเข้าของใบนั้นต้องเป็น 1 ใน 2 เวลาเข้าแรกที่อยู่ "หลัง" เลขที่ในข้อความ
    //     (เลขที่อยู่บนสุดของตั๋ว · แถวหนึ่งมีตั๋วไม่เกิน 2 ใบ ซ้าย-ขวา)
    const entryAtOf = allDt.filter((d) => entries!.some((e) => e.getTime() === d.v.getTime()));
    const tripAt = (trip: number) => entryAtOf.find((d) => d.v.getTime() === entries![trip].getTime())!.at;
    const sortedNos = [...nosText].sort((a, b) => Number(a.v) - Number(b.v));
    const allowed = (no: At<string>, trip: number) => {
      const after = entryAtOf.filter((d) => d.at > no.at).sort((a, b) => a.at - b.at).slice(0, 2);
      return after.some((d) => d.at === tripAt(trip));
    };
    const found: number[][] = [];
    const pick = (i: number, from: number, acc: number[]) => {
      if (found.length > 1) return;
      if (i === sortedNos.length) return void found.push([...acc]);
      for (let trip = from; trip < n; trip++) if (allowed(sortedNos[i], trip)) pick(i + 1, trip + 1, [...acc, trip]);
    };
    pick(0, 0, []);
    if (found.length === 1) found[0].forEach((trip, i) => (nos[trip] = sortedNos[i].v));
  }

  // ชุดน้ำหนัก: แบบมีป้ายก่อน แล้วเติมด้วยแบบไม่พึ่งป้าย (ตัวเลขที่ใช้แล้วไม่หยิบซ้ำ)
  const labeledT = triplesOf(t);
  const taken = new Set<number>();
  // ตัวเลขที่ชุดมีป้ายใช้ไปแล้ว — แบบไม่พึ่งป้ายห้ามหยิบซ้ำ (กันเฉพาะตัวเลขนั้นจริงๆ ไม่กันทั้งช่วง)
  for (const tr of labeledT) for (const p of tr.pos) taken.add(p);
  const triples = [...labeledT, ...looseTriples(t, taken)].filter(
    (tr, i, all) => all.findIndex((x) => x.in === tr.in && x.out === tr.out && x.net === tr.net) === i,
  );

  // ชุดน้ำหนักเป็นของเที่ยวไหน
  const tripOf = (d: Date): number => {
    if (!entries) return -1;
    const x = d.getTime();
    if (exits) {
      const i = entries.findIndex((e) => e.getTime() === x);
      return i >= 0 ? i : exits.findIndex((e) => e.getTime() === x);
    }
    return entries.findIndex((e, i) => x >= e.getTime() && (i + 1 >= n || x < entries![i + 1].getTime()));
  };
  // หลักฐานชัด: วัน-เวลาอยู่ "บรรทัดเดียวกัน" กับตัวเลขของชุดนั้น (เช่น "นน.เข้า 11,580 05/10/2026 00:04:38 นน.ออก 28,940")
  const lineStarts = [0, ...[...t.matchAll(/\n/g)].map((m) => m.index! + 1)];
  const lineOf = (pos: number) => {
    let lo = 0;
    while (lo + 1 < lineStarts.length && lineStarts[lo + 1] <= pos) lo++;
    return lo;
  };
  // ใช้แค่ตำแหน่ง นน.ออก กับ นน.สุทธิ — นน.เข้า (รถเปล่า) มักเท่ากันทุกใบ ตัวไหนก็ลบลงตัว จึงไม่ใช่หลักฐาน
  const sameLineTrip = (tr: Triple): number => {
    const lines = new Set(tr.pos.slice(1).map(lineOf));
    const trips = new Set(allDt.filter((d) => lines.has(lineOf(d.at))).map((d) => tripOf(d.v)).filter((k) => k >= 0));
    return trips.size === 1 ? [...trips][0] : -1;
  };
  const same = (a: Triple, b: Triple) => a.in === b.in && a.out === b.out && a.net === b.net;

  let weightOf: (Triple | null)[] = Array(n).fill(null);
  let conflicts = 0;
  if (entries) {
    // วิธีหลัก — ลำดับที่ OCR อ่าน: ตั๋วซ้าย-ขวาถูกอ่านสลับกันแบบเดิมทุกบรรทัด (ซ้ายก่อนขวา แถวบนก่อนแถวล่าง)
    // เวลาเข้าที่ k ที่เจอในข้อความ ↔ ชุดน้ำหนักที่ k (เรียงตามตำแหน่ง "สุทธิ") — ใช้ได้เมื่อจำนวนครบพอดี
    // แล้วตรวจกับหลักฐานบรรทัดเดียวกัน ขัดกันแม้ใบเดียว = ไม่ใช้วิธีนี้ทั้งรูป
    let rankOk = entryPos.length === n && new Set(entryPos).size === n && triples.length === n;
    if (rankOk) {
      const byPos = [...triples].sort((a, b) => a.at - b.at);
      const rank: Triple[] = Array(n);
      entryPos.forEach((trip, k) => (rank[trip] = byPos[k]));
      for (let k = 0; k < n && rankOk; k++) {
        const st = sameLineTrip(rank[k]);
        if (st >= 0 && st !== k) rankOk = false;
      }
      if (rankOk) weightOf = rank;
      else conflicts++;
    }
    if (!rankOk) {
      // วิธีสำรอง — ใช้เฉพาะชุดที่มีหลักฐานบรรทัดเดียวกัน และไม่มีชุดอื่นแย่งใบเดียวกัน
      const claims = triples.map(sameLineTrip);
      triples.forEach((tr, i) => {
        const k = claims[i];
        if (k >= 0 && claims.filter((c) => c === k).length === 1) weightOf[k] = tr;
      });
      // เหลือใบเดียวที่ยังไม่มีน้ำหนัก และเหลือชุดน้ำหนักชุดเดียว → เป็นของใบนั้นแน่นอน
      const empty = weightOf.map((w, i) => (w ? -1 : i)).filter((i) => i >= 0);
      const left = triples.filter((tr) => !weightOf.some((w) => w && same(w, tr)));
      if (empty.length === 1 && left.length === 1 && triples.length === n) weightOf[empty[0]] = left[0];
    }
  }

  // วันที่: ได้เวลาเข้าครบ ใช้ตามลำดับ · ไม่งั้นถ้าทุกเวลาในรูปเป็นวันเดียวกัน ใช้วันนั้น
  const days = new Set(allDt.map((d) => dayOf(d.v).getTime()));
  const oneDay = days.size === 1 ? dayOf(allDt[0].v) : null;

  // ชื่อ พขร. / ทะเบียน — รถคันเดียวกันทั้งรูป ถ้าทุกใบเหมือนกันใช้ได้ทุกใบ
  const names = [...t.matchAll(/(นางสาว|นาย|นาง|น\.ส\.)\s*([ก-๏]+)\s+([ก-๏]+)/g)].map((m) => `${m[1]}${m[2]} ${m[3]}`);
  // ชื่อที่เจอบ่อยสุด (OCR อ่านชื่อเดียวกันเพี้ยนได้บางใบ) — เป็นแค่ค่าเสนอ หน้าตรวจเทียบกับตารางจับคู่รถอีกชั้น
  const nameCount = new Map<string, { name: string; c: number }>();
  for (const nm of names) {
    const k = nameKey(nm);
    nameCount.set(k, { name: nameCount.get(k)?.name ?? nm, c: (nameCount.get(k)?.c ?? 0) + 1 });
  }
  const topName = [...nameCount.values()].sort((a, b) => b.c - a.c)[0];
  const oneName = topName && topName.c * 2 > names.length ? topName.name : null;
  const plates = [...t.matchAll(/ทะเบียน\s*รถ\s*[:：]?\s*(\d{1,3})\s*-\s*(\d{3,4})/g)].map((m) => `${m[1]}-${m[2]}`);
  const onePlate = plates.length > 0 && new Set(plates).size === 1 ? plates[0] : null;

  const tickets: ParsedTicket[] = nos.map((no, k) => ({
    text: t.trim(),
    ticketNo: no,
    date: entries ? dayOf(entries[k]) : oneDay,
    entryAt: entries ? entries[k] : null,
    weightIn: weightOf[k]?.in ?? null,
    weightOut: weightOf[k]?.out ?? null,
    weightNet: weightOf[k]?.net ?? null,
    plate: onePlate,
    driverName: oneName,
  }));
  return { tickets, nos, entries, exits, triples, allDt: sortedDt.map((d) => d.v), placed: weightOf.filter(Boolean).length, conflicts };
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
