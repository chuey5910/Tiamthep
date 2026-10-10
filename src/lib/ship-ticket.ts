/**
 * ตั๋วเรือรอตรวจ — รองรับหลายเส้นทาง / หลายแบบตั๋ว
 *
 * ทางเดินของข้อมูล:
 *   1. คนขับ/ออฟฟิศถ่ายรูปตั๋ว (1 รูปได้หลายใบ) เก็บใน Google Drive
 *      โฟลเดอร์ «ตั๋วเรือ» / <ต้นทาง - ปลายทาง> / <ทะเบียนรถ> / รูป
 *   2. Apps Script (line-bot/Code.gs → scanShipTickets) อ่านรูปใหม่ทุกโฟลเดอร์เส้นทางด้วย OCR ของ Google
 *      แล้วเขียนข้อความลงแท็บ «ตั๋วเรือ» ในชีตสั่งงาน (ทำในบัญชีเจ้าของ จึงใช้ OCR ฟรีของ Drive ได้)
 *   3. เว็บดึงแท็บนั้นมาแยกเป็นทีละใบ (ship-ticket-parse.ts ตามแบบตั๋วของเส้นทาง) เก็บเป็น ShipTicket «รอตรวจ»
 *   4. คนตรวจที่หน้า บันทึกประจำวัน › ตั๋วเรือรอตรวจ แล้วกดยืนยัน → กลายเป็นงาน (Job)
 *
 * ค่าที่ระบบรู้อยู่แล้วไม่อ่านจากรูป: ทะเบียน = ชื่อโฟลเดอร์ทะเบียน
 * · ต้นทาง/ปลายทาง/ลูกค้า/แบบตั๋ว = ค่าตั้งของโฟลเดอร์เส้นทาง (ShipRoute · หน้า ตั้งค่า › ตั๋วเรือ)
 * · พขร. จากตารางจับคู่รถ (ชื่อในตั๋วไว้เทียบ ไม่ตรง = ให้คนเลือก)
 * น้ำหนักปลายทาง = น้ำหนักต้นทาง ตามที่เจ้าของกำหนด
 */

import { buildContext, resolveDriver, routeKey } from "./calc";
import { formatThaiDate, toInputDate } from "./date";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ShipPhoto as ShipPhotoRow, ShipRoute } from "@prisma/client";
import { downloadDriveFile } from "./google-drive";
import { readValues, sheetConfig } from "./google-sheets";
import { readPhotoLocally } from "./ship-ocr-local";
import { mergeReaders, type MergedTicket } from "./ship-ticket-merge";
import { formatOf, validTicketNo, type TicketFormat } from "./ship-ticket-formats";
import { nameKey, parseTicketPhoto, plateKey, weightVerified } from "./ship-ticket-parse";
import { prisma } from "./prisma";

/** แท็บในชีตสั่งงานที่ Apps Script เขียนผล OCR ลงไว้ — คอลัมน์ต้องตรงกับ Code.gs (SHIP_HEADER) */
export const SHIP_TAB = "ตั๋วเรือ";
/** โฟลเดอร์เส้นทางเดียวก่อนมีหลายเส้นทาง — แถวเก่าในชีตที่ยังไม่มีคอลัมน์ G ถือว่ามาจากโฟลเดอร์นี้ */
export const LEGACY_ROUTE_FOLDER = "ท่าเรือศรีราชาฮาร์เบอร์ - โกดังท่าเรือศรีราชาฮาร์เบอร์";
/** หน้าที่ตั้งค่าโฟลเดอร์เส้นทาง — ใช้ในข้อความบอกว่าต้องไปแก้ที่ไหน */
export const SHIP_SETTINGS = "ตั้งค่า › ตั๋วเรือ (โฟลเดอร์เส้นทาง)";

/** คอลัมน์ในแท็บ «ตั๋วเรือ»: เวลา · ทะเบียน(ชื่อโฟลเดอร์) · fileId · ชื่อไฟล์ · ลิงก์รูป · ข้อความ OCR · เส้นทาง(ชื่อโฟลเดอร์) */
const COL = { plate: 1, fileId: 2, fileName: 3, url: 4, ocr: 5, route: 6 };

export type ShipPhoto = { fileId: string; fileName: string; url: string; plate: string; ocr: string; route: string };

// ─────────────────────────────────────────────────────────────
// โฟลเดอร์เส้นทาง — 1 โฟลเดอร์ = ต้นทาง/ปลายทาง/ลูกค้า/แบบตั๋ว ชุดหนึ่ง
// ─────────────────────────────────────────────────────────────

const squash = (s: string) => s.replace(/\s+/g, "");

/**
 * ชื่อโฟลเดอร์ «ต้นทาง - ปลายทาง» → ชื่อสถานที่ในระบบ
 * เทียบแบบไม่สนช่องว่าง (โฟลเดอร์เดิมเขียน «โกดังท่าเรือ…» ส่วนในระบบเป็น «โกดัง ท่าเรือ…»)
 * ต้องตรงสถานที่เดียวเท่านั้น — ไม่ตรง/ตรงหลายที่ = null ให้คนเลือกเอง (ไม่เดา)
 */
export function routeFromFolder(folder: string, locations: string[]): { origin: string | null; destination: string | null } {
  const parts = folder.split(/\s+-\s+/);
  if (parts.length !== 2) return { origin: null, destination: null };
  const find = (name: string) => {
    const hit = locations.filter((l) => squash(l) === squash(name));
    return hit.length === 1 ? hit[0] : null;
  };
  return { origin: find(parts[0]), destination: find(parts[1]) };
}

/**
 * ทุกโฟลเดอร์เส้นทางที่เจอต้องมีแถวค่าตั้ง — โฟลเดอร์ใหม่เพิ่มให้เอง (ลูกค้ายังว่าง = ❌ รอคนเลือก)
 * ต้นทาง/ปลายทางที่ยังว่าง ลองเติมจากชื่อโฟลเดอร์ใหม่ทุกรอบ (เพิ่มสถานที่ทีหลังก็เติมเอง)
 */
export async function ensureShipRoutes(folders: string[]): Promise<Map<string, ShipRoute>> {
  const names = [...new Set(folders.map((f) => f.trim()).filter(Boolean))];
  const [routes, locs] = await Promise.all([
    prisma.shipRoute.findMany(),
    prisma.lookup.findMany({ where: { kind: "location" }, select: { value: true } }),
  ]);
  const locations = locs.map((l) => l.value);
  const byName = new Map(routes.map((r) => [r.folderName, r]));
  for (const name of names) {
    if (byName.has(name)) continue;
    const guess = routeFromFolder(name, locations);
    const created = await prisma.shipRoute.upsert({
      where: { folderName: name },
      update: {},
      create: { folderName: name, origin: guess.origin, destination: guess.destination },
    });
    byName.set(name, created);
  }
  for (const r of byName.values()) {
    if (r.origin && r.destination) continue;
    const guess = routeFromFolder(r.folderName, locations);
    const data = { origin: r.origin ?? guess.origin, destination: r.destination ?? guess.destination };
    if (data.origin !== r.origin || data.destination !== r.destination)
      byName.set(r.folderName, await prisma.shipRoute.update({ where: { id: r.id }, data }));
  }
  return byName;
}

/** ค่าตั้งของเส้นทางยังไม่ครบ → ข้อความ ❌ บอกว่าขาดอะไร แก้ที่ไหน (ครบ = null) */
export function routeProblem(folder: string, route: ShipRoute | undefined, customerOk: boolean): string | null {
  if (!route) return `❌ โฟลเดอร์ «${folder}» ยังไม่มีค่าตั้ง — เปิดหน้า ${SHIP_SETTINGS}`;
  const miss: string[] = [];
  if (!route.origin) miss.push("ต้นทาง");
  if (!route.destination) miss.push("ปลายทาง");
  if (!customerOk) miss.push("ลูกค้า");
  if (miss.length === 0) return null;
  const nameHint =
    !route.origin || !route.destination ? " (ชื่อโฟลเดอร์ไม่ตรงชื่อสถานที่ในระบบ — แก้ชื่อโฟลเดอร์ใน Drive เป็น «ต้นทาง - ปลายทาง» หรือเลือกเอง)" : "";
  return `❌ โฟลเดอร์ «${folder}» ยังไม่ได้ตั้ง${miss.join(" / ")}${nameHint} — ตั้งที่หน้า ${SHIP_SETTINGS}`;
}

/** รูป 1 รูป → ตั๋วรอตรวจทีละใบ · รูปที่เคยรับแล้วข้าม (กดดึงซ้ำกี่ครั้งก็ไม่เกิดแถวซ้ำ) */
/**
 * รุ่นของตัวอ่าน — เพิ่มเลขทุกครั้งที่ปรับวิธีอ่าน (ship-ticket-parse.ts)
 *   1 = ตัดทีละใบตาม "เลขที่" (ตั๋ว 2×2 อ่านสลับซ้าย-ขวา น้ำหนักผ่านแค่ ~9%)
 *   2 = อ่านทั้งรูป จัดเที่ยวจากเวลา (รูปจริง 226 รูป: น้ำหนักผ่าน ~92% · วันที่ 100%)
 *   3 = เลขที่ตั๋ว: รับ "เลขที" ที่ไม้เอกหลุด + เลข 10 หลักขึ้นต้นเหมือนใบอื่น · อ่านได้ไม่ครบจับคู่เมื่อมีทางเดียว
 *       (รูปจริง 226 รูป: เลขที่ 99% · วันที่ 99% · น้ำหนัก 91%)
 * หลังจากนั้นตัวอ่านที่สอง (Tesseract) อ่านซ้ำเบื้องหลัง แล้วแทนที่ด้วยผลรวม 2 ตัวอ่าน (ShipPhoto.localStatus)
 */
export const PARSER_VERSION = 3;

export async function ingestPhoto(p: ShipPhoto, f: TicketFormat): Promise<number> {
  const before = await prisma.shipPhoto.findUnique({ where: { fileId: p.fileId }, select: { format: true } });
  // เก็บรูป + ข้อความของ Google ไว้เสมอ — ตัวอ่านที่สอง (Tesseract) จะมาอ่านซ้ำทีหลังจากคิวนี้
  const info = { googleText: p.ocr, fileName: p.fileName, photoUrl: p.url, folderPlate: p.plate.trim(), routeFolder: p.route };
  await prisma.shipPhoto.upsert({
    where: { fileId: p.fileId },
    update: info,
    create: { fileId: p.fileId, ...info },
  });

  const seen = await prisma.shipTicket.findMany({ where: { fileId: p.fileId }, select: { status: true, parserVersion: true } });
  if (seen.length > 0) {
    // อ่านด้วยตัวอ่านรุ่นเก่า หรือเปลี่ยนแบบตั๋วของเส้นทางนี้ และทั้งรูปยังไม่มีใครตัดสิน → ลบแล้วอ่านใหม่
    // รูปที่มีใบยืนยัน/ไม่ใช้ไปแล้ว ไม่แตะ (กันงานซ้ำ และไม่ทับสิ่งที่คนตัดสินไปแล้ว)
    const stale = seen.some((x) => x.parserVersion < PARSER_VERSION) || before?.format !== f.key;
    const redo = stale && seen.every((x) => x.status === "รอตรวจ");
    if (!redo) return 0;
    await prisma.shipTicket.deleteMany({ where: { fileId: p.fileId, status: "รอตรวจ" } });
  }
  // ตัวอ่านที่สองต้องอ่านรูปนี้ (ใหม่) ด้วยแบบตั๋วเดียวกัน — แบบที่ไม่มีจุดยึดแบ่งช่อง ใช้ตัวอ่านเดียว ไม่ต้องเข้าคิว
  await prisma.shipPhoto.update({
    where: { fileId: p.fileId },
    data: { format: f.key, localStatus: f.localAnchor ? "รอ" : "ข้าม", localError: null, localTries: 0 },
  });
  return createTickets(p, parseTicketPhoto(p.ocr, f).map((t) => ({ ...t, readNote: null })));
}

/** สร้างแถวตั๋วรอตรวจของรูปหนึ่ง — อ่านไม่ออกเลยสักใบ ก็ยังต้องมีแถวให้คนเห็น ไม่งั้นรูปหายเงียบ */
function ticketRows(p: ShipPhoto, parsed: MergedTicket[]) {
  const tickets = parsed.length > 0 ? parsed : [null];
  return tickets.map((t, i) => ({
    fileId: p.fileId,
    fileName: p.fileName,
    photoUrl: p.url,
    part: i + 1,
    folderPlate: p.plate.trim(),
    routeFolder: p.route,
    ocrText: t?.text ?? p.ocr,
    ticketNo: t?.ticketNo ?? null,
    ticketDate: t?.date ?? null,
    weightIn: t?.weightIn ?? null,
    weightOut: t?.weightOut ?? null,
    weightNet: t?.weightNet ?? null,
    plateOnTicket: t?.plate ?? null,
    driverNameOnTicket: t?.driverName ?? null,
    readNote: t?.readNote ?? null,
    parserVersion: PARSER_VERSION,
  }));
}

async function createTickets(p: ShipPhoto, parsed: MergedTicket[]): Promise<number> {
  const data = ticketRows(p, parsed);
  await prisma.shipTicket.createMany({ data, skipDuplicates: true });
  return data.length;
}

// ─────────────────────────────────────────────────────────────
// ตัวอ่านที่สอง — อ่านรูปซ้ำด้วย Tesseract บนเครื่อง แล้วรวมผลกับของ Google
// ทำเบื้องหลังทีละรูป (รูปละ ~5–15 วินาที) ไม่ให้หน้าเว็บช้า
// ─────────────────────────────────────────────────────────────

/** ข้อความต้องคงเดิม — ใช้หาแถวที่เคยติดเรื่องสิทธิ์ เพื่อคืนเข้าคิวเมื่อแชร์แล้ว */
const NO_ACCESS_MSG = "ระบบเปิดรูปใน Google Drive ไม่ได้ — แชร์โฟลเดอร์ «ตั๋วเรือ» ให้บัญชีระบบ (ผู้มีสิทธิ์อ่าน)";
const DRIVE_API_MSG =
  "ระบบเปิดรูปใน Google Drive ไม่ได้ — ยังไม่ได้เปิด Google Drive API ในโปรเจกต์ Google Cloud ของบัญชีระบบ (หน้า APIs & Services › Library › Google Drive API › เปิดใช้)";

let localRunning = false;
let localStartedAt = 0;

/** อ่านรูปที่ค้างในคิวจนหมด (หรือครบเวลา) — เรียกซ้ำระหว่างกำลังทำอยู่ จะไม่เริ่มซ้อน */
export async function runLocalOcrQueue(
  opts: { maxMs?: number; fetchImage?: (fileId: string) => Promise<Buffer> } = {},
): Promise<{ done: number; error: string | null }> {
  // กำลังทำอยู่ → ไม่เริ่มซ้อน (เว้นแต่ค้างเกิน 10 นาที ถือว่ารอบก่อนพังกลางทาง)
  if (localRunning && Date.now() - localStartedAt < 10 * 60 * 1000) return { done: 0, error: null };
  const maxMs = opts.maxMs ?? 4 * 60 * 1000;
  let fetchImage = opts.fetchImage;
  if (!fetchImage) {
    const cfg = sheetConfig();
    if ("error" in cfg) return { done: 0, error: null };
    fetchImage = (fileId) => downloadDriveFile(cfg.keyFile, fileId);
  }
  localRunning = true;
  localStartedAt = Date.now();
  const started = Date.now();
  let done = 0;
  try {
    while (Date.now() - started < maxMs) {
      const retryAfter = new Date(Date.now() - 60 * 60 * 1000);
      const photo = await prisma.shipPhoto.findFirst({
        where: {
          OR: [{ localStatus: "รอ" }, { localStatus: "ผิดพลาด", localTries: { lt: 5 }, localAt: { lt: retryAfter } }],
        },
        orderBy: { createdAt: "asc" },
      });
      if (!photo) break;
      const stop = await readOnePhoto(photo, fetchImage);
      done++;
      if (stop) return { done, error: stop };
    }
    return { done, error: null };
  } finally {
    localRunning = false;
  }
}

/** อ่านรูปเดียว — คืนข้อความ ถ้าเป็นปัญหาที่ทำให้อ่านรูปอื่นต่อไม่ได้ด้วย (เช่น ยังไม่ได้ลงตัวอ่าน) */
async function readOnePhoto(photo: ShipPhotoRow, fetchImage: (fileId: string) => Promise<Buffer>): Promise<string | null> {
  // countTry = false: ปัญหาที่ไม่ใช่ของรูปนี้ (เช่น ยังไม่ได้แชร์โฟลเดอร์) ไม่นับเป็นครั้งที่ลอง — แก้แล้วต้องอ่านได้ทุกรูป
  const mark = (localStatus: string, localError: string | null, countTry = localStatus === "ผิดพลาด") =>
    prisma.shipPhoto.update({
      where: { fileId: photo.fileId },
      data: { localStatus, localError, localAt: new Date(), localTries: { increment: countTry ? 1 : 0 } },
    });

  // มีใบที่คนตัดสินไปแล้ว (ยืนยัน/ไม่ใช้) → ไม่แตะรูปนี้ กันงานซ้ำ
  const decided = await prisma.shipTicket.count({ where: { fileId: photo.fileId, status: { not: "รอตรวจ" } } });
  if (decided > 0) {
    await mark("ข้าม", null);
    return null;
  }

  // แบบตั๋วที่ใช้อ่านรูปนี้ (ตั้งตอนรับรูป) — แบบที่ไม่มีจุดยึดให้แบ่งช่อง ใช้ตัวอ่านเดียว (Google)
  const f = formatOf(photo.format);
  if (!f.localAnchor) {
    await mark("ข้าม", null);
    return null;
  }

  const file = join(tmpdir(), `ship-${photo.fileId}.img`);
  try {
    writeFileSync(file, await fetchImage(photo.fileId));
    const local = await readPhotoLocally(file, f);
    const merged = mergeReaders(parseTicketPhoto(photo.googleText, f), local, f);
    const p: ShipPhoto = {
      fileId: photo.fileId,
      fileName: photo.fileName,
      url: photo.photoUrl,
      plate: photo.folderPlate,
      ocr: photo.googleText,
      route: photo.routeFolder,
    };
    // แทนที่ทั้งรูปในครั้งเดียว — ระหว่างอ่าน ถ้ามีคนตัดสินใบในรูปนี้ไปแล้ว ไม่แทนที่ (กันงานซ้ำ)
    const replaced = await prisma.$transaction(async (tx) => {
      const nowDecided = await tx.shipTicket.count({ where: { fileId: photo.fileId, status: { not: "รอตรวจ" } } });
      if (nowDecided > 0) return false;
      await tx.shipTicket.deleteMany({ where: { fileId: photo.fileId } });
      await tx.shipTicket.createMany({ data: ticketRows(p, merged) });
      return true;
    });
    await mark(replaced ? "เสร็จ" : "ข้าม", null);
    // เปิด Drive ได้แล้ว → รูปที่เคยติดเรื่องสิทธิ์ กลับเข้าคิวทันที ไม่ต้องรอรอบชั่วโมง
    await prisma.shipPhoto.updateMany({
      where: { localStatus: "ผิดพลาด", localError: { in: [NO_ACCESS_MSG, DRIVE_API_MSG] } },
      data: { localStatus: "รอ", localError: null, localTries: 0 },
    });
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "NO_ACCESS" || msg === "DRIVE_API_OFF") {
      // ทุกรูปจะติดเหมือนกัน — หยุดรอบนี้เลย ลองใหม่รอบหน้า (ไม่นับครั้ง รูปจึงไม่หมดสิทธิ์ลองระหว่างรอแก้)
      const why = msg === "NO_ACCESS" ? NO_ACCESS_MSG : DRIVE_API_MSG;
      await mark("ผิดพลาด", why, false);
      return why;
    }
    if (/ENOENT/.test(msg) && /tesseract/i.test(msg)) {
      await mark("ผิดพลาด", "เครื่องนี้ยังไม่ได้ลงตัวอ่าน Tesseract");
      return "เครื่องนี้ยังไม่ได้ลงตัวอ่าน Tesseract";
    }
    await mark("ผิดพลาด", msg.slice(0, 300));
    return null;
  } finally {
    rmSync(file, { force: true });
  }
}

/** ความคืบหน้าของตัวอ่านที่สอง — โชว์บนหน้าตั๋วเรือ */
export async function localOcrProgress() {
  const [waiting, failed, sampleError] = await Promise.all([
    prisma.shipPhoto.count({ where: { localStatus: "รอ" } }),
    prisma.shipPhoto.count({ where: { localStatus: "ผิดพลาด" } }),
    prisma.shipPhoto.findFirst({ where: { localStatus: "ผิดพลาด" }, orderBy: { localAt: "desc" }, select: { localError: true } }),
  ]);
  return { waiting, failed, error: sampleError?.localError ?? null };
}

/** ดึงผล OCR ใหม่จากแท็บ «ตั๋วเรือ» */
export async function pullShipTickets(): Promise<{ ok: true; added: number } | { ok: false; error: string }> {
  const cfg = sheetConfig();
  // ข้อความทางเทคนิคของ sheetConfig พูดถึงไลน์/ไฟล์ตั้งค่า — หน้านี้บอกแค่สิ่งที่ผู้ใช้ต้องรู้
  if ("error" in cfg) return { ok: false, error: "เว็บเครื่องนี้ยังไม่ได้เชื่อมกับ Google Sheet ที่เก็บผลอ่านรูปตั๋ว" };
  try {
    const rows = await readValues(cfg.keyFile, cfg.sheetId, `${SHIP_TAB}!A2:G`);
    const routeOf = (r: string[]) => (r[COL.route] ?? "").trim() || LEGACY_ROUTE_FOLDER;
    const routes = await ensureShipRoutes(rows.filter((r) => (r[COL.fileId] ?? "").trim()).map(routeOf));
    let added = 0;
    for (const r of rows) {
      const fileId = (r[COL.fileId] ?? "").trim();
      if (!fileId) continue;
      const route = routeOf(r);
      added += await ingestPhoto(
        {
          fileId,
          fileName: (r[COL.fileName] ?? "").trim(),
          url: (r[COL.url] ?? "").trim(),
          plate: (r[COL.plate] ?? "").trim(),
          ocr: r[COL.ocr] ?? "",
          route,
        },
        formatOf(routes.get(route)?.format),
      );
    }
    return { ok: true, added };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Unable to parse range/i.test(msg)) {
      return { ok: false, error: `ชีตยังไม่มีแท็บ «${SHIP_TAB}» — วางโค้ด Apps Script ใหม่แล้วกดเรียก setupShipTickets 1 ครั้ง` };
    }
    return { ok: false, error: msg };
  }
}

export type ShipRow = {
  id: number;
  photoUrl: string;
  fileName: string;
  part: number;
  plate: string;
  /** โฟลเดอร์เส้นทาง (ShipRoute.folderName) — หน้าตรวจแยกกลุ่มตามนี้ */
  routeFolder: string;
  /** null = อ่านไม่ได้/ไม่ชัด → ตัวแดง เว้นว่างให้กรอก */
  ticketNo: string | null;
  date: string | null;
  dateLabel: string | null;
  /**
   * น้ำหนักต้นทาง (กก. ตามที่พิมพ์ในตั๋ว) — ปลายทางใช้ค่าเดียวกัน
   * ขึ้นให้เองเฉพาะเมื่อตรวจกับ นน.เข้า/ออก ในตั๋วแล้วลงตัว (ตรวจข้างหลัง ไม่โชว์บนจอ) ไม่ลงตัว = null ให้คนกรอก
   */
  weightKg: number | null;
  /** ค่าที่อ่านได้แต่ตรวจไม่ผ่าน — โชว์เป็นตัวช่วยในช่องกรอก ไม่ใช้เอง */
  weightHint: number | null;
  /** พขร. ที่ระบบเสนอ (null = ต้องเลือกเอง) */
  driverCode: string | null;
  driverNote: string | null;
  driverNameOnTicket: string | null;
  /** ❌ แก้ในแถวไม่ได้ ต้องไปแก้ที่อื่นก่อน */
  blockers: string[];
  /** ⚠️ ให้คนตัดสิน */
  warnings: string[];
};

/** หัวกลุ่มของแต่ละโฟลเดอร์เส้นทางในหน้าตรวจ */
export type ShipRouteInfo = {
  folder: string;
  origin: string | null;
  destination: string | null;
  customer: string | null;
  format: string;
  /** ❌ ค่าตั้งยังไม่ครบ (ยืนยันตั๋วในโฟลเดอร์นี้ไม่ได้) */
  problem: string | null;
};

export type ShipPage = {
  rows: ShipRow[];
  routes: ShipRouteInfo[];
  drivers: { code: string; name: string }[];
  /** ข้อความระดับทั้งหน้า (เช่น ยังไม่ตั้งราคาเส้นทาง) */
  notices: string[];
};

/**
 * ชื่อโฟลเดอร์ → รถในฐานข้อมูล
 * ชื่อโฟลเดอร์อาจมีชื่อจังหวัดต่อท้าย (เช่น "70-1853 ลบ") — ตรงทุกตัวก่อน ไม่ตรงค่อยเทียบเฉพาะเลขทะเบียน
 * เลขเดียวกันมีหลายคันในฐานข้อมูล = ไม่รู้ว่าคันไหน → ไม่เดา ให้แก้ชื่อโฟลเดอร์
 */
export function folderVehicle<V extends { plate: string }>(
  vehicles: Map<string, V>,
  folder: string,
): { vehicle: V; error: null } | { vehicle: null; error: string } {
  const name = folder.trim();
  const exact = vehicles.get(name);
  if (exact) return { vehicle: exact, error: null };
  const key = plateKey(name);
  const same = [...vehicles.values()].filter((v) => plateKey(v.plate) === key);
  if (same.length === 1) return { vehicle: same[0], error: null };
  if (same.length > 1)
    return { vehicle: null, error: `❌ โฟลเดอร์ ${name} ตรงกับรถหลายคัน (${same.map((v) => v.plate).join(", ")}) — ตั้งชื่อโฟลเดอร์ให้ตรงทะเบียนในหน้า ข้อมูลรถ ทุกตัว` };
  return { vehicle: null, error: `❌ ไม่พบทะเบียน ${name || "(ว่าง)"} ในข้อมูลรถ — ตั้งชื่อโฟลเดอร์ให้ตรงทะเบียน หรือเพิ่มรถที่หน้า ข้อมูลรถ` };
}

const fullName = (d: { firstName: string; lastName: string }) => `${d.firstName} ${d.lastName}`.trim();

/** ชื่อแบบหลวม: ตัดคำนำหน้า/ช่องว่าง + ตัดวรรณยุกต์ + ำ → า (OCR สับสนบ่อย) */
export function looseName(name: string): string {
  return nameKey(name).replace(/[\u0e48-\u0e4c\u0e4d]/g, "").replace(/\u0e33/g, "\u0e32");
}

/** จำนวนตัวอักษรที่ต้องแก้ให้สองคำเหมือนกัน (Levenshtein) */
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/**
 * พขร. ประจำรถ ณ วันที่ในตั๋ว — งานตั๋วเรือวิ่งรถเดี่ยว (ไม่มีหาง)
 * คู่รถเดี่ยวก่อน ไม่มีค่อยใช้คู่ล่าสุดของหัวคันนั้น (พขร. ผูกกับหัว ไม่ใช่หาง)
 * ยังไงก็เทียบกับชื่อท้ายตั๋วอีกชั้น ไม่ตรง = ให้คนเลือก
 */
function pairedDriver(
  pairings: { headPlate: string; trailerPlate: string; driverCode: string | null; effectiveDate: Date }[],
  plate: string,
  date: Date,
): string | null {
  const solo = resolveDriver(pairings, plate, null, date);
  if (solo) return solo;
  let best: { driverCode: string | null; effectiveDate: Date } | null = null;
  for (const p of pairings) {
    if (p.headPlate.trim() !== plate || p.effectiveDate.getTime() > date.getTime()) continue;
    if (!best || p.effectiveDate.getTime() >= best.effectiveDate.getTime()) best = p;
  }
  return best?.driverCode ?? null;
}

/** เตรียมแถวรอตรวจ — คำนวณสถานะใหม่ทุกครั้ง แก้ข้อมูลหลัก (รถ/จับคู่/พขร.) แล้วผลอัปเดตเอง */
export async function shipReview(): Promise<ShipPage> {
  const [tickets, ctx, drivers, aliases, routeRows] = await Promise.all([
    prisma.shipTicket.findMany({
      where: { status: "รอตรวจ" },
      orderBy: [{ ticketDate: "asc" }, { ticketNo: "asc" }, { id: "asc" }],
    }),
    buildContext(),
    prisma.driver.findMany({ where: { active: true } }),
    prisma.ocrAlias.findMany({ where: { kind: "driver" } }),
    prisma.shipRoute.findMany(),
  ]);

  const notices: string[] = [];
  // ค่าตั้งของแต่ละโฟลเดอร์เส้นทาง — ไม่ครบ = ❌ ทุกแถวของโฟลเดอร์นั้น พร้อมบอกว่าไปตั้งที่ไหน
  const routeByFolder = new Map(routeRows.map((r) => [r.folderName, r]));
  const customerById = new Map(ctx.customers.map((c) => [c.id, c]));
  const routes = new Map<string, ShipRouteInfo>();
  const routeInfo = (folder: string): ShipRouteInfo => {
    const hit = routes.get(folder);
    if (hit) return hit;
    const r = routeByFolder.get(folder);
    const customer = r?.customerId != null ? customerById.get(r.customerId) : undefined;
    const info: ShipRouteInfo = {
      folder,
      origin: r?.origin ?? null,
      destination: r?.destination ?? null,
      customer: customer ? `${customer.code} — ${customer.name}` : null,
      format: formatOf(r?.format).label,
      problem: routeProblem(folder, r, !!customer),
    };
    routes.set(folder, info);
    return info;
  };

  // เลขที่ตั๋วที่มีอยู่แล้ว (ในงาน + ในตั๋วแถวอื่น) — ซ้ำ = เตือนให้คนตัดสิน ไม่ตัดทิ้งเอง
  const nos = tickets.map((t) => t.ticketNo).filter((n): n is string => !!n);
  const [jobsWithNo, othersWithNo] = await Promise.all([
    prisma.job.findMany({ where: { ticketOrigin: { in: nos } }, select: { id: true, ticketOrigin: true } }),
    prisma.shipTicket.findMany({ where: { ticketNo: { in: nos }, status: { not: "ไม่ใช้" } }, select: { id: true, ticketNo: true } }),
  ]);

  const driverByKey = new Map(drivers.map((d) => [nameKey(fullName(d)), d.code]));
  // เทียบแบบหลวม — OCR ชอบอ่าน "อำมร" เป็น "อ่ามร" (ำ ↔ ่า) และวรรณยุกต์หลุด/เกิน
  // ใช้เฉพาะเมื่อได้คนเดียว (ชื่อหลวมซ้ำกันหลายคน = ไม่ใช้ ไม่เดา)
  const looseCount = new Map<string, number>();
  for (const d of drivers) looseCount.set(looseName(fullName(d)), (looseCount.get(looseName(fullName(d))) ?? 0) + 1);
  const driverByLoose = new Map(
    drivers.filter((d) => looseCount.get(looseName(fullName(d))) === 1).map((d) => [looseName(fullName(d)), d.code]),
  );
  const looseOfCode = new Map(drivers.map((d) => [d.code, looseName(fullName(d))]));
  /** พขร. ที่ชื่อต่างจากชื่อในตั๋วไม่เกิน 1 ตัวอักษร — ต้องมีคนเดียวเท่านั้น */
  const nearDriver = (loose: string): string | null => {
    const near = drivers.filter((d) => editDistance(loose, looseOfCode.get(d.code) ?? "") <= 1);
    return near.length === 1 ? near[0].code : null;
  };
  const aliasByKey = new Map(aliases.map((a) => [a.raw, a.value]));
  const driverName = new Map(drivers.map((d) => [d.code, fullName(d)]));

  // เส้นทาง/ราคายังไม่ตั้ง — บอกครั้งเดียวทั้งหน้า (บันทึกงานได้ แต่ค่าบรรทุกยังคิดไม่ได้)
  const noRoute = new Set<string>();
  const rows: ShipRow[] = tickets.map((t) => {
    const blockers: string[] = [];
    const warnings: string[] = [];
    const route = routeInfo(t.routeFolder);
    // ข้อความเต็มอยู่หัวกล่องของเส้นทาง — ในแถวบอกสั้นๆ ว่าไปแก้ที่ไหน
    if (route.problem) blockers.push(`❌ เส้นทางนี้ยังตั้งค่าไม่ครบ — ตั้งที่หน้า ${SHIP_SETTINGS}`);
    const found = folderVehicle(ctx.vehicleByPlate, t.folderPlate);
    const vehicle = found.vehicle;
    // ทะเบียนที่โชว์/บันทึก = ทะเบียนในฐานข้อมูล (ไม่ใช่ชื่อโฟลเดอร์ที่อาจมีชื่อจังหวัดต่อท้าย)
    const plate = vehicle?.plate ?? t.folderPlate;
    if (!vehicle) blockers.push(found.error ?? "❌ ไม่พบรถ");
    else if (route.origin && route.destination && !ctx.routeByKey.get(routeKey(route.origin, route.destination, vehicle.vehicleType)))
      noRoute.add(`${route.origin} → ${route.destination} สำหรับ${vehicle.vehicleType}`);
    if (t.plateOnTicket && plateKey(t.plateOnTicket) !== plateKey(plate))
      warnings.push(`⚠️ ทะเบียนในตั๋ว ${t.plateOnTicket} ไม่ตรงโฟลเดอร์ ${plate} — ตรวจว่าเก็บรูปผิดโฟลเดอร์ไหม`);

    // ตัวอ่าน 2 ตัวอ่านได้ไม่ตรงกัน ฯลฯ — ให้คนดูรูปก่อน
    if (t.readNote) warnings.push(...t.readNote.split(" · "));

    // เลขที่ต้องถูกรูปแบบตามแบบตั๋วของเส้นทางนี้ (จำนวนหลัก)
    const ticketNo = validTicketNo(t.ticketNo, formatOf(routeByFolder.get(t.routeFolder)?.format)) ? t.ticketNo : null;
    if (ticketNo) {
      const job = jobsWithNo.find((j) => j.ticketOrigin === ticketNo);
      const other = othersWithNo.find((o) => o.ticketNo === ticketNo && o.id !== t.id);
      if (job) warnings.push(`⚠️ เลขที่ตั๋วนี้มีในงาน #${job.id} แล้ว — ตรวจว่าซ้ำไหม`);
      else if (other) warnings.push("⚠️ เลขที่ตั๋วซ้ำกับอีกแถวในหน้านี้ — ถ่ายรูปซ้ำไหม");
    }

    const verified = weightVerified(t);
    const date = t.ticketDate;

    // พขร.: ตารางจับคู่รถ ณ วันที่ในตั๋ว เทียบกับชื่อท้ายตั๋ว (หรือชื่อที่คนเคยเลือกให้ไว้)
    const paired = date && vehicle ? pairedDriver(ctx.pairings, plate, date) : null;
    const key = t.driverNameOnTicket ? nameKey(t.driverNameOnTicket) : null;
    const loose = t.driverNameOnTicket ? looseName(t.driverNameOnTicket) : null;
    let fromTicket = key ? (aliasByKey.get(key) ?? driverByKey.get(key) ?? (loose ? driverByLoose.get(loose) : undefined) ?? null) : null;
    // ชื่อในตั๋วต่างจากคนในตารางจับคู่แค่ 1 ตัวอักษร (หลังเทียบแบบหลวม) = OCR อ่านเพี้ยน ถือว่าคนเดียวกัน
    if (paired && loose && !fromTicket && editDistance(loose, looseOfCode.get(paired) ?? "") <= 1) fromTicket = paired;
    let driverCode: string | null = null;
    let driverNote: string | null = null;
    if (paired && (!key || fromTicket === paired)) {
      driverCode = paired;
    } else if (!paired && fromTicket) {
      driverCode = fromTicket;
      driverNote = "✅ พขร. ตามชื่อในตั๋ว (ตารางจับคู่ไม่มีรถคันนี้)";
    } else if (paired && fromTicket) {
      // ชื่อในตั๋วรู้จัก (ตรงชื่อ พขร. หรือเคยเลือกไว้) แต่ไม่ใช่คนในตารางจับคู่ — เลือกตามตั๋วไว้ให้ แต่ต้องให้คนดูก่อน
      driverCode = fromTicket;
      driverNote = `⚠️ ชื่อในตั๋ว «${t.driverNameOnTicket}» ไม่ใช่คนในตารางจับคู่รถ (${driverName.get(paired) ?? paired}) — เลือกตามตั๋วไว้ให้ ตรวจแล้วกดยืนยัน`;
    } else if (paired) {
      driverNote = `⚠️ ชื่อในตั๋ว «${t.driverNameOnTicket}» ไม่ตรงตารางจับคู่รถ (${driverName.get(paired) ?? paired})`;
    } else if (loose && nearDriver(loose)) {
      // ชื่อในตั๋วใกล้เคียง พขร. ในระบบคนเดียว (ต่าง 1 ตัวอักษร) — เลือกไว้ให้ แต่ต้องให้คนดูก่อน
      driverCode = nearDriver(loose);
      driverNote = `⚠️ ชื่อในตั๋ว «${t.driverNameOnTicket}» ใกล้เคียง ${driverName.get(driverCode!) ?? driverCode} — ตรวจแล้วกดยืนยัน (ตารางจับคู่ไม่มีรถคันนี้)`;
    } else {
      driverNote = key
        ? `⚠️ ไม่รู้จักชื่อในตั๋ว «${t.driverNameOnTicket}» และตารางจับคู่ไม่มีรถคันนี้`
        : "⚠️ อ่านชื่อในตั๋วไม่ได้ และตารางจับคู่ไม่มีรถคันนี้";
    }

    return {
      id: t.id,
      photoUrl: t.photoUrl,
      fileName: t.fileName,
      part: t.part,
      plate,
      routeFolder: t.routeFolder,
      ticketNo,
      date: date ? toInputDate(date) : null,
      dateLabel: date ? formatThaiDate(date) : null,
      weightKg: verified ? t.weightNet : null,
      weightHint: verified ? null : t.weightNet,
      driverCode,
      driverNote,
      driverNameOnTicket: t.driverNameOnTicket,
      blockers,
      warnings,
    };
  });

  for (const r of noRoute)
    notices.push(`⚠️ ยังไม่มีเส้นทาง ${r} — ยืนยันได้ แต่ค่าบรรทุกจะยังไม่ขึ้น ไปตั้งราคาที่หน้า ฐานข้อมูล › เส้นทาง ระยะทาง ราคา`);

  return {
    rows,
    routes: [...routes.values()].sort((a, b) => a.folder.localeCompare(b.folder, "th")),
    drivers: drivers
      .map((d) => ({ code: d.code, name: fullName(d) }))
      .sort((a, b) => a.name.localeCompare(b.name, "th")),
    notices,
  };
}

/**
 * ดึงรูปใหม่เบื้องหลังทุก 5 นาที — เรียกจากทุกหน้า (layout) ไม่รอผล หน้าไม่ช้าลง
 * ตัวเลขข้างเมนูจึงขึ้นเองแม้ยังไม่มีใครเปิดหน้าตั๋วเรือ · ดึงซ้ำไม่เกิดแถวซ้ำ (ingestPhoto)
 */
let lastPull = 0;
export function pullShipTicketsInBackground(): void {
  if (Date.now() - lastPull < 5 * 60 * 1000) return;
  if ("error" in sheetConfig()) return;
  lastPull = Date.now();
  // ดึงข้อความใหม่จากชีตก่อน แล้วให้ตัวอ่านที่สองอ่านรูปที่ค้างต่อ (ทั้งหมดไม่รอผล หน้าไม่ช้า)
  pullShipTickets()
    .catch(() => {})
    .finally(() => runLocalOcrQueue().catch(() => {}));
}

/** ตั๋วรอตรวจกี่ใบ — ตัวเลขข้างเมนู */
export async function shipPendingCount(): Promise<number> {
  try {
    return await prisma.shipTicket.count({ where: { status: "รอตรวจ" } });
  } catch {
    return 0;
  }
}
