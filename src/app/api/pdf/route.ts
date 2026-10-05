/**
 * ทำไฟล์ PDF จริงจากหน้า /print/... ด้วย Chromium ในเครื่องเดียวกัน (NAS)
 *
 *   GET /api/pdf?path=/print/invoice/12
 *
 * ทำไมต้องใช้ Chromium: ให้ PDF ออกมาหน้าตาเดียวกับที่พิมพ์ทุกประการ (ฟอนต์ไทย สระ วรรณยุกต์
 * ขอบกระดาษ หัวตารางซ้ำทุกหน้า) ไลบรารีทำ PDF ทั่วไปวางสระไทยเพี้ยน
 *
 * ปลอดภัย: ต้องเข้าระบบก่อน · เปิดได้เฉพาะหน้าใต้ /print/ · ใช้คุกกี้ของคนที่ขอเอง
 * จึงเห็นได้เท่าที่คนนั้นมีสิทธิ์เห็น
 */

import { NextResponse, type NextRequest } from "next/server";
import { chromium } from "playwright-core";
import { SESSION_COOKIE, getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** ที่อยู่ Chromium — ในกล่อง NAS ตั้งไว้ใน Dockerfile */
const CHROMIUM = process.env.CHROMIUM_PATH || "/usr/bin/chromium";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ต้องเข้าระบบก่อน" }, { status: 401 });

  const path = req.nextUrl.searchParams.get("path") ?? "";
  if (!/^\/print\/[A-Za-z0-9/_\-?=&,.%]*$/.test(path) || path.includes("..")) {
    return NextResponse.json({ error: "ที่อยู่หน้าไม่ถูกต้อง" }, { status: 400 });
  }

  // เปิดหน้าจากในเครื่องเดียวกัน ไม่ผ่านพอร์ตภายนอก (บน NAS พอร์ตนอกกล่องคนละเลขกับในกล่อง)
  const base = `http://127.0.0.1:${process.env.PORT || 3000}`;
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? "";

  let browser;
  try {
    browser = await chromium.launch({
      executablePath: CHROMIUM,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    const context = await browser.newContext();
    await context.addCookies([{ name: SESSION_COOKIE, value: token, url: base }]);
    const page = await context.newPage();
    const res = await page.goto(base + path, { waitUntil: "networkidle", timeout: 60_000 });
    if (!res || !res.ok()) {
      return NextResponse.json({ error: `เปิดหน้าเอกสารไม่ได้ (${res?.status() ?? "?"})` }, { status: 502 });
    }
    // หน้าเอกสารบอกชื่อไฟล์ และจำนวนขาที่หาไม่เจอ (ต้องเตือน ห้ามเงียบ)
    const meta = await page.evaluate(() => {
      const el = document.querySelector(".invoice-page");
      return { fileName: el?.getAttribute("data-filename") ?? "document.pdf", missing: el?.getAttribute("data-missing") ?? "0" };
    });
    // รอให้รูปโลโก้โหลดครบก่อนพิมพ์ ไม่งั้นหัวกระดาษว่าง
    await page.evaluate(async () => {
      await Promise.all(
        Array.from(document.images).map((img) =>
          img.complete ? null : new Promise((r) => { img.onload = img.onerror = () => r(null); }),
        ),
      );
    });
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${meta.fileName}"`,
        "X-File-Name": meta.fileName,
        "X-Missing-Legs": meta.missing,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ไม่ทราบสาเหตุ";
    const hint = /Executable doesn't exist|ENOENT|spawn/.test(msg)
      ? "ยังไม่มีตัวสร้าง PDF ในเครื่อง — รัน sudo bash scripts/nas/tiamthep.sh update เพื่อลงให้"
      : msg.slice(0, 300);
    return NextResponse.json({ error: `ทำ PDF ไม่สำเร็จ — ${hint}` }, { status: 500 });
  } finally {
    await browser?.close().catch(() => {});
  }
}
