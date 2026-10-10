/**
 * แบบตั๋ว — ส่วนที่ "ต่างกัน" ของตั๋วแต่ละแบบ เก็บเป็นค่าตั้งที่นี่ที่เดียว
 *
 * ตัวอ่านกลาง (ship-ticket-parse.ts / ship-ocr-local.ts) ใช้หลักที่จริงกับใบชั่งทุกแบบ:
 *   – รถคันเดียวในรูปเดียว เรียงเวลาแล้วเป็น เข้า-ออก สลับกัน
 *   – น้ำหนัก ออก − เข้า = สุทธิ ต้องลงตัว
 *   – ป้าย นน.เข้า / นน.ออก / นน.สุทธิ · วันที่ dd/mm/yyyy hh:mm
 * ส่วนที่ขึ้นกับว่าออกจากท่าไหน (เลขที่กี่หลัก อยู่ตรงไหนบนใบ) ห้ามฝังในตัวอ่านกลาง — ใส่เป็นแบบใหม่ที่นี่
 *
 * เพิ่มแบบใหม่: เพิ่มก้อนใน FORMATS แล้วเลือกที่หน้า ตั้งค่า › ตั๋วเรือ
 * (ปรับแบบเดิมแล้วต้องเพิ่ม PARSER_VERSION ใน ship-ticket.ts — รูปที่ยังรอตรวจทั้งรูปจะถูกอ่านใหม่เอง)
 */

export type TicketFormat = {
  key: string;
  /** ชื่อที่ให้เลือกในหน้าตั้งค่า */
  label: string;
  /** จำนวนหลักของเลขที่ตั๋ว (ต่ำสุด, สูงสุด) */
  noDigits: [number, number];
  /** ใบในรูปเดียวกันต้องขึ้นต้นเหมือนกันกี่หลัก (ท่าออกเลขเรียงกัน) — 0 = ไม่ตรวจ */
  samePrefix: number;
  /**
   * บรรทัดที่อยู่ "ใต้" เลขที่ตั๋วบนใบจริง — ใช้รับเลขที่ที่ OCR อ่านคำว่า "เลขที่" เพี้ยน
   * (ต้องขึ้นต้นเหมือนเลขที่ใบอื่นในรูปด้วย) · null = ไม่รับเลขที่ไม่มีคำนำหน้าเลย
   */
  noLineBelow: RegExp | null;
  /** ใบเดียวในรูป: ถ้าไม่เจอคำว่า "เลขที่" ใช้ตัวเลขที่ยาวพอดีจำนวนหลักได้ไหม (ต้องเป็นแบบที่หลักตายตัว) */
  bareNoSingle: boolean;
  /**
   * ตัวอ่านที่สอง (Tesseract) แบ่งรูปเป็นช่องตามตั๋ว โดยใช้เลขที่ตั๋วเป็นจุดยึด (อยู่มุมบนของทุกใบ)
   * ต้องเป็นตัวเลขล้วนที่ไม่ซ้ำกับค่าอื่นบนใบ · false = ใช้ตัวอ่านเดียว (Google)
   */
  localAnchor: boolean;
};

/** ลำดับนี้ = ลำดับในหน้าตั้งค่า (แบบทั่วไปอยู่บนสุด — เพิ่มโฟลเดอร์เองแล้วค่าเริ่มต้นไม่ไปเดาว่าเป็นแบบไหน) */
export const FORMATS: Record<string, TicketFormat> = {
  /** แบบทั่วไป — ใช้กับตั๋วแบบใหม่ที่ยังไม่มีค่าตั้งของตัวเอง: รับเฉพาะเลขที่ที่มีคำว่า "เลขที่" นำหน้า */
  generic: {
    key: "generic",
    label: "แบบทั่วไป (ต้องมีคำว่า «เลขที่» นำหน้า)",
    noDigits: [6, 12],
    samePrefix: 0,
    noLineBelow: null,
    bareNoSingle: false,
    localAnchor: false,
  },
  /** ใบชั่งน้ำหนัก บริษัท ศรีราชา ฮาร์เบอร์ — เลขที่ 10 หลัก บรรทัดถัดไปเป็น "Shipment" (ตรวจกับรูปจริง 226 รูป) */
  srh: {
    key: "srh",
    label: "ใบชั่งศรีราชาฮาร์เบอร์ (เลขที่ 10 หลัก)",
    noDigits: [10, 10],
    samePrefix: 6,
    noLineBelow: /^[ \t|_.-]*Sh/i,
    bareNoSingle: true,
    localAnchor: true,
  },
};

export const DEFAULT_FORMAT = "generic";

export function formatOf(key: string | null | undefined): TicketFormat {
  return FORMATS[key ?? ""] ?? FORMATS[DEFAULT_FORMAT];
}

/** เลขที่ตั๋วรูปแบบถูกตามแบบนี้ไหม */
export function validTicketNo(no: string | null | undefined, f: TicketFormat): no is string {
  if (!no || !/^\d+$/.test(no)) return false;
  return no.length >= f.noDigits[0] && no.length <= f.noDigits[1];
}
