/**
 * ตัวอ่านที่สอง — Tesseract บนเครื่องเอง (ฟรี ไม่ใช้เน็ต) รู้ "ตำแหน่ง" ของทุกคำในรูป
 *
 * OCR ของ Google Drive ส่งมาแค่ข้อความ ตั๋วซ้าย-ขวาเลยปนกัน
 * ตัวนี้รู้พิกัด จึงแบ่งรูปเป็นช่องตามตั๋วจริง (แถว × คอลัมน์) แล้วอ่านทีละใบ
 * ผลที่ได้ไปรวมกับของ Google ที่ ship-ticket-merge (ตรงกัน = ใส่ให้ · ไม่ตรง = ว่างให้คนดู)
 *
 * หลักไม่เดาเหมือนเดิม: น้ำหนักต้องลบกันลงตัว (ออก − เข้า = สุทธิ) ถึงจะนับว่าอ่านได้
 */

import { execFile } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { validTicketNo, type TicketFormat } from "./ship-ticket-formats";

const run = promisify(execFile);

export type OcrWord = { text: string; x: number; y: number; w: number; h: number; conf: number };

export type LocalTicket = {
  ticketNo: string | null;
  entryAt: Date | null;
  exitAt: Date | null;
  weightIn: number | null;
  weightOut: number | null;
  weightNet: number | null;
  driverName: string | null;
  plate: string | null;
  /** ข้อความของช่องนี้ (ไว้ตรวจย้อนหลัง) */
  text: string;
};

/** เรียก tesseract แล้วได้ทุกคำพร้อมพิกัด (รูปแบบ TSV ระดับคำ) */
export async function tesseractWords(imagePath: string): Promise<OcrWord[]> {
  const bin = process.env.TESSERACT_PATH || "tesseract";
  const { stdout } = await run(bin, [imagePath, "stdout", "-l", "tha+eng", "--psm", "3", "tsv"], {
    maxBuffer: 20 * 1024 * 1024,
    timeout: 120_000,
    // ไม่ให้กิน CPU ทุกคอร์ของ NAS — เว็บต้องยังตอบเร็วระหว่างอ่านรูป
    env: { ...process.env, OMP_THREAD_LIMIT: process.env.OMP_THREAD_LIMIT || "2" },
  });
  const words: OcrWord[] = [];
  for (const line of stdout.split("\n").slice(1)) {
    const c = line.split("\t");
    if (c.length < 12 || c[0] !== "5") continue;
    const text = c[11].trim();
    if (!text) continue;
    words.push({ text, x: +c[6], y: +c[7], w: +c[8], h: +c[9], conf: +c[10] });
  }
  return words;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** จัดกลุ่มค่าที่อยู่ใกล้กัน (ห่างเกิน gap = กลุ่มใหม่) — คืนค่ากลางของแต่ละกลุ่ม */
function clusters(values: number[], gap: number): number[] {
  const s = [...values].sort((a, b) => a - b);
  const out: number[][] = [];
  for (const v of s) {
    const last = out[out.length - 1];
    if (last && v - last[last.length - 1] <= gap) last.push(v);
    else out.push([v]);
  }
  return out.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

/**
 * แบ่งคำในรูปเป็นช่องตามตั๋ว
 * จุดยึด = เลขที่ตั๋ว (อยู่มุมบนของทุกใบ · จำนวนหลักตามแบบตั๋ว) → ได้ตำแหน่งคอลัมน์และแถวของตั๋ว
 * ใบที่อ่านเลขที่ไม่ออก ยังมีช่องของตัวเอง เพราะคอลัมน์/แถวมาจากใบอื่น
 */
export function splitByPosition(words: OcrWord[], f: TicketFormat): OcrWord[][] {
  const isNo = (w: OcrWord) => validTicketNo(w.text, f);
  const anchors = words.filter(isNo);
  if (anchors.length === 0) return [];
  const h = median(words.map((w) => w.h)) || 20;
  const width = Math.max(...words.map((w) => w.x + w.w));
  // ตั๋วเรียงบนลงล่าง (blocks): ใบหนึ่งกว้างเต็มรูป — เลขที่อยู่ขวาของใบได้ (จี เจ สตีล) ทั้งแถวจึงเป็นของใบนั้น
  const cols = f.layout === "blocks" ? [0] : clusters(anchors.map((a) => a.x), width * 0.2);
  const rows = clusters(anchors.map((a) => a.y), h * 10);
  // ช่องของตั๋ว: เริ่มเหนือเลขที่เล็กน้อย จนถึงแถวถัดไป · คอลัมน์แบ่งที่กึ่งกลางระหว่างจุดยึด
  const colOf = (x: number) => {
    let k = -1;
    for (let i = 0; i < cols.length; i++) if (x >= cols[i] - width * 0.05) k = i;
    return k;
  };
  const rowOf = (y: number) => {
    let k = -1;
    for (let i = 0; i < rows.length; i++) if (y >= rows[i] - h * 2) k = i;
    return k;
  };
  const cells: OcrWord[][] = Array.from({ length: rows.length * cols.length }, () => []);
  for (const w of words) {
    const c = colOf(w.x);
    const r = rowOf(w.y);
    if (c >= 0 && r >= 0) cells[r * cols.length + c].push(w);
  }
  // ช่องที่ไม่มีอะไรเลย (เช่น รูปมีตั๋ว 3 ใบในตาราง 2×2) ตัดทิ้ง
  return cells.filter((c) => c.some((w) => /\d{1,2}:\d{2}/.test(w.text) || isNo(w)));
}

/** เรียงคำในช่องเป็นบรรทัด (ซ้าย→ขวา บน→ล่าง) */
function linesOf(cell: OcrWord[]): OcrWord[][] {
  const h = median(cell.map((w) => w.h)) || 20;
  const sorted = [...cell].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: OcrWord[][] = [];
  for (const w of sorted) {
    const line = lines.find((l) => Math.abs(l[0].y + l[0].h / 2 - (w.y + w.h / 2)) < h * 0.6);
    if (line) line.push(w);
    else lines.push([w]);
  }
  for (const l of lines) l.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => a[0].y - b[0].y);
}

/** วันที่ — ทนตัวอ่านพลาดเครื่องหมาย "/" (เช่น 0910/2026) */
function dateOf(s: string): { d: number; m: number; y: number } | null {
  const m = s.match(/^(\d{1,2})\/?(\d{2})\/(\d{4})$/) ?? s.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (!m) return null;
  let y = Number(m[3]);
  if (y > 2400) y -= 543;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2020 || y > 2100) return null;
  return { d, m: mo, y };
}

/**
 * ตัวเลขน้ำหนักที่เป็นไปได้จากคำหนึ่งคำ
 * ตัวอ่านพลาดได้บ้าง เช่น "16,080" → "416,080" หรือ "22,650" → "22650"
 * จึงเสนอหลายค่า (เต็ม / ตัดหลักแรกทิ้ง) แล้วให้สูตร ออก − เข้า = สุทธิ เป็นคนตัดสิน
 */
function weightCandidates(s: string): number[] {
  const t = s.replace(/[^\d,.]/g, "");
  const m = t.match(/^(\d{1,3})[,.]?(\d{3})$/);
  const out: number[] = [];
  if (m) out.push(Number(m[1] + m[2]));
  const long = t.replace(/[,.]/g, "");
  if (/^\d{6}$/.test(long) && /[,.]\d{3}$/.test(t)) out.push(Number(long.slice(1)));
  return out.filter((n) => n >= 1000 && n <= 90000);
}

/** อ่านตั๋ว 1 ใบจากคำในช่องของมัน */
export function readCell(cell: OcrWord[], f: TicketFormat): LocalTicket {
  const lines = linesOf(cell);
  // Tesseract แยกอักษรไทยเป็นทีละตัว ("น า ย อ น ุ ศร") → ต่อคำที่อยู่ชิดกัน เว้นวรรคเฉพาะช่องว่างจริงในรูป
  const h = median(cell.map((w) => w.h)) || 20;
  const lineText = (l: OcrWord[]) =>
    l.map((w, i) => (i > 0 && w.x - (l[i - 1].x + l[i - 1].w) > h * 0.45 ? " " : "") + w.text).join("");
  const text = lines.map(lineText).join("\n");

  const ticketNo = cell.find((w) => validTicketNo(w.text, f))?.text ?? null;

  // วัน-เวลา: วันที่กับเวลาอยู่บรรทัดเดียวกัน · ใบหนึ่งมี 2 ชุด (เข้า บน · ออก ล่าง)
  // บรรทัดที่อ่านวันที่หลุด แต่เวลายังอยู่ → ใช้วันที่ของอีกชุดในใบเดียวกัน (ถ้ามีวันเดียว)
  const stamps: { date: { d: number; m: number; y: number } | null; time: string; y: number }[] = [];
  for (const l of lines) {
    const time = l.find((w) => /^\d{1,2}:\d{2}:\d{2}$/.test(w.text));
    if (!time) continue;
    const date = l.map((w) => dateOf(w.text)).find(Boolean) ?? null;
    stamps.push({ date, time: time.text, y: time.y });
  }
  const knownDates = stamps.map((s) => s.date).filter((d): d is NonNullable<typeof d> => !!d);
  const toDate = (s: (typeof stamps)[number], fallback: (typeof knownDates)[number] | undefined) => {
    const d = s.date ?? fallback;
    if (!d) return null;
    const [hh, mm, ss] = s.time.split(":").map(Number);
    if (hh > 23 || mm > 59 || ss > 59) return null;
    return new Date(Date.UTC(d.y, d.m - 1, d.d, hh, mm, ss));
  };
  const fill = knownDates.length > 0 && new Set(knownDates.map((d) => `${d.y}-${d.m}-${d.d}`)).size === 1 ? knownDates[0] : undefined;
  const entryAt = stamps[0] ? toDate(stamps[0], fill) : null;
  let exitAt = stamps[1] ? toDate(stamps[1], fill) : null;
  // ออกข้ามเที่ยงคืนแล้ววันที่ของบรรทัดออกหลุด — ไม่รู้วันจริง ไม่เดา
  if (entryAt && exitAt && exitAt < entryAt) exitAt = null;

  // น้ำหนัก: ตัวเลขใต้บรรทัดเวลาเข้า เรียงบน→ล่าง = เข้า · ออก · สุทธิ — ต้องลบกันลงตัว
  const nums: { v: number[]; y: number }[] = [];
  for (const l of lines) {
    if (stamps.length && l[0].y < stamps[0].y - 5) continue;
    for (const w of l) {
      if (/[:\/]/.test(w.text)) continue;
      const v = weightCandidates(w.text);
      if (v.length) nums.push({ v, y: w.y });
    }
  }
  let weight: { in: number; out: number; net: number } | null = null;
  const found: { in: number; out: number; net: number }[] = [];
  for (let i = 0; i < nums.length; i++)
    for (let j = i + 1; j < nums.length; j++)
      for (let k = j + 1; k < nums.length; k++)
        for (const a of nums[i].v)
          for (const b of nums[j].v)
            for (const c of nums[k].v)
              if (b - a === c && a >= 5000 && a <= 20000 && c >= 5000) found.push({ in: a, out: b, net: c });
  const uniq = new Map(found.map((f) => [`${f.in}|${f.out}|${f.net}`, f]));
  if (uniq.size === 1) weight = [...uniq.values()][0];

  // ชื่ออยู่บรรทัดเหนือ "พนักงานขับรถ" — ตัดคำว่าพนักงานฯ ออกก่อน กันติดมากับนามสกุล
  const drv = text
    .replace(/พนักงาน\S*/g, "\n")
    .match(/(นางสาว|นาย|นาง|น\.ส\.)[ \t]*([ก-๏]+)(?:[ \t]+([ก-๏]+))?/);
  // ทะเบียน "70-2308" — ไม่ใช่เบอร์โทร "038-773-069"
  const plate = text.match(/(?<![\d-])(\d{2})-(\d{4})(?![\d-])/);

  return {
    ticketNo,
    entryAt,
    exitAt,
    weightIn: weight?.in ?? null,
    weightOut: weight?.out ?? null,
    weightNet: weight?.net ?? null,
    driverName: drv ? `${drv[1]}${drv[2]}${drv[3] ? ` ${drv[3]}` : ""}` : null,
    plate: plate ? `${plate[1]}-${plate[2]}` : null,
    text,
  };
}

/**
 * อ่านข้อความในช่องของแม่แบบ (วัน-เวลา + น้ำหนัก) — ตัวเลขล้วน บรรทัดละค่า เรียงบนลงล่าง
 *   วัน-เวลาเข้า · นน.เข้า · วัน-เวลาออก · นน.ออก · นน.สุทธิ
 * เศษจากป้ายข้างเคียง (เช่น "2" จาก "[2]") ไม่เป็นไร — หยิบค่าท้ายบรรทัด และน้ำหนักต้องผ่านสูตรเสมอ
 */
export function parseTemplateText(
  text: string,
  f: TicketFormat,
): { entryAt: Date | null; exitAt: Date | null; weight: { in: number; out: number; net: number } | null } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const dts: Date[] = [];
  const nums: number[] = [];
  for (const l of lines) {
    const d = l.match(/(\d{1,2})\D{0,2}(\d{1,2})[\/-](\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
    if (d) {
      let y = Number(d[3]);
      if (y > 2400) y -= 543;
      const [dd, mm, hh, mi, ss] = [d[1], d[2], d[4], d[5], d[6]].map(Number);
      const dt = new Date(Date.UTC(y, mm - 1, dd, hh, mi, ss));
      if (mm >= 1 && mm <= 12 && dt.getUTCDate() === dd && hh < 24 && mi < 60 && ss < 60 && y >= 2020 && y <= 2100) dts.push(dt);
      continue;
    }
    // ลูกน้ำหายได้ ("18890") — รับเฉพาะ 5 หลัก (ตัวเลขสั้นกว่านั้นที่ไม่มีลูกน้ำ อาจเป็นเศษของค่าที่อ่านขาด)
    const w = [...l.matchAll(/(?<!\d)(\d{1,2},\d{3}|\d{5})(?![\d,])/g)].map((m) => Number(m[1].replace(",", "")));
    if (w.length) nums.push(w[w.length - 1]);
  }
  // กรอบมีทั้งวัน-เวลาเข้าและออกเสมอ — อ่านได้ตัวเดียว ไม่รู้ว่าเป็นเข้าหรือออก จึงไม่ใช้ (ไม่เดา)
  const entryAt = dts.length >= 2 ? dts[0] : null;
  let exitAt: Date | null = dts.length >= 2 ? dts[1] : null;
  if (entryAt && exitAt && (exitAt < entryAt || exitAt.getTime() - entryAt.getTime() > 48 * 3600 * 1000)) exitAt = null;
  // เข้า → ออก → สุทธิ ตามลำดับบนตั๋ว · ต้องได้ชุดเดียวที่ลบกันลงตัว
  const found: { in: number; out: number; net: number }[] = [];
  for (let i = 0; i < nums.length; i++)
    for (let j = i + 1; j < nums.length; j++)
      for (let k = j + 1; k < nums.length; k++) {
        const [a, b, c] = [nums[i], nums[j], nums[k]];
        if ((f.netRule === "inMinusOut" ? a - b : b - a) === c && c > 0) found.push({ in: a, out: b, net: c });
      }
  const uniq = new Map(found.map((x) => [`${x.in}|${x.out}|${x.net}`, x]));
  return { entryAt, exitAt, weight: uniq.size === 1 ? [...uniq.values()][0] : null };
}

type Box = NonNullable<TicketFormat["template"]>["boxes"][number];

/**
 * ขนาดของแบบฟอร์มในรูป = ความสูงกลางของป้ายภาษาอังกฤษที่อ่านได้ชัด (เช่น "Weight", "Gate")
 * ป้ายพิมพ์มากับฟอร์ม ขนาดคงที่ทุกใบ — วัดจากรูปจริง 4 รูป (สแกน + มือถือ) ต่างกันไม่เกิน 3%
 */
export function labelUnit(words: OcrWord[]): number | null {
  const hs = words.filter((w) => w.conf > 60 && /^[A-Za-z]{3,}/.test(w.text)).map((w) => w.h);
  return hs.length >= 10 ? median(hs) : null;
}

/**
 * ลบเส้นบรรทัดที่พิมพ์บนกระดาษ (เส้นยาวแนวนอน) แล้วทำเป็นขาว-ดำ
 * ตั๋วพิมพ์ตัวเลขทับเส้น (เช่น นน.สุทธิ ของ จี เจ สตีล) ตัวอ่านเห็นเส้นแล้วอ่านตัวเลขบรรทัดนั้นไม่ออก
 * แถวที่มืดเกินครึ่งความกว้าง = เส้น (ตัวเลขไม่มีทางยาวขนาดนั้น) → ลบทิ้งพร้อมแถวข้างๆ
 */
function removeRuledLines(gray: Buffer, width: number, height: number): Buffer {
  const sorted = [...gray].sort((a, b) => a - b);
  const paper = sorted[Math.floor(sorted.length * 0.6)];
  const dark = paper * 0.6;
  const isLine: boolean[] = [];
  for (let y = 0; y < height; y++) {
    let n = 0;
    for (let x = 0; x < width; x++) if (gray[y * width + x] < dark) n++;
    isLine.push(n / width > 0.45);
  }
  const out = Buffer.alloc(width * height, 255);
  for (let y = 0; y < height; y++) {
    if (isLine[y] || isLine[y - 1] || isLine[y + 1]) continue;
    for (let x = 0; x < width; x++) if (gray[y * width + x] < dark) out[y * width + x] = 0;
  }
  return out;
}

/**
 * ตัดกรอบแม่แบบของตั๋วใบหนึ่งออกมาอ่าน
 *   "plain" = ขยาย 2 เท่า + ขาวดำ (แบบเดิม)
 *   "clean" = ลบเส้นบรรทัดก่อน — ใช้เติมเฉพาะค่าที่แบบเดิมอ่านไม่ได้
 */
async function readTemplate(imagePath: string, anchor: OcrWord, u: number, t: Box, variant: "plain" | "clean"): Promise<string | null> {
  // โหลดตัวตัดรูปตอนใช้ — เครื่องไหนโหลดไม่ได้ ข้ามไปใช้ผลอ่านทั้งช่องแบบเดิม (หน้าเว็บต้องไม่ล่มเพราะเรื่องนี้)
  let sharp: typeof import("sharp");
  try {
    sharp = (await import("sharp")).default;
  } catch {
    return null;
  }
  const meta = await sharp(imagePath).metadata();
  const left = Math.max(0, Math.round(anchor.x + t.dx * u));
  const top = Math.max(0, Math.round(anchor.y + t.dy * u));
  const width = Math.min(Math.round(t.w * u), (meta.width ?? 0) - left);
  const height = Math.min(Math.round(t.h * u), (meta.height ?? 0) - top);
  if (width < 20 || height < 20) return null; // ช่องหลุดขอบรูป
  const file = join(tmpdir(), `tpl-${process.pid}-${anchor.x}-${anchor.y}.png`);
  try {
    const crop = sharp(imagePath).extract({ left, top, width, height });
    if (variant === "plain") {
      await crop.resize({ width: width * 2 }).grayscale().normalise().toFile(file);
    } else {
      const { data, info } = await crop.grayscale().normalise().raw().toBuffer({ resolveWithObject: true });
      await sharp(removeRuledLines(data, info.width, info.height), { raw: { width: info.width, height: info.height, channels: 1 } })
        .resize({ width: info.width * 2 })
        .png()
        .toFile(file);
    }
    const bin = process.env.TESSERACT_PATH || "tesseract";
    const { stdout } = await run(bin, [file, "stdout", "--psm", "6", "-c", "tessedit_char_whitelist=0123456789,/-: "], {
      timeout: 60_000,
      env: { ...process.env, OMP_THREAD_LIMIT: process.env.OMP_THREAD_LIMIT || "2" },
    });
    return stdout;
  } finally {
    rmSync(file, { force: true });
  }
}

/**
 * คำที่มีเลขที่ตั๋วติดเส้นใต้/เครื่องหมายมาด้วย (เช่น ":____R261000615") → ตัดให้เหลือเลขที่
 * พร้อมขยับกรอบของคำตามสัดส่วนตัวอักษร — จุดยึดของแม่แบบจึงยังตรงตำแหน่ง
 */
export function ticketWord(w: OcrWord, f: TicketFormat): OcrWord | null {
  if (validTicketNo(w.text, f)) return w;
  const raw = String(w.text);
  const m = raw.match(/^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/);
  if (!m || !validTicketNo(m[2], f)) return null;
  // เครื่องหมาย/เส้นใต้แคบกว่าตัวเลข (วัดจากรูปจริง ~0.8 เท่า)
  const per = w.w / (m[2].length + 0.8 * (m[1].length + m[3].length));
  return { ...w, text: m[2], x: Math.round(w.x + per * 0.8 * m[1].length), w: Math.round(per * m[2].length) };
}

/**
 * ทั้งรูป → ตั๋วทีละใบ (ตามตำแหน่งจริงในรูป)
 * แบบตั๋วที่มีแม่แบบตำแหน่ง: วัน-เวลา/น้ำหนัก อ่านจากช่องแม่แบบก่อน (แม่นกว่า) · ช่องอ่านไม่ผ่าน = ใช้ผลอ่านทั้งช่องตั๋วแบบเดิม
 * ยังขาดอยู่ → ลองกรอบเดิมอีกรอบแบบลบเส้นบรรทัด (เติมเฉพาะช่องที่ยังว่าง ไม่ทับค่าที่อ่านได้แล้ว)
 */
export async function readPhotoLocally(imagePath: string, f: TicketFormat): Promise<LocalTicket[]> {
  const words = (await tesseractWords(imagePath)).map((w) => ticketWord(w, f) ?? w);
  const tickets = splitByPosition(words, f).map((cell) => readCell(cell, f));
  for (const t of tickets) {
    // ตั๋วที่ไม่มีชื่อคนขับ — ชื่อที่ตัวอ่านเจอเป็นของอย่างอื่น (เช่น ลายเซ็นผู้รับ) ไม่ใช้
    if (!f.hasDriverName) t.driverName = null;
  }
  if (!f.template) return tickets;
  const formUnit = f.template.unit === "label" ? labelUnit(words) : null;
  for (const t of tickets) {
    // ตั๋วที่มีค่าของคนอื่นปนในใบ (เช่น Port In/Out ของท่าเรือในหมายเหตุ) — อ่านทั้งช่องแยกไม่ออกว่าค่าไหนของใบนี้
    // ใช้เฉพาะกรอบแม่แบบเท่านั้น กรอบอ่านไม่ได้ = ว่าง (ให้ Google หรือคนเติม) ไม่หยิบค่าผิดตัว
    if (f.skipLabels) {
      t.entryAt = t.exitAt = null;
      t.weightIn = t.weightOut = t.weightNet = null;
    }
    const anchor = t.ticketNo ? words.find((w) => w.text === t.ticketNo) : undefined;
    const u = f.template.unit === "label" ? formUnit : anchor?.w;
    if (!anchor || !u) continue;
    for (const variant of ["plain", "clean"] as const) {
      // รอบลบเส้น: ทำเมื่อยังขาดวัน-เวลา หรือน้ำหนัก เท่านั้น
      if (variant === "clean" && t.entryAt && t.weightNet != null) break;
      const parts: string[] = [];
      for (const box of f.template.boxes) {
        const s = await readTemplate(imagePath, anchor, u, box, variant);
        if (s) parts.push(s.trim());
      }
      if (!parts.length) continue;
      const text = parts.join("\n");
      const r = parseTemplateText(text, f);
      const fill = variant === "plain"; // รอบแรกใช้แทนผลอ่านทั้งช่อง (แม่นกว่า) · รอบลบเส้นเติมเฉพาะที่ว่าง
      if (r.entryAt && (fill || !t.entryAt)) t.entryAt = r.entryAt;
      if (r.exitAt && (fill || !t.exitAt)) t.exitAt = r.exitAt;
      if (r.weight && (fill || t.weightNet == null)) {
        t.weightIn = r.weight.in;
        t.weightOut = r.weight.out;
        t.weightNet = r.weight.net;
      }
      t.text += `\n— ช่องแม่แบบ${variant === "clean" ? " (ลบเส้น)" : ""} —\n${text}`;
    }
  }
  return tickets;
}
