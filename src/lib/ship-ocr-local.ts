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
import { promisify } from "node:util";

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

const TEN = /^\d{10}$/;
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
 * จุดยึด = เลขที่ตั๋ว 10 หลัก (อยู่มุมซ้ายบนของทุกใบ) → ได้ตำแหน่งคอลัมน์และแถวของตั๋ว
 * ใบที่อ่านเลขที่ไม่ออก ยังมีช่องของตัวเอง เพราะคอลัมน์/แถวมาจากใบอื่น
 */
export function splitByPosition(words: OcrWord[]): OcrWord[][] {
  const anchors = words.filter((w) => TEN.test(w.text));
  if (anchors.length === 0) return [];
  const h = median(words.map((w) => w.h)) || 20;
  const width = Math.max(...words.map((w) => w.x + w.w));
  const cols = clusters(anchors.map((a) => a.x), width * 0.2);
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
  return cells.filter((c) => c.some((w) => /\d{1,2}:\d{2}/.test(w.text) || TEN.test(w.text)));
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
export function readCell(cell: OcrWord[]): LocalTicket {
  const lines = linesOf(cell);
  // Tesseract แยกอักษรไทยเป็นทีละตัว ("น า ย อ น ุ ศร") → ต่อคำที่อยู่ชิดกัน เว้นวรรคเฉพาะช่องว่างจริงในรูป
  const h = median(cell.map((w) => w.h)) || 20;
  const lineText = (l: OcrWord[]) =>
    l.map((w, i) => (i > 0 && w.x - (l[i - 1].x + l[i - 1].w) > h * 0.45 ? " " : "") + w.text).join("");
  const text = lines.map(lineText).join("\n");

  const ticketNo = cell.find((w) => TEN.test(w.text))?.text ?? null;

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

/** ทั้งรูป → ตั๋วทีละใบ (ตามตำแหน่งจริงในรูป) */
export async function readPhotoLocally(imagePath: string): Promise<LocalTicket[]> {
  const words = await tesseractWords(imagePath);
  return splitByPosition(words).map(readCell);
}
