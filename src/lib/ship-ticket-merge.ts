/**
 * รวมผลจาก 2 ตัวอ่าน ของรูปเดียวกัน
 *   – Google (ข้อความล้วน จัดใบจากเวลา) — ship-ticket-parse.ts
 *   – Tesseract บนเครื่อง (รู้ตำแหน่ง อ่านทีละใบตามช่องจริง) — ship-ocr-local.ts
 *
 * ทีละช่อง:
 *   ทั้งคู่อ่านได้และตรงกัน → ใช้
 *   ได้ตัวเดียว (ผ่านการตรวจของตัวมันเองแล้ว เช่น น้ำหนักลบกันลงตัว) → ใช้
 *   ทั้งคู่อ่านได้แต่ไม่ตรงกัน → ว่าง + บอกว่าอ่านได้ 2 แบบ ให้คนดูรูป (ไม่เดาว่าตัวไหนถูก)
 */

import type { LocalTicket } from "./ship-ocr-local";
import { validTicketNo, type TicketFormat } from "./ship-ticket-formats";
import type { ParsedTicket } from "./ship-ticket-parse";

export type MergedTicket = ParsedTicket & { readNote: string | null };

const minute = (d: Date | null | undefined) => (d ? Math.floor(d.getTime() / 60000) : null);
const dayOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const kg = (n: number) => n.toLocaleString("th-TH");

export function mergeReaders(google: ParsedTicket[], local: LocalTicket[], f: TicketFormat): MergedTicket[] {
  const usedG = new Set<number>();
  const pairs: { g: ParsedTicket | null; l: LocalTicket | null }[] = [];

  // จับคู่ใบเดียวกัน: เลขที่ตั๋วตรงกัน หรือ เวลาเข้าตรงกันถึงนาที
  for (const l of local) {
    let gi = l.ticketNo ? google.findIndex((g, i) => !usedG.has(i) && g.ticketNo === l.ticketNo) : -1;
    if (gi < 0 && l.entryAt) gi = google.findIndex((g, i) => !usedG.has(i) && minute(g.entryAt) === minute(l.entryAt));
    if (gi >= 0) usedG.add(gi);
    pairs.push({ g: gi >= 0 ? google[gi] : null, l });
  }
  // เหลือใบที่จับคู่ไม่ได้ฝั่งละใบเดียว → เป็นใบเดียวกันแน่นอน (รูปเดียวกัน จำนวนใบเท่ากัน)
  const loneL = pairs.filter((p) => !p.g);
  const loneG = google.filter((_, i) => !usedG.has(i));
  if (loneL.length === 1 && loneG.length === 1) {
    loneL[0].g = loneG[0];
    usedG.add(google.indexOf(loneG[0]));
  }
  const leftoverBoth = pairs.some((p) => !p.g) && google.some((_, i) => !usedG.has(i));
  google.forEach((g, i) => !usedG.has(i) && pairs.push({ g, l: null }));

  // เลขที่ตั๋วในรูปเดียวกันต้องขึ้นต้นเหมือนกัน (ท่าเดียวกัน ออกเลขเรียงกัน) — เลขที่หลุดรูปแบบ = อ่านพลาด
  // กี่หลักตามแบบตั๋ว · แบบที่ไม่ได้บอกไว้ (samePrefix 0) ไม่ตรวจข้อนี้
  const allNos = pairs.flatMap((p) => [p.g?.ticketNo, p.l?.ticketNo]).filter((n): n is string => validTicketNo(n, f));
  const prefixCount = new Map<string, number>();
  if (f.samePrefix > 0)
    for (const n of allNos) prefixCount.set(n.slice(0, f.samePrefix), (prefixCount.get(n.slice(0, f.samePrefix)) ?? 0) + 1);
  const mainPrefix = [...prefixCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  return pairs.map(({ g, l }) => {
    const notes: string[] = [];
    // จับคู่ไม่ได้ทั้งสองฝั่ง — ใบนี้อาจเป็นใบเดียวกับอีกแถวในรูปเดียวกัน กันยืนยันซ้ำเป็นงานซ้ำ
    if (leftoverBoth && (!g || !l)) notes.push("⚠️ ใบนี้อาจซ้ำกับอีกแถวของรูปเดียวกัน — เทียบเลขที่ตั๋วกับรูปก่อนยืนยัน");

    // เลขที่ตั๋ว
    let ticketNo: string | null = null;
    const gNo = validTicketNo(g?.ticketNo, f) ? g!.ticketNo : null;
    const lNo = l?.ticketNo ?? null;
    if (gNo && lNo && gNo !== lNo) notes.push(`⚠️ เลขที่ตั๋วอ่านได้ 2 แบบ: ${gNo} / ${lNo} — ดูรูปแล้วกรอกเอง`);
    else ticketNo = gNo ?? lNo;
    if (ticketNo && mainPrefix && allNos.length > 1 && !ticketNo.startsWith(mainPrefix)) {
      notes.push(`⚠️ เลขที่ตั๋ว ${ticketNo} ไม่เข้าชุดกับใบอื่นในรูป — ดูรูปแล้วกรอกเอง`);
      ticketNo = null;
    }

    // วันที่ (วันที่รถเข้าชั่ง)
    const gDay = g?.date ?? null;
    const lDay = l?.entryAt ? dayOf(l.entryAt) : null;
    let date: Date | null = null;
    if (gDay && lDay && gDay.getTime() !== lDay.getTime()) notes.push("⚠️ วันที่อ่านได้ 2 แบบ — ดูรูปแล้วกรอกเอง");
    else date = gDay ?? lDay;

    // น้ำหนัก (แต่ละตัวอ่านผ่านสูตร ออก − เข้า = สุทธิ ของตัวเองมาแล้ว)
    const gW = g && g.weightNet != null && g.weightIn != null && g.weightOut != null ? g : null;
    const lW = l && l.weightNet != null && l.weightIn != null && l.weightOut != null ? l : null;
    let w: { in: number; out: number; net: number } | null = null;
    if (gW && lW && gW.weightNet !== lW.weightNet) {
      notes.push(`⚠️ น้ำหนักอ่านได้ 2 แบบ: ${kg(gW.weightNet!)} / ${kg(lW.weightNet!)} กก. — ดูรูปแล้วกรอกเอง`);
    } else {
      const src = gW ?? lW;
      if (src) w = { in: src.weightIn!, out: src.weightOut!, net: src.weightNet! };
    }

    return {
      text: [g?.text, l ? `— ตัวอ่านที่สอง —\n${l.text}` : null].filter(Boolean).join("\n"),
      ticketNo,
      date,
      entryAt: g?.entryAt ?? l?.entryAt ?? null,
      weightIn: w?.in ?? null,
      weightOut: w?.out ?? null,
      weightNet: w?.net ?? null,
      plate: g?.plate ?? l?.plate ?? null,
      driverName: g?.driverName ?? l?.driverName ?? null,
      readNote: notes.length ? notes.join(" · ") : null,
    };
  });
}
