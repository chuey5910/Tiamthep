/**
 * นำเข้าเส้นทาง + เบี้ยเลี้ยง จากไฟล์ "รายการค่าเบี้ยเลี้ยง_ค่าเที่ยว"
 * (ข้อมูลถูกดึงมาเก็บไว้ที่ data/allowance-routes.json แล้ว)
 *
 *   npm run routes:import
 *
 * กติกาที่เคาะร่วมกับออฟฟิศ (27 ส.ค. 2569):
 *  • "ราคาต่อเที่ยว" ในไฟล์ = เบี้ยเลี้ยงจ่ายคนขับต่อเที่ยว → ลงช่อง allowance
 *  • ชื่อที่สะกดสองแบบ ใช้: "ไทยเปเปอร์มิลล์" และ "ท่าเรือ สยามคอมเมอเชียล"
 *  • แถวที่ไม่ระบุประเภทรถ = "รถดั๊มพ์"
 *  • จำนวนเชื้อเพลิง (ลิตร) → แปลงเป็นอัตราสิ้นเปลืองเป้าหมาย กม./ลิตร (= ระยะทาง ÷ ลิตร)
 *
 * รันซ้ำได้เสมอ: ใช้ upsert ตามคีย์ (ต้นทาง+ปลายทาง+ประเภทรถ) — ไม่มีทางเกิดเส้นทางซ้ำ
 * รอบถัดไปถ้าไฟล์ต้นทางแก้ราคา รันซ้ำจะอัปเดตค่าตามให้
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "./load-env";

loadEnv();

type Row = {
  no: number;
  origin: string;
  dest: string;
  perTrip: number;
  perTon: number;
  km: number;
  litre: number;
  vtype: string;
};

// ชื่อที่สะกดหลายแบบ — บังคับให้เหลือแบบเดียวตามที่ออฟฟิศเคาะ
function fixName(s: string): string {
  let out = s.trim().replace(/\s+/g, " ");
  out = out.replace(/ไทย เปเปอร์ มิลล์/g, "ไทยเปเปอร์มิลล์");
  if (out === "สยามคอมเมอเชียล") out = "ท่าเรือ สยามคอมเมอเชียล";
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const { prisma } = await import("../src/lib/prisma");

  const rows = JSON.parse(
    readFileSync(join(process.cwd(), "data", "allowance-routes.json"), "utf8"),
  ) as Row[];

  let created = 0;
  let updated = 0;
  const warnings: string[] = [];

  for (const r of rows) {
    const origin = fixName(r.origin);
    const destination = fixName(r.dest);
    const vehicleType = r.vtype.trim() || "รถดั๊มพ์";

    if (!origin || !destination) {
      warnings.push(`แถว ${r.no}: ต้นทาง/ปลายทางว่าง — ข้าม`);
      continue;
    }

    // เบี้ยเลี้ยงต่อตัน (มี 1 เส้นทาง) — เว็บคิดเบี้ยเลี้ยงต่อเที่ยว จึงเก็บเป็นหมายเหตุให้ออฟฟิศคิดเอง
    let allowance = r.perTrip;
    let note: string | null = null;
    if (r.perTrip === 0 && r.perTon > 0) {
      allowance = 0;
      note = `เบี้ยเลี้ยงคิดต่อตัน ${r.perTon} บาท/ตัน — ออฟฟิศคำนวณจ่ายเอง (ระบบคิดเบี้ยเลี้ยงต่อเที่ยว)`;
      warnings.push(`แถว ${r.no}: ${origin} → ${destination} เบี้ยเลี้ยงต่อตัน — เก็บไว้ในหมายเหตุของเส้นทาง`);
    }

    const distanceKm = r.km > 0 ? r.km : null;
    const targetKmPerL = r.km > 0 && r.litre > 0 ? round2(r.km / r.litre) : null;

    const data = { allowance, distanceKm, targetKmPerL, note, active: true };
    const found = await prisma.route.findUnique({
      where: { origin_destination_vehicleType: { origin, destination, vehicleType } },
    });
    if (found) {
      await prisma.route.update({ where: { id: found.id }, data });
      updated++;
    } else {
      await prisma.route.create({ data: { origin, destination, vehicleType, ...data } });
      created++;
    }
  }

  // เติมประเภทรถที่ยังไม่มีในรายการตัวเลือก (dropdown หน้าข้อมูลรถ/เส้นทาง)
  const types = [...new Set(rows.map((r) => r.vtype.trim() || "รถดั๊มพ์"))];
  for (const value of types) {
    await prisma.lookup.upsert({
      where: { kind_value: { kind: "vehicleType", value } },
      update: {},
      create: { kind: "vehicleType", value },
    });
  }

  console.log(`นำเข้าเส้นทางเรียบร้อย: เพิ่มใหม่ ${created} · อัปเดตของเดิม ${updated} · จากทั้งหมด ${rows.length} แถว`);
  for (const w of warnings) console.log("  ⚠ " + w);
  console.log("\nขั้นถัดไป: เปิดเว็บหน้า ฐานข้อมูล → เส้นทาง ระยะทาง ราคา เพื่อตรวจ");
  console.log("แล้วไปหน้า งานจากไลน์ กด «ดึงงานเข้าเว็บ» 1 ครั้ง เพื่ออัปเดตรายชื่อสถานที่ในชีต");
}

main().then(() => process.exit());
