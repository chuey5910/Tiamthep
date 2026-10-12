/**
 * แบบตั๋ว — ส่วนที่ "ต่างกัน" ของตั๋วแต่ละแบบ เก็บเป็นค่าตั้งที่นี่ที่เดียว
 *
 * ตัวอ่านกลาง (ship-ticket-parse.ts / ship-ocr-local.ts) ใช้หลักที่จริงกับใบชั่งทุกแบบ:
 *   – น้ำหนัก 3 ตัว (เข้า · ออก · สุทธิ) ต้องลบกันลงตัว
 *   – วันที่ dd/mm/yyyy หรือ dd-mm-yyyy ตามด้วยเวลา
 *   – วางตั๋ว 2 แบบ: "trips" ตั๋วหลายใบอ่านสลับซ้าย-ขวา จัดใบจากเวลา (รถคันเดียว เข้า-ออก สลับกัน)
 *                     "blocks" ตั๋วเรียงบนลงล่าง ข้อความออกมาทีละใบ ตัดท่อนที่คำท้ายใบ
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
  /** วิธีแยกตั๋วในรูป — ดูหัวไฟล์ */
  layout: "trips" | "blocks";
  /** เลขที่ตั๋วที่ไม่ใช่ตัวเลขล้วน (เช่น R + 9 หลัก): find = หาในข้อความ (global) · valid = ตรวจทั้งค่า — ใช้แทน noDigits */
  noPattern?: { find: RegExp; valid: RegExp };
  /** blocks: คำที่อยู่ท้ายตั๋วทุกใบ — ตัดท่อนตรงนี้ */
  blockEnd?: RegExp;
  /** ป้ายของค่าที่ไม่ใช่ของตั๋วใบนี้ (เช่น น้ำหนัก/วันที่ของท่าเรือในหมายเหตุ) — ตัวเลข/วันที่ที่ตามหลังป้ายนี้ไม่หยิบ */
  skipLabels?: RegExp;
  /** สูตรน้ำหนัก: "outMinusIn" รถเปล่าเข้า บรรทุกออก · "inMinusOut" บรรทุกเข้า ลงของแล้วออก */
  netRule: "outMinusIn" | "inMinusOut";
  /** ทะเบียนมาจากไหน: ชื่อโฟลเดอร์ย่อย หรือ ทะเบียนที่พิมพ์ในตั๋ว (โฟลเดอร์ย่อยเป็นอย่างอื่น เช่น วันที่ + ชื่อเรือ) */
  plateFrom: "folder" | "ticket";
  /** ตั๋วมีชื่อคนขับไหม (ไม่มี = พขร. จากตารางจับคู่รถอย่างเดียว) */
  hasDriverName: boolean;
  /** ข้อความที่ต้องมีในตั๋วแบบนี้ (หัวบริษัท) — ไม่เจอ = ⚠️ อาจเป็นตั๋วผิดโฟลเดอร์ */
  mustContain?: { re: RegExp; label: string };
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
    layout: "trips",
    netRule: "outMinusIn",
    plateFrom: "folder",
    hasDriverName: true,
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
    layout: "trips",
    netRule: "outMinusIn",
    plateFrom: "folder",
    hasDriverName: true,
  },
  /**
   * ตั๋วชั่งน้ำหนักและรายละเอียดวัตถุดิบ บริษัท จี เจ สตีล (บ่อวิน) — ตั๋วปลายทาง ภาษาอังกฤษ 1–2 ใบต่อรูป
   * Ticket Number = R + 9 หลัก (MO No เป็น R + 7 หลัก ไม่ใช่) · Truck No = ทะเบียน · Gate In = วันที่
   * Weight In − Weight Out = Net · ช่องหมายเหตุมีน้ำหนัก/เวลาของท่าเรือ (Port In/Out) — ไม่ใช่ของใบนี้ ห้ามหยิบ
   * ตรวจกับรูปจริงในโฟลเดอร์ «ท่าเรือศรีราชาฮาร์เบอร์ - จี เจ สตีล บ่อวิน»
   */
  gjs: {
    key: "gjs",
    label: "ตั๋วชั่ง จี เจ สตีล (เลขที่ R + 9 หลัก · ทะเบียนจากตั๋ว)",
    noDigits: [10, 10],
    samePrefix: 0,
    noLineBelow: null,
    bareNoSingle: false,
    localAnchor: false,
    layout: "blocks",
    noPattern: { find: /(?<![A-Za-z0-9])(R\d{9})(?!\d)/g, valid: /^R\d{9}$/ },
    blockEnd: /SUPPLIER/g,
    skipLabels: /Port\s*(?:In|Out)\s*(?:Date|Weight)\s*[:：.]?\s*$/i,
    netRule: "inMinusOut",
    plateFrom: "ticket",
    hasDriverName: false,
    mustContain: { re: /G\s*J\s*Steel/i, label: "G J Steel" },
  },
};

export const DEFAULT_FORMAT = "generic";

export function formatOf(key: string | null | undefined): TicketFormat {
  return FORMATS[key ?? ""] ?? FORMATS[DEFAULT_FORMAT];
}

/** เลขที่ตั๋วรูปแบบถูกตามแบบนี้ไหม */
export function validTicketNo(no: string | null | undefined, f: TicketFormat): no is string {
  if (!no) return false;
  if (f.noPattern) return f.noPattern.valid.test(no);
  if (!/^\d+$/.test(no)) return false;
  return no.length >= f.noDigits[0] && no.length <= f.noDigits[1];
}
