/**
 * นำเข้างานจาก «ชีตสั่งงานไลน์» เข้าฐานข้อมูลเว็บ
 *
 * ขั้นตอนความปลอดภัยของข้อมูล (ห้ามลัดขั้น)
 *  1. นำเข้าแถวที่พนักงานตรวจแล้วและตั้งสถานะ «ยืนยัน» (และลองแถว «นำเข้าไม่ผ่าน» ซ้ำให้ทุกครั้ง)
 *     ข้อมูลจาก OCR ที่ยังไม่ผ่านตาคน (สถานะ «ได้ตั๋วแล้ว») จะไม่ถูกแตะ
 *  2. ทุกแถวถูกตรวจกับฐานข้อมูลก่อน: ทะเบียนรถ รหัสลูกค้า รหัสคนขับ ต้องมีจริง
 *     ไม่ผ่านข้อไหนจะเขียนเหตุผลกลับลงชีต (สถานะ «นำเข้าไม่ผ่าน») ให้แก้แล้วยืนยันใหม่
 *  3. กันซ้ำสองชั้น: สถานะในชีต + รหัสงาน (sheetRef) เป็น unique ในฐานข้อมูล
 *     ต่อให้เขียนผลกลับลงชีตไม่สำเร็จ รอบถัดไปก็ไม่เกิดงานซ้ำ
 *
 * นอกจากนำเข้างานแล้ว ยังส่งข้อมูลหลักจากเว็บ (รถ/ลูกค้า/สถานที่/คนขับ)
 * ไปเติม dropdown ในชีตทุกครั้ง — ชีตกับเว็บจึงใช้รายการเดียวกันเสมอ
 */

import { prisma } from "./prisma";
import { parseDate, toInputDate } from "./date";
import { buildContext, computeJob, routeKey } from "./calc";
import { NO_TRAILER, driverCodeOrNull, trailerOrNull } from "./vehicle-type";
import { batchWriteValues, clearValues, readValues, sheetConfig, writeValues } from "./google-sheets";

// ── โครงชีต — ต้องตรงกับ line-bot/Code.gs (แก้ที่หนึ่งต้องแก้อีกที่หนึ่ง) ──
const JOBS_TAB = "งาน";
const DRIVERS_TAB = "คนขับ";
const MASTER_TAB = "ฐานข้อมูล";
const JOBS_LAST_COL = "V"; // คอลัมน์สุดท้ายของแท็บงาน

// ตำแหน่งคอลัมน์ในแถวข้อมูล (index เริ่ม 0 = คอลัมน์ A)
// ตั๋วมี 2 ใบต่อ 1 งาน: ต้นทาง (ตอนรับของ) และปลายทาง (ตอนลงของ)
const C = {
  id: 0, date: 1, driver: 2, head: 4, trailer: 5, customer: 6,
  origin: 7, dest: 8, cargo: 9, note: 10, status: 11,
  ticketNoOrigin: 13, wOrigin: 14, ticketNoDest: 16, wDest: 17,
  toll: 19, advance: 20,
} as const;
const STATUS_COL = "L"; // = index 11
const RESULT_COL = "V"; // = index 21

const ST = {
  CONFIRMED: "ยืนยัน",
  IMPORTED: "ปิดงาน", // ดึงเข้าเว็บสำเร็จ = งานจบสมบูรณ์ ชีตจะล็อกแถวนี้ไม่ให้แก้
  FAILED: "นำเข้าไม่ผ่าน",
  CANCELLED: "ยกเลิก", // แถวที่คนตัดสินว่าไม่นับเป็นงาน (เช่น วางซ้ำ) — ข้อมูลยังอยู่ แค่ไม่ถูกดึง
} as const;

export type SheetImportResult = {
  ok: boolean;
  error?: string;
  imported: number;
  failed: number;
  pendingReview: number; // แถวที่ «ส่งของเสร็จสิ้น» แล้ว แต่ออฟฟิศยังไม่กด «ยืนยัน»
  /** งานที่ปิดไปแล้ว แต่ดึงเงินเดินทาง/ค่าทางด่วนจากชีตมาเพิ่ม/อัปเดตให้ */
  advancesSynced: number;
  /** แถวที่ปิดงานแล้วและอัปเดตข้อความ «ผลนำเข้าเว็บ» ให้ตรงกับสถานะปัจจุบัน (เช่น คำเตือนเก่าหายไป) */
  refreshed: number;
  /** รหัสงานที่ซ้ำกันในชีตและระบบตัดสินให้ไม่ได้ว่าแถวไหนคือขาจริง — ต้องให้คนดู */
  duplicates: DuplicateJobId[];
  /** แถวที่ระบบตั้งรหัสงานใหม่ให้เอง เพราะเป็นคนละขากับแถวที่เก็บรหัสเดิม */
  renumbered: RenumberedRow[];
  rows: { jobId: string; ok: boolean; message: string }[];
};

/** รหัสงานหนึ่งที่มีหลายแถวในชีต */
export type DuplicateJobId = {
  jobId: string;
  /** เลขแถวจริงในชีต (แถว 1 เป็นหัวตาราง) */
  rows: number[];
  /** มีงานรหัสนี้ในเว็บกี่ขา — ได้มากสุด 1 เพราะรหัสงานเป็น unique */
  inWeb: number;
  /** ขาที่หายไป = จำนวนแถวในชีต − ขาที่เข้าเว็บ */
  missing: number;
  /** ทำไมระบบแก้ให้เองไม่ได้ (เติมเฉพาะรหัสที่ยังค้าง) */
  reason?: string;
  /** รายละเอียดแต่ละแถว ให้คนตัดสินบนหน้าเว็บได้โดยไม่ต้องเปิดชีต */
  detail?: DupRowDetail[];
};

export type DupRowDetail = {
  rowNo: number;
  status: string;
  /** สรุปสั้นๆ: คนขับ · ทะเบียน · เส้นทาง · น้ำหนัก · ตั๋ว */
  summary: string;
  /** แถวนี้คือขาที่อยู่ในเว็บ (ข้อมูลตรงทุกช่อง) */
  inWeb: boolean;
};

export type RenumberedRow = {
  row: number;
  from: string;
  to: string;
  /** แถวที่เก็บรหัสเดิมไว้ (ขาที่อยู่ในเว็บจริง หรือแถวแรก) */
  keeperRow: number;
  /** ตั้งสถานะเป็น «ยืนยัน» ให้ด้วย = ดึงเข้าเว็บในรอบนี้เลย */
  confirmed: boolean;
};

/**
 * ข้อความเตือนรหัสงานซ้ำที่ระบบแก้ให้เองไม่ได้ — บอกให้ครบว่า ซ้ำกี่แถว แถวไหน ทำไมแก้ไม่ได้ และต้องทำยังไง
 * ต้องดักตั้งแต่ก่อนนำเข้า ไม่งั้นแถวที่เกินจะชนกุญแจ unique แล้วถูกกลืนไปเงียบๆ
 */
function duplicateMessage(d: DuplicateJobId, alreadyClosed: boolean): string {
  const where = `แถว ${d.rows.join(", ")}`;
  const head = `รหัสงาน ${d.jobId} ซ้ำ ${d.rows.length} แถว (${where})`;
  const state = `เว็บรับได้รหัสละ 1 ขา — เข้าเว็บแล้ว ${d.inWeb} ขา ขาดอีก ${d.missing} ขา`;
  return `${alreadyClosed ? "⚠️" : "❌"} ${head} · ${state} · ${d.reason ?? "ตั้งรหัสงานใหม่ที่ไม่ซ้ำให้แถวที่เกิน แล้วตั้งสถานะเป็น «ยืนยัน»"}`;
}

/** ข้อมูลของขาหนึ่งเท่าที่ใช้เทียบว่า "แถวนี้กับงานในเว็บเป็นขาเดียวกันไหม" */
export type LegKey = {
  loadDate: Date;
  headPlate: string;
  origin: string;
  destination: string;
  weightOrigin: number | null;
  weightDest: number | null;
};

/** อ่านขาจากแถวในชีต — null ถ้าวันที่อ่านไม่ได้ (เทียบอะไรไม่ได้) */
export function legOfRow(row: string[]): LegKey | null {
  const loadDate = parseDate(row[C.date] ?? "");
  if (!loadDate) return null;
  return {
    loadDate,
    headPlate: (row[C.head] ?? "").trim(),
    origin: (row[C.origin] ?? "").trim(),
    destination: (row[C.dest] ?? "").trim(),
    weightOrigin: numOrNull(row[C.wOrigin] ?? ""),
    weightDest: numOrNull(row[C.wDest] ?? ""),
  };
}

/**
 * รหัสงานใหม่ที่ไม่ซ้ำ — ใช้คำนำหน้าเดิมของรหัสที่ซ้ำ (เช่น TT690908-) แล้วต่อเลขถัดจาก
 * เลขสูงสุดที่มีอยู่ในชีต ตรงกับที่ line-bot/Code.gs ตั้งให้ตอนวางแถวใหม่ (nextJobId_)
 * ไม่คำนวณจากวันที่ เพราะชีตเก็บปี พ.ศ. เป็นปี ค.ศ. บ้าง (2569) การยึดคำนำหน้าเดิมจึงไม่มีทางผิด
 */
export function nextFreeJobId(jobId: string, used: Set<string>): string {
  const cut = jobId.lastIndexOf("-");
  const prefix = cut >= 0 ? jobId.slice(0, cut + 1) : `${jobId}-`;
  let max = 0;
  for (const id of used) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  const next = String(max + 1);
  return prefix + (next.length < 2 ? `0${next}` : next);
}

/** สถานะที่แปลว่า "ออฟฟิศตรวจแล้ว" — ตั้งรหัสใหม่แล้วดึงเข้าเว็บต่อได้เลย */
const REVIEWED_STATUSES: ReadonlySet<string> = new Set([ST.CONFIRMED, ST.IMPORTED, ST.FAILED]);

export type DupRow = { rowNo: number; status: string; leg: LegKey | null; cells: string[] };

/** คอลัมน์ที่ "ระบบ" เป็นคนเขียน ไม่ใช่ข้อมูลงาน — ไม่นับตอนเทียบว่าสองแถวเหมือนกันทุกช่อง */
const SYSTEM_COLS: ReadonlySet<number> = new Set([C.status, 12 /* เวลาแจ้ง */, 15 /* รูปตั๋วต้นทาง */, 18 /* รูปตั๋วปลายทาง */, 21 /* ผลนำเข้า */]);

/**
 * สองแถวมีข้อมูลงานเหมือนกันทุกช่อง (ไม่นับรหัสงานและช่องของระบบ)
 * ⚠ เหมือนกันทุกช่อง "ไม่ได้แปลว่าวางซ้ำ" — รถวิ่งเที่ยวเดิมซ้ำ น้ำหนักเท่ากันเป๊ะก็มีจริง
 *   ใช้แค่บอกคนว่า "เหมือนกันหมดนะ" ห้ามให้ระบบตัดสินเองว่าเป็นงานซ้ำ
 */
export function identicalRows(a: string[], b: string[]): boolean {
  for (let i = 1; i <= 20; i++) {
    if (SYSTEM_COLS.has(i)) continue;
    if ((a[i] ?? "").trim() !== (b[i] ?? "").trim()) return false;
  }
  return true;
}

/** วันที่ + ทะเบียน + ต้นทาง + ปลายทาง ตรงกัน = "เที่ยวเดียวกัน" ในสายตาคน (น้ำหนักอาจถูกแก้ทีหลัง) */
function sameTrip(a: LegKey, b: LegKey): boolean {
  return (
    a.loadDate.getTime() === b.loadDate.getTime() &&
    a.headPlate.trim() === b.headPlate.trim() &&
    a.origin.trim() === b.origin.trim() &&
    a.destination.trim() === b.destination.trim()
  );
}

/** สรุปแถวให้คนอ่านแล้วตัดสินได้ โดยไม่ต้องเปิดชีต */
export function summarizeRow(cells: string[]): string {
  const v = (i: number) => (cells[i] ?? "").trim();
  const w = [v(C.wOrigin), v(C.wDest)].filter(Boolean).join(" / ");
  const t = [v(C.ticketNoOrigin), v(C.ticketNoDest)].filter(Boolean).join(" / ");
  return [
    v(C.date),
    v(C.driver) || "ไม่มีคนขับ",
    [v(C.head), v(C.trailer)].filter(Boolean).join("+"),
    `${v(C.origin)} → ${v(C.dest)}`,
    w ? `${w} ตัน` : "ไม่มีน้ำหนัก",
    t ? `ตั๋ว ${t}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export type DupPlan = {
  renames: RenumberedRow[];
  keeperConfirm: boolean;
  keeperRow: number | null;
  reason?: string;
};

/**
 * ตัดสินว่ารหัสงานที่ซ้ำกัน แถวไหนเก็บรหัสเดิมไว้ และแถวไหนต้องได้รหัสใหม่
 *
 * ทำไมต้องให้ระบบทำ: แถวที่ «ปิดงาน» แล้วชีตล็อกไม่ให้แก้ (line-bot/Code.gs ดีดค่ากลับ)
 * แต่แถวซ้ำที่ถูกปิดงานทั้งที่ยังไม่เข้าเว็บ (ของเก่าเคยกลืนเงียบๆ) จะติดอยู่อย่างนั้น
 * คนแก้ในชีตไม่ได้ ระบบจึงต้องแก้ให้ผ่าน API ซึ่งไม่ติดล็อกของ onEdit
 *
 * ทำเองเฉพาะที่พิสูจน์ได้ ที่เหลือส่งให้คนตัดสินบนหน้าเว็บ (มีปุ่มให้กด ไม่ต้องแก้ชีต):
 *  - แถวที่ วันที่/ทะเบียน/ต้นทาง/ปลายทาง ต่างจากแถวเก็บรหัส → เป็นคนละขาแน่ → รหัสใหม่
 *  - เที่ยวเดียวกัน (วันที่/ทะเบียน/เส้นทางเหมือน) ไม่ว่าน้ำหนักจะเท่าหรือต่าง → ให้คนตัดสิน
 *    เพราะรถวิ่งเที่ยวเดิมซ้ำแล้วน้ำหนักเท่ากันเป๊ะก็มีจริง ระบบแยกจาก "วางซ้ำ" ไม่ได้
 *  - ไม่มีแถวไหนตรงกับงานในเว็บ → ให้คนตัดสิน
 */
export function planDuplicateFixes(jobId: string, rows: DupRow[], webJob: LegKey | null, used: Set<string>): DupPlan {
  const sorted = [...rows].sort((a, b) => a.rowNo - b.rowNo);
  let keeper: DupRow;
  let keeperConfirm = false;
  // keeperRow ส่งกลับไปด้วยแม้ตัดสินไม่ได้ — หน้าเว็บจะได้รู้ว่าแถวไหนคือ "แถวที่เก็บรหัสเดิม" (ไม่ต้องมีปุ่ม)
  // แถวอื่นทุกแถวต้องมีปุ่มให้คนกด ต่อให้ข้อมูลเหมือนแถวในเว็บเป๊ะก็ตาม
  const none = (reason: string, keeperRow: number | null = null): DupPlan => ({ renames: [], keeperConfirm: false, keeperRow, reason });

  if (webJob) {
    const trip = sorted.filter((r) => r.leg && sameTrip(webJob, r.leg));
    if (trip.length === 0) {
      return none("ไม่มีแถวไหนตรงกับงานในเว็บเลย (วันที่/ทะเบียน/เส้นทางต่างหมด — ข้อมูลในเว็บอาจถูกแก้ไปแล้ว) — ให้ตัดสินด้วยปุ่มด้านขวา");
    }
    const exact = trip.filter((r) => differentLeg(webJob, r.leg!) === null);
    // แถวที่ตรงเว็บเป๊ะมีหลายแถว = ข้อมูลเหมือนกันหมด แถวไหนก็ได้เป็นผู้เก็บรหัส (เอาแถวแรก)
    // ที่เหลือจะถูกส่งให้คนตัดสินข้างล่างอยู่แล้ว เพราะเป็นเที่ยวเดียวกัน
    if (exact.length >= 1) keeper = exact[0];
    else {
      return none(
        "เที่ยวเดียวกับงานในเว็บหลายแถว แต่น้ำหนักไม่ตรงกับเว็บสักแถว (น้ำหนักในเว็บถูกแก้แล้ว?) — ให้ตัดสินด้วยปุ่มด้านขวา",
      );
    }
  } else {
    keeper = sorted[0];
    // ปิดงานไว้ทั้งที่ยังไม่มีในเว็บ — ต้องเปิดให้ดึงเข้า ไม่งั้นค้างตลอดไป
    keeperConfirm = keeper.status === ST.IMPORTED;
  }

  const renames: RenumberedRow[] = [];
  const undecided: number[] = [];
  let anyIdentical = false;
  for (const r of sorted) {
    if (r.rowNo === keeper.rowNo) continue;
    // เที่ยวเดียวกัน (วันที่/ทะเบียน/เส้นทางเหมือน) — ระบบไม่เดาว่าวิ่งจริงอีกเที่ยวหรือวางซ้ำ
    // ต่อให้น้ำหนักเท่ากันเป๊ะก็ยังเป็นงานจริงได้ (รถวิ่งเที่ยวเดิมซ้ำ ของเท่าเดิม)
    if (r.leg && keeper.leg && sameTrip(r.leg, keeper.leg)) {
      if (identicalRows(r.cells, keeper.cells)) anyIdentical = true;
      undecided.push(r.rowNo);
      continue;
    }
    const to = nextFreeJobId(jobId, used);
    used.add(to);
    renames.push({ row: r.rowNo, from: jobId, to, keeperRow: keeper.rowNo, confirmed: REVIEWED_STATUSES.has(r.status) });
  }
  if (undecided.length > 0) {
    return none(
      `แถว ${undecided.join(", ")} เป็นเที่ยวเดียวกับแถว ${keeper.rowNo} (วันที่/ทะเบียน/เส้นทางเหมือน${anyIdentical ? " น้ำหนักก็เท่ากัน" : ""}) — อาจเป็นรถวิ่งจริงอีกเที่ยว หรือวางแถวซ้ำ ระบบไม่ตัดสินเอง: วิ่งจริง กด «คนละเที่ยว» · วางซ้ำ กด «กรอกซ้ำ»`,
      keeper.rowNo,
    );
  }
  return { renames, keeperConfirm, keeperRow: keeper.rowNo };
}

/**
 * คนตัดสินบนหน้าเว็บว่าแถวซ้ำแถวหนึ่งเป็นอะไร — เขียนลงชีตผ่าน API (แถวที่ล็อก «ปิดงาน» ก็แก้ได้)
 *   "rename" = คนละเที่ยว → ตั้งรหัสใหม่ แล้วดึงเข้าเว็บต่อ (ถ้าถึงขั้นยืนยันแล้ว)
 *   "cancel" = วางแถวซ้ำ → ตั้งสถานะ «ยกเลิก» ไม่ลบแถว ข้อมูลยังอยู่
 * ไม่แตะงานที่อยู่ในเว็บแล้วเด็ดขาด
 */
export async function resolveDuplicateRow(
  rowNo: number,
  jobId: string,
  action: "rename" | "cancel",
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const cfg = sheetConfig();
  if ("error" in cfg) return { ok: false, error: cfg.error };
  const { sheetId, keyFile } = cfg;
  if (!Number.isInteger(rowNo) || rowNo < 2) return { ok: false, error: "เลขแถวไม่ถูกต้อง" };

  const values = await readValues(keyFile, sheetId, `${JOBS_TAB}!A2:${JOBS_LAST_COL}`);
  const row = values[rowNo - 2];
  const curId = (row?.[C.id] ?? "").trim();
  // ชีตอาจถูกแทรก/ลบแถวหลังจากหน้าเว็บโหลด — ห้ามเขียนทับแถวผิด
  if (curId !== jobId) return { ok: false, error: `แถว ${rowNo} ตอนนี้เป็นรหัส ${curId || "(ว่าง)"} ไม่ใช่ ${jobId} — ชีตถูกแทรก/ลบแถว กดดึงงานใหม่แล้วตัดสินอีกครั้ง` };
  const twins = values.map((v, i) => ((v[C.id] ?? "").trim() === jobId ? i + 2 : 0)).filter((n) => n && n !== rowNo);
  if (twins.length === 0) return { ok: false, error: `รหัส ${jobId} เหลือแถวเดียวแล้ว ไม่มีอะไรต้องตัดสิน — กดดึงงานใหม่` };

  const status = (row[C.status] ?? "").trim();
  const writes: { range: string; values: string[][] }[] = [];
  let message: string;

  if (action === "cancel") {
    message = `🗑 คนตัดสินบนเว็บว่าแถวนี้วางซ้ำกับแถว ${twins.join(", ")} — ตั้งเป็น «${ST.CANCELLED}» ไม่นำเข้า ข้อมูลยังอยู่ครบในแถวนั้น`;
    writes.push(
      { range: `${JOBS_TAB}!${STATUS_COL}${rowNo}`, values: [[ST.CANCELLED]] },
      { range: `${JOBS_TAB}!${RESULT_COL}${rowNo}`, values: [[message]] },
    );
  } else {
    const used = new Set(values.map((v) => (v[C.id] ?? "").trim()).filter(Boolean));
    const to = nextFreeJobId(jobId, used);
    // คนยืนยันแล้วว่าวิ่งจริง — แถวที่เคยถูกตั้งเป็น «ยกเลิก» ก็ต้องกลับมาดึงเข้าได้
    const confirm = REVIEWED_STATUSES.has(status) || status === ST.CANCELLED;
    message = `🔢 รหัสเดิม ${jobId} ซ้ำกับแถว ${twins.join(", ")} — คนตัดสินบนเว็บว่าเป็นคนละเที่ยว ตั้งรหัสใหม่เป็น ${to}${confirm ? "" : ` · จะดึงเข้าเว็บเมื่อสถานะเป็น «${ST.CONFIRMED}»`}`;
    writes.push({ range: `${JOBS_TAB}!A${rowNo}`, values: [[to]] }, { range: `${JOBS_TAB}!${RESULT_COL}${rowNo}`, values: [[message]] });
    if (confirm) writes.push({ range: `${JOBS_TAB}!${STATUS_COL}${rowNo}`, values: [[ST.CONFIRMED]] });
  }
  await batchWriteValues(keyFile, sheetId, writes);
  return { ok: true, message };
}

/**
 * ดึงเงินเดินทาง (คอลัมน์ U) และค่าทางด่วน (คอลัมน์ T) จากชีตลงเว็บ
 *
 * แยกออกมาเป็นฟังก์ชันของตัวเอง เพราะต้องใช้กับแถวที่ปิดงานไปแล้วด้วย —
 * งานที่ดึงเข้าเว็บก่อนจะมีสองคอลัมน์นี้ จะไม่มีใครไปดึงเงินให้เลยถ้าไม่ทำตรงนี้
 * และออฟฟิศมักกรอกเงินตามหลังจากปิดงานไปแล้ว
 *
 * upsert ตามรหัสงาน — ดึงซ้ำไม่เกิดรายการซ้ำ แก้ยอดในชีตแล้วดึงใหม่ ยอดในเว็บตามให้
 */
async function syncTravelAdvance(row: string[]): Promise<boolean> {
  const jobId = (row[C.id] ?? "").trim();
  if (!jobId) return false;

  const toll = numOrNull(row[C.toll] ?? "") ?? 0;
  const advance = numOrNull(row[C.advance] ?? "") ?? 0;
  // ไม่มีเงินทั้งสองช่อง = ไม่ต้องสร้างรายการเปล่า และไม่ลบของเดิมทิ้ง
  if (toll <= 0 && advance <= 0) return false;

  const date = parseDate(row[C.date] ?? "");
  if (!date) return false;

  const plate = (row[C.head] ?? "").trim();
  const driverCode = driverCodeOrNull(row[C.driver]) ?? "";

  await prisma.travelAdvance.upsert({
    where: { sheetRef: jobId },
    update: { advance, toll, date, plate, driverCode },
    create: {
      sheetRef: jobId,
      date,
      plate,
      driverCode,
      advance,
      toll,
      note: `จากชีตสั่งงาน ${jobId}`,
    },
  });
  return true;
}

/**
 * ข้อความ «ผลนำเข้าเว็บ» ของแถวที่นำเข้าสำเร็จ — ใช้สูตรเดียวกันทั้งตอนนำเข้าครั้งแรกและตอนรีเฟรช
 *
 * รูปแบบตายตัวทุกแถว อ่านจากซ้ายไปขวาได้เลย:
 *   ✅ เว็บ #224                              จบแล้ว ไม่มีอะไรต้องทำ
 *   ✅ เว็บ #224 · มีเงินเดินทาง/ทางด่วน        จบแล้ว และมีเงินเดินทางผูกไว้ด้วย
 *   ⚠️ เว็บ #224 · ต้องแก้: ...                 เข้าเว็บแล้ว แต่ยังมีเรื่องค้าง
 * ตัวแรกบอกสถานะเสมอ จึงกวาดตาดูทั้งคอลัมน์ได้โดยไม่ต้องอ่านทั้งประโยค
 *
 * ข้อความนิ่ง: ถ้าสถานะในเว็บไม่เปลี่ยน ก็ไม่ต้องเขียนทับชีตซ้ำทุกครั้งที่กดดึงงาน
 */
function okMessage(webId: number | string, hasAdvance: boolean, problems: string[]): string {
  const parts = [`เว็บ #${webId}`];
  if (hasAdvance) parts.push("มีเงินเดินทาง/ทางด่วน");
  if (problems.length) parts.push(`ต้องแก้: ${problems.join(" · ")}`);
  return `${problems.length ? "⚠️" : "✅"} ${parts.join(" · ")}`;
}

/**
 * ปัญหาที่ยังค้างของงานหนึ่ง เขียนสั้นๆ พอให้ออฟฟิศรู้ว่าต้องไปแก้ตรงไหน
 * ใช้ข้อความจากเครื่องคำนวณกลาง จึงตรงกับที่เห็นในหน้าบันทึกงานขนส่งเสมอ
 */
function openIssues(calc: { routeFound: boolean; issues: string[] }): string[] {
  if (!calc.routeFound) return ["ยังจับคู่เส้นทางไม่ได้ — ไปเลือกในหน้า บันทึกงานขนส่ง"];
  return calc.issues.slice(0, 2);
}

/**
 * เลขที่ตั๋วชั่งน้ำหนักของแถวนั้น — ต้นทาง (คอลัมน์ N) และปลายทาง (คอลัมน์ Q)
 * ลูกค้าใช้เลขนี้อ้างอิงตอนตรวจใบวางบิล จึงต้องมีช่องของตัวเอง
 */
function ticketsOf(row: string[]): { ticketOrigin: string | null; ticketDest: string | null } {
  return {
    ticketOrigin: (row[C.ticketNoOrigin] ?? "").trim() || null,
    ticketDest: (row[C.ticketNoDest] ?? "").trim() || null,
  };
}

/** ตัวเลขจากชีต — "" คืน null, อ่านไม่ได้ก็คืน null (ให้คนตรวจ ไม่เดา) */
function numOrNull(s: string): number | null {
  const t = s.replace(/,/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * ดึงงานสถานะ «ยืนยัน» จากชีตเข้าฐานข้อมูล + อัปเดตข้อมูลหลักในชีต
 * เรียกซ้ำได้เสมอ ไม่เกิดข้อมูลซ้ำ
 */
export async function runSheetImport(): Promise<SheetImportResult> {
  const cfg = sheetConfig();
  if ("error" in cfg) {
    return { ok: false, error: cfg.error, imported: 0, failed: 0, pendingReview: 0, advancesSynced: 0, refreshed: 0, duplicates: [], renumbered: [], rows: [] };
  }
  const { sheetId, keyFile } = cfg;

  try {
    const values = await readValues(keyFile, sheetId, `${JOBS_TAB}!A2:${JOBS_LAST_COL}`);
    const ctx = await buildContext();
    const drivers = await prisma.driver.findMany();
    const driverByCode = new Map(drivers.map((d) => [d.code.toUpperCase(), d]));
    const customerByCode = new Map(ctx.customers.map((c) => [c.code.trim().toUpperCase(), c]));

    // ── ตรวจรหัสงานซ้ำ "ก่อน" นำเข้า ──
    // รหัสงานเป็นกุญแจ unique ในเว็บ ถ้าชีตมีหลายแถวใช้รหัสเดียวกัน แถวแรกเข้าได้
    // ที่เหลือจะชนกุญแจแล้วถูกกลืนไปเงียบๆ กลายเป็นขาที่หายไปจากใบวางบิลโดยไม่มีใครรู้
    // แถวที่คนตั้งเป็น «ยกเลิก» แล้ว ไม่นับเป็นงาน — ต้องไม่ถูกจับว่า "รหัสซ้ำ" อีก
    // ไม่งั้นรอบถัดไประบบจะเขียนทับสถานะเป็น «นำเข้าไม่ผ่าน» แล้วถามคนซ้ำไม่รู้จบ
    const rowsById = new Map<string, number[]>();
    for (let i = 0; i < values.length; i++) {
      const id = (values[i][C.id] ?? "").trim();
      if (!id || (values[i][C.status] ?? "").trim() === ST.CANCELLED) continue;
      rowsById.set(id, [...(rowsById.get(id) ?? []), i + 2]);
    }
    const duplicates: DuplicateJobId[] = [];
    const renumbered: RenumberedRow[] = [];
    const renameByRow = new Map<number, RenumberedRow>();
    const writes: { range: string; values: string[][] }[] = [];
    const usedIds = new Set(rowsById.keys());
    for (const [jobId, rowNos] of rowsById) {
      if (rowNos.length < 2) continue;
      const webJob = await prisma.job.findUnique({ where: { sheetRef: jobId } });
      const dup: DuplicateJobId = { jobId, rows: rowNos, inWeb: webJob ? 1 : 0, missing: rowNos.length - (webJob ? 1 : 0) };

      // ระบบตั้งรหัสใหม่ให้แถวที่เกินเอง (ทำผ่าน API จึงไม่ติดล็อก «ปิดงาน» ของชีต)
      const dupRows: DupRow[] = rowNos.map((rowNo) => ({
        rowNo,
        status: (values[rowNo - 2][C.status] ?? "").trim(),
        leg: legOfRow(values[rowNo - 2]),
        cells: values[rowNo - 2],
      }));
      const plan = planDuplicateFixes(jobId, dupRows, webJob, usedIds);
      if (plan.reason) {
        duplicates.push({
          ...dup,
          reason: plan.reason,
          // ป้าย "ตรงกับงานในเว็บ" ติดเฉพาะแถวที่เก็บรหัสเดิม — ถ้าติดทุกแถวที่ข้อมูลเหมือน
          // (กรณีเหมือนกันหมดคือทุกแถว) ปุ่มจะหายหมดจนตัดสินอะไรไม่ได้เลย
          detail: dupRows.map((r) => ({
            rowNo: r.rowNo,
            status: r.status,
            summary: summarizeRow(r.cells),
            inWeb: plan.keeperRow === r.rowNo,
          })),
        });
        continue;
      }
      for (const rn of plan.renames) {
        const row = values[rn.row - 2];
        row[C.id] = rn.to;
        writes.push({ range: `${JOBS_TAB}!A${rn.row}`, values: [[rn.to]] });
        if (rn.confirmed) row[C.status] = ST.CONFIRMED;
        renameByRow.set(rn.row, rn);
        renumbered.push(rn);
      }
      if (plan.keeperConfirm && plan.keeperRow) values[plan.keeperRow - 2][C.status] = ST.CONFIRMED;
    }
    const dupById = new Map(duplicates.map((d) => [d.jobId, d]));

    const results: SheetImportResult["rows"] = [];
    const dupReported = new Set<string>();
    let imported = 0;
    let failed = 0;
    let pendingReview = 0;
    let advancesSynced = 0;
    let refreshed = 0;

    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      const rowNo = i + 2; // แถวจริงในชีต (ข้อมูลเริ่มแถว 2)
      const status = (row[C.status] ?? "").trim();
      if (status === "ส่งของเสร็จสิ้น") pendingReview++;

      // รหัสซ้ำ — ไม่นำเข้าเด็ดขาด และเขียนเตือนกลับลงชีตทุกแถวที่ซ้ำ
      // ระบบไม่เดาว่าแถวไหนคือขาจริง ต้องให้คนตั้งรหัสใหม่เอง
      const dup = dupById.get((row[C.id] ?? "").trim());
      if (dup) {
        const closed = status === ST.IMPORTED;
        const msg = duplicateMessage(dup, closed);
        if ((row[21] ?? "").trim() !== msg) {
          writes.push({ range: `${JOBS_TAB}!${RESULT_COL}${rowNo}`, values: [[msg]] });
          // แถวที่ปิดงานแล้วไม่แตะสถานะ (แถวหนึ่งในนั้นคือขาที่อยู่ในเว็บจริง)
          if (!closed) writes.push({ range: `${JOBS_TAB}!${STATUS_COL}${rowNo}`, values: [[ST.FAILED]] });
        }
        if (closed) {
          if (await syncTravelAdvance(row)) advancesSynced++;
          await syncTickets(row);
        }
        // รายงานรหัสละครั้ง ไม่ใช่แถวละครั้ง — ตารางผลลัพธ์จะได้อ่านง่าย
        if (!dupReported.has(dup.jobId)) {
          dupReported.add(dup.jobId);
          results.push({ jobId: dup.jobId, ok: false, message: msg.replace(/^[⚠️❌]\s*/u, "") });
        }
        continue;
      }
      // แถวที่เพิ่งได้รหัสใหม่แต่ยังอยู่ในมือคนขับ (ยังไม่ยืนยัน) — บอกไว้ในชีต แล้วรอรอบหน้า
      const renamed = renameByRow.get(rowNo);
      const renamedNote = renamed
        ? `🔢 รหัสเดิม ${renamed.from} ซ้ำกับแถว ${renamed.keeperRow} — ตั้งรหัสใหม่เป็น ${renamed.to} ให้แล้ว`
        : "";
      if (renamed && !renamed.confirmed) {
        writes.push({ range: `${JOBS_TAB}!${RESULT_COL}${rowNo}`, values: [[`${renamedNote} · จะดึงเข้าเว็บเมื่อสถานะเป็น «${ST.CONFIRMED}»`]] });
        results.push({ jobId: renamed.to, ok: true, message: `${renamedNote} (ยังไม่ดึงเข้าเว็บ รอยืนยัน)` });
        continue;
      }

      // แถว «นำเข้าไม่ผ่าน» ลองใหม่ให้ทุกครั้ง — ออฟฟิศแก้ช่องที่ผิดแล้ว (เช่น เติมรหัสลูกค้า)
      // มักลืมเปลี่ยนสถานะกลับเป็น «ยืนยัน» งานเลยค้างอยู่อย่างนั้น ทั้งที่แก้เสร็จแล้ว
      if (status !== ST.CONFIRMED && status !== ST.FAILED) {
        // งานที่ปิดไปแล้ว ไม่ต้องสร้างงานซ้ำ แต่ยังต้องตามเก็บเงินเดินทาง/ค่าทางด่วน
        // เพราะออฟฟิศมักกรอกเงินตามหลัง และงานเก่าดึงเข้าเว็บตอนที่ยังไม่มีสองคอลัมน์นี้
        if (status === ST.IMPORTED) {
          if (await syncTravelAdvance(row)) advancesSynced++;
          // งานเก่าที่ดึงเข้าเว็บตอนที่ยังไม่มีช่องเลขตั๋ว ต้องตามเติมให้ ไม่งั้นใบวางบิลจะว่าง
          await syncTickets(row);
          // และอัปเดตข้อความ «ผลนำเข้าเว็บ» ให้ตรงกับสถานะปัจจุบันของงานในเว็บ
          // เช่น เพิ่มเส้นทางในเว็บแล้ว คำเตือน "ยังจับคู่เส้นทางไม่ได้" ในชีตต้องหายไปเอง
          const fresh = await refreshedMessage(row, ctx);
          if (fresh && fresh !== (row[21] ?? "").trim()) {
            writes.push({ range: `${JOBS_TAB}!${RESULT_COL}${rowNo}`, values: [[fresh]] });
            refreshed++;
          }
        }
        continue;
      }

      const jobId = (row[C.id] ?? "").trim();
      const res = await importRow(row, jobId, ctx, driverByCode, customerByCode);
      // ทุกแถวขึ้นต้นด้วยเครื่องหมายสถานะเหมือนกัน: ✅ จบ · ⚠️ ต้องแก้ · ❌ ยังไม่เข้าเว็บ
      if (!res.ok) res.message = `❌ ${res.message}`;
      // รหัสเพิ่งถูกเปลี่ยน ต้องบอกไว้ในชีตด้วย ไม่งั้นออฟฟิศหารหัสเดิมไม่เจอแล้วงง
      if (renamedNote) res.message = `${renamedNote} · ${res.message}`;

      if (res.ok) {
        imported++;
        writes.push(
          { range: `${JOBS_TAB}!${STATUS_COL}${rowNo}`, values: [[ST.IMPORTED]] },
          { range: `${JOBS_TAB}!${RESULT_COL}${rowNo}`, values: [[res.message]] },
        );
      } else {
        failed++;
        const unchanged = status === ST.FAILED && (row[21] ?? "").trim() === res.message;
        if (!unchanged) {
          writes.push(
            { range: `${JOBS_TAB}!${STATUS_COL}${rowNo}`, values: [[ST.FAILED]] },
            { range: `${JOBS_TAB}!${RESULT_COL}${rowNo}`, values: [[res.message]] },
          );
        }
      }
      results.push({ jobId: jobId || `แถว ${rowNo}`, ok: res.ok, message: res.message });
    }

    // เขียนผลกลับลงชีตเป็นชุดเดียว
    await batchWriteValues(keyFile, sheetId, writes);

    // อัปเดตข้อมูลหลักให้ dropdown ในชีตตรงกับเว็บเสมอ
    await pushMasterData(keyFile, sheetId, ctx, drivers);

    return { ok: true, imported, failed, pendingReview, advancesSynced, refreshed, duplicates, renumbered, rows: results };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "เชื่อมต่อชีตไม่สำเร็จ",
      imported: 0, failed: 0, pendingReview: 0, advancesSynced: 0, refreshed: 0, duplicates: [], renumbered: [], rows: [],
    };
  }
}

/**
 * เติมเลขที่ตั๋วให้งานที่ดึงเข้าเว็บไปแล้ว — แก้เลขในชีตแล้วดึงใหม่ เว็บตามให้
 * เขียนเฉพาะตอนที่ค่าต่างจากเดิม จะได้ไม่ไปกวนฐานข้อมูลทุกรอบที่กดดึงงาน
 */
async function syncTickets(row: string[]): Promise<void> {
  const jobId = (row[C.id] ?? "").trim();
  if (!jobId) return;
  const { ticketOrigin, ticketDest } = ticketsOf(row);
  if (!ticketOrigin && !ticketDest) return;

  const job = await prisma.job.findUnique({
    where: { sheetRef: jobId },
    select: { id: true, ticketOrigin: true, ticketDest: true },
  });
  if (!job) return;
  if (job.ticketOrigin === ticketOrigin && job.ticketDest === ticketDest) return;

  await prisma.job.update({
    where: { id: job.id },
    data: { ticketOrigin, ticketDest },
  });
}

/**
 * ข้อความ «ผลนำเข้าเว็บ» ล่าสุดของแถวที่ปิดงานแล้ว — คืน null ถ้าไม่ต้องแตะ
 *
 * ชีตเก็บข้อความไว้ตั้งแต่วันที่ดึงงาน พอแก้ข้อมูลในเว็บแล้ว (เช่น เพิ่มเส้นทางที่ขาด)
 * คำเตือนเก่าจะค้างอยู่ในชีตตลอดไป ทำให้ออฟฟิศเข้าใจผิดว่ายังมีปัญหา
 */
async function refreshedMessage(
  row: string[],
  ctx: Awaited<ReturnType<typeof buildContext>>,
): Promise<string | null> {
  const jobId = (row[C.id] ?? "").trim();
  if (!jobId) return null;
  const job = await prisma.job.findUnique({ where: { sheetRef: jobId } });
  if (!job) return `❌ ไม่พบงานนี้ในเว็บแล้ว (ถูกลบ?) — ถ้าต้องการดึงใหม่ ให้เปลี่ยนสถานะเป็น «${ST.CONFIRMED}»`;
  const hasAdvance = (await prisma.travelAdvance.count({ where: { sheetRef: jobId } })) > 0;
  return okMessage(job.id, hasAdvance, openIssues(computeJob(ctx, job)));
}

/**
 * งานในเว็บกับแถวในชีต "คนละขา" หรือเปล่า — คืนข้อความบอกช่องที่ต่าง (null = ตรงกันหมด)
 *
 * ใช้ตอนรหัสงานชนกัน: ถ้าข้อมูลตรงกันหมดแปลว่าเป็นแถวเดิมที่ดึงซ้ำ (ปล่อยผ่านได้)
 * แต่ถ้าต่าง แปลว่าเป็นอีกขาหนึ่งที่บังเอิญใช้รหัสเดียวกัน ถ้าปล่อยผ่านขานั้นจะหายไปเลย
 */
function differentLeg(
  job: { loadDate: Date; headPlate: string; origin: string; destination: string; weightOrigin: number | null; weightDest: number | null },
  sheet: { loadDate: Date; headPlate: string; origin: string; destination: string; weightOrigin: number | null; weightDest: number | null },
): string | null {
  const diffs: string[] = [];
  if (job.loadDate.getTime() !== sheet.loadDate.getTime()) diffs.push("วันที่");
  if (job.headPlate.trim() !== sheet.headPlate.trim()) diffs.push("ทะเบียนรถ");
  if (job.origin.trim() !== sheet.origin.trim()) diffs.push("ต้นทาง");
  if (job.destination.trim() !== sheet.destination.trim()) diffs.push("ปลายทาง");
  if ((job.weightOrigin ?? null) !== sheet.weightOrigin) diffs.push("น้ำหนักต้นทาง");
  if ((job.weightDest ?? null) !== sheet.weightDest) diffs.push("น้ำหนักปลายทาง");
  return diffs.length ? `ต่างกันที่ ${diffs.join(", ")}` : null;
}

/** ตรวจและบันทึก 1 แถว — คืนข้อความสั้นๆ ไว้เขียนกลับลงชีต */
async function importRow(
  row: string[],
  jobId: string,
  ctx: Awaited<ReturnType<typeof buildContext>>,
  driverByCode: Map<string, { code: string }>,
  customerByCode: Map<string, { id: number }>,
): Promise<{ ok: boolean; message: string }> {
  const problems: string[] = [];

  if (!jobId) problems.push("ไม่มีรหัสงาน (คอลัมน์ A)");

  const loadDate = parseDate(row[C.date] ?? "");
  if (!loadDate) problems.push("วันที่อ่านไม่ได้");

  const headPlate = (row[C.head] ?? "").trim();
  if (!headPlate) problems.push("ไม่ได้กรอกทะเบียนรถ");
  else if (!ctx.vehicleByPlate.has(headPlate)) problems.push(`ทะเบียน ${headPlate} ไม่มีในเว็บ (หน้า ข้อมูลรถ)`);

  // «รถเดี่ยว» / ว่าง / "-" = ไม่มีหาง — ไม่ต้องมีทะเบียนหลอก
  const trailerPlate = trailerOrNull(row[C.trailer]);
  if (trailerPlate && !ctx.vehicleByPlate.has(trailerPlate)) {
    problems.push(`ทะเบียนหาง ${trailerPlate} ไม่มีในเว็บ (หน้า ข้อมูลรถ) — ถ้าเป็นรถเดี่ยวให้เลือก «${NO_TRAILER}»`);
  }

  // "รถร่วม" ในช่องรหัสคนขับ = งานรถร่วม ไม่มี พขร. ของบริษัท ไม่ใช่รหัสที่หาไม่เจอ
  const driverCode = driverCodeOrNull(row[C.driver]);
  if (driverCode && !driverByCode.has(driverCode)) {
    problems.push(`รหัสคนขับ ${driverCode} ไม่มีในเว็บ (หน้า ข้อมูลพนักงานขับรถ)`);
  }

  const customerCode = (row[C.customer] ?? "").trim().toUpperCase();
  const customer = customerCode ? customerByCode.get(customerCode) : undefined;
  if (!customer) problems.push(`รหัสลูกค้า ${customerCode || "(ว่าง)"} ไม่มีในเว็บ (หน้า ข้อมูลลูกค้า)`);

  const origin = (row[C.origin] ?? "").trim();
  const destination = (row[C.dest] ?? "").trim();
  if (!origin || !destination) problems.push("ต้นทาง/ปลายทางว่าง");
  else if (origin === destination) problems.push("ต้นทางกับปลายทางเป็นที่เดียวกัน");

  if (problems.length > 0) return { ok: false, message: problems.join(" · ") };

  // ทุกอย่างผ่าน — บันทึก (loadDate/customer ผ่านการตรวจแล้วแน่นอน)
  const date = loadDate!;

  const vehicle = ctx.vehicleByPlate.get(headPlate)!;
  const route = ctx.routeByKey.get(routeKey(origin, destination, vehicle.vehicleType)) ?? null;
  const tripCode = `${headPlate}-${toInputDate(date).split("-").reverse().join("")}`;

  // เลขตั๋วเก็บเป็นช่องของตัวเอง (ไม่ปนในหมายเหตุ) เพราะใบวางบิลต้องอ้างอิงเลขนี้
  const { ticketOrigin, ticketDest } = ticketsOf(row);
  const note = (row[C.note] ?? "").trim() || null;

  // เงินเดินทาง (คอลัมน์ U) / ค่าทางด่วน (คอลัมน์ T) → หน้า «เงินเดินทาง / ค่าทางด่วน» ของเว็บ
  const saveAdvance = async () => ((await syncTravelAdvance(row)) ? " + เงินเดินทาง/ทางด่วน" : "");

  try {
    const job = await prisma.job.create({
      data: {
        loadDate: date,
        unloadDate: date,
        tripCode,
        headPlate,
        trailerPlate,
        driverCode,
        customerId: customer!.id,
        origin,
        destination,
        weightOrigin: numOrNull(row[C.wOrigin] ?? ""),
        weightDest: numOrNull(row[C.wDest] ?? ""),
        cargoType: (row[C.cargo] ?? "").trim() || null,
        ticketOrigin,
        ticketDest,
        routeId: route?.id ?? null,
        note,
        sheetRef: jobId,
      },
    });
    const hasAdvance = (await saveAdvance()) !== "";
    const problems = route ? [] : ["ยังจับคู่เส้นทางไม่ได้ — ไปเลือกในหน้า บันทึกงานขนส่ง"];
    return { ok: true, message: okMessage(job.id, hasAdvance, problems) };
  } catch (e) {
    // รหัสงานนี้มีในเว็บแล้ว (unique ชน) — ต้องแยกให้ออกว่าเป็นแถวเดิมที่ดึงซ้ำ หรือคนละขาที่ใช้รหัสชนกัน
    if (e instanceof Error && e.message.includes("sheetRef")) {
      const existing = await prisma.job.findUnique({ where: { sheetRef: jobId } });
      if (existing) {
        const diff = differentLeg(existing, {
          loadDate: date,
          headPlate,
          origin,
          destination,
          weightOrigin: numOrNull(row[C.wOrigin] ?? ""),
          weightDest: numOrNull(row[C.wDest] ?? ""),
        });
        // ข้อมูลไม่ตรงกับงานที่อยู่ในเว็บ = เป็นคนละขาแต่ใช้รหัสเดียวกัน ห้ามกลืนเงียบๆ
        if (diff) {
          return {
            ok: false,
            message: `รหัสงาน ${jobId} มีอยู่ในเว็บแล้ว (งาน #${existing.id}) แต่ข้อมูลไม่ตรงกัน — ${diff} · เป็นคนละขา ให้ตั้งรหัสงานใหม่ที่ไม่ซ้ำ แล้วตั้งสถานะเป็น «${ST.CONFIRMED}»`,
          };
        }
      }
      const hasAdv = (await saveAdvance().catch(() => "")) !== "";
      const problems = existing ? openIssues(computeJob(ctx, existing)) : [];
      return { ok: true, message: okMessage(existing?.id ?? "?", hasAdv, problems) };
    }
    return { ok: false, message: e instanceof Error ? e.message.slice(0, 200) : "บันทึกไม่สำเร็จ" };
  }
}

/**
 * ส่งข้อมูลหลักจากเว็บไปเติมชีต
 *  • แท็บ «ฐานข้อมูล» A-E: ทะเบียนรถ / ทะเบียนหาง / รหัสลูกค้า / สถานที่ / ประเภทสินค้า (ใช้ทำ dropdown)
 *  • แท็บ «ฐานข้อมูล» F-H: รหัสคนขับ / รถประจำ / หางประจำ (จากหน้า จับคู่รถ+พขร. —
 *    ชีตใช้เติมทะเบียนรถอัตโนมัติเมื่อเลือกรหัสคนขับ)
 *  • แท็บ «คนขับ»: เพิ่มรหัสคนขับที่ยังไม่มีในชีต — "ไม่แตะ" คอลัมน์ LINE User ID ที่ผูกไว้แล้ว
 */
async function pushMasterData(
  keyFile: string,
  sheetId: string,
  ctx: Awaited<ReturnType<typeof buildContext>>,
  drivers: { code: string; firstName: string; lastName: string; active: boolean }[],
): Promise<void> {
  const activeVehicles = ctx.vehicles.filter((v) => v.active);
  const isTrailer = (t: string) => t.includes("หาง") || t.includes("พ่วง");
  const heads = activeVehicles.filter((v) => !isTrailer(v.vehicleType)).map((v) => v.plate);
  const trailersOnly = activeVehicles.filter((v) => isTrailer(v.vehicleType)).map((v) => v.plate);
  // ถ้าฐานข้อมูลไม่ได้แยกประเภทหาง ให้ใช้ทุกทะเบียนเป็นตัวเลือกของช่องหาง
  // «รถเดี่ยว» เป็นตัวเลือกแรกเสมอ — รถที่ไม่มีหางเลือกอันนี้ ไม่ต้องใส่ทะเบียนหลอก
  const trailers = [NO_TRAILER, ...(trailersOnly.length > 0 ? trailersOnly : activeVehicles.map((v) => v.plate))];

  const customers = ctx.customers.filter((c) => c.active).map((c) => c.code);
  const lookups = await prisma.lookup.findMany({ orderBy: [{ kind: "asc" }, { sort: "asc" }] });
  const locations = lookups.filter((l) => l.kind === "location").map((l) => l.value);
  const cargoTypes = lookups.filter((l) => l.kind === "cargoType").map((l) => l.value);
  // เส้นทางที่ตั้งราคาไว้ก็เป็นแหล่งชื่อสถานที่ด้วย
  for (const r of ctx.routes) {
    if (!locations.includes(r.origin)) locations.push(r.origin);
    if (!locations.includes(r.destination)) locations.push(r.destination);
  }

  // รถประจำของคนขับ — ต้องคิดสองชั้นให้ตรงกับตรรกะหน้า «จับคู่รถ+พขร.»:
  //  ชั้นที่ 1: รถแต่ละคัน (หัว+หาง) คนขับปัจจุบันคือ "แถวล่าสุดที่มีผลแล้ว" ของคันนั้น
  //  ชั้นที่ 2: จับคู่กลับ คนขับ → รถ เฉพาะจากรายการปัจจุบันเท่านั้น
  // (ถ้าดูแค่ประวัติรายคน คนที่เคยขับรถคันหนึ่งในอดีตจะได้ทะเบียนติดมาด้วย ทั้งที่รถถูกโอนให้คนอื่นแล้ว)
  const now = new Date();
  type Pairing = (typeof ctx.pairings)[number];
  const currentByVehicle = new Map<string, Pairing>();
  for (const p of ctx.pairings) {
    // ctx.pairings เรียงตาม effectiveDate จากเก่าไปใหม่ — แถวหลังจึงทับแถวก่อนได้เลย
    if (p.effectiveDate.getTime() > now.getTime()) continue;
    currentByVehicle.set(`${p.headPlate.trim()}|${p.trailerPlate.trim()}`, p);
  }
  const pairingByDriver = new Map<string, { head: string; trailer: string; since: number }>();
  for (const p of currentByVehicle.values()) {
    if (!p.driverCode) continue;
    const key = p.driverCode.toUpperCase();
    const prev = pairingByDriver.get(key);
    // คนเดียวเป็นคนขับปัจจุบันของหลายคัน (เช่น เพิ่งย้ายคัน) — ใช้คันที่จับคู่ล่าสุด
    if (!prev || p.effectiveDate.getTime() >= prev.since) {
      pairingByDriver.set(key, {
        head: p.headPlate.trim(),
        trailer: p.trailerPlate.trim(),
        since: p.effectiveDate.getTime(),
      });
    }
  }
  const pairDrivers: string[] = [];
  const pairHeads: string[] = [];
  const pairTrailers: string[] = [];
  for (const d of drivers) {
    const pair = pairingByDriver.get(d.code.toUpperCase());
    if (!d.active || !pair) continue;
    pairDrivers.push(d.code);
    pairHeads.push(pair.head);
    // คู่ที่ไม่มีหาง → ส่ง «รถเดี่ยว» ให้ชีตเติมช่องหางเป็นคำนี้ แทนที่จะปล่อยว่างให้คนเดา
    pairTrailers.push(pair.trailer || NO_TRAILER);
  }

  const cols = [heads, trailers, customers, locations, cargoTypes, pairDrivers, pairHeads, pairTrailers];
  const maxLen = Math.max(...cols.map((c) => c.length), 1);
  const grid: string[][] = [];
  for (let i = 0; i < maxLen; i++) grid.push(cols.map((col) => col[i] ?? ""));

  await clearValues(keyFile, sheetId, `${MASTER_TAB}!A2:H`);
  await writeValues(keyFile, sheetId, `${MASTER_TAB}!A2:H${maxLen + 1}`, grid);

  // เพิ่มคนขับที่ยังไม่มีในแท็บคนขับ (คอลัมน์ A รหัส, B ชื่อ) — ค่าเดิมไม่ถูกแตะ
  const existing = await readValues(keyFile, sheetId, `${DRIVERS_TAB}!A2:A`);
  const existingCodes = new Set(existing.map((r) => (r[0] ?? "").trim().toUpperCase()).filter(Boolean));
  const missing = drivers
    .filter((d) => d.active && !existingCodes.has(d.code.toUpperCase()))
    .map((d) => [d.code, `${d.firstName} ${d.lastName}`.trim()]);
  if (missing.length > 0) {
    const startRow = existing.length + 2;
    await writeValues(keyFile, sheetId, `${DRIVERS_TAB}!A${startRow}:B${startRow + missing.length - 1}`, missing);
  }
}
