/**
 * เพิ่มเส้นทาง (ต้นทาง → ปลายทาง) เข้าระบบจากไฟล์ data/extra-routes.json
 *
 *   npm run routes:add                 เพิ่มเส้นทางตามไฟล์
 *   npm run routes:add -- --merge-dump รวมเส้นทางประเภท "รถดั๊มพ์" เข้ากับ "รถดั๊ม" ด้วย
 *
 * ต้องมีเส้นทางใหม่ก็เพิ่มบรรทัดในไฟล์ JSON แล้วรันซ้ำได้เลย รันกี่รอบก็ไม่เกิดเส้นทางซ้ำ
 * (คีย์คือ ต้นทาง + ปลายทาง + ประเภทรถ)
 *
 * ของเดิมไม่ถูกทับ: ถ้าเส้นทางมีอยู่แล้ว จะเติมเฉพาะช่องที่ยังว่าง
 * ออฟฟิศแก้ระยะทาง/เบี้ยเลี้ยงในเว็บไว้แล้ว รันซ้ำก็ไม่หาย
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "./load-env";

loadEnv();

type RouteInput = {
  origin: string;
  destination: string;
  vehicleType: string;
  distanceKm?: number | null;
  targetKmPerL?: number | null;
  allowance?: number | null;
  priceUnit?: string;
  note?: string | null;
};

/** ตัดช่องว่างซ้ำ ให้ชื่อสถานที่ที่พิมพ์ต่างกันเล็กน้อยกลายเป็นชื่อเดียวกัน */
const clean = (s: string) => s.trim().replace(/\s+/g, " ");

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const mergeDump = process.argv.includes("--merge-dump");

  const rows = JSON.parse(
    readFileSync(join(process.cwd(), "data", "extra-routes.json"), "utf8"),
  ) as RouteInput[];

  let created = 0;
  let filled = 0;
  let untouched = 0;
  const places = new Set<string>();
  const vehicleTypes = new Set<string>();

  for (const r of rows) {
    const origin = clean(r.origin);
    const destination = clean(r.destination);
    const vehicleType = clean(r.vehicleType);
    if (!origin || !destination || !vehicleType) {
      console.log(`  ⚠ ข้าม: ${origin || "(ว่าง)"} → ${destination || "(ว่าง)"} ข้อมูลไม่ครบ`);
      continue;
    }
    places.add(origin);
    places.add(destination);
    vehicleTypes.add(vehicleType);

    const found = await prisma.route.findUnique({
      where: { origin_destination_vehicleType: { origin, destination, vehicleType } },
    });

    if (!found) {
      await prisma.route.create({
        data: {
          origin,
          destination,
          vehicleType,
          distanceKm: r.distanceKm ?? null,
          targetKmPerL: r.targetKmPerL ?? null,
          allowance: r.allowance ?? 0,
          priceUnit: r.priceUnit ?? "ต่อเที่ยว",
          note: r.note ?? null,
          active: true,
        },
      });
      created++;
      console.log(`  + ${origin} → ${destination} (${vehicleType})`);
      continue;
    }

    // มีอยู่แล้ว — เติมเฉพาะช่องที่ยังว่าง ไม่ทับค่าที่ออฟฟิศตั้งไว้
    const patch: Record<string, unknown> = {};
    if (found.distanceKm == null && r.distanceKm != null) patch.distanceKm = r.distanceKm;
    if (found.targetKmPerL == null && r.targetKmPerL != null) patch.targetKmPerL = r.targetKmPerL;
    if (!found.allowance && r.allowance) patch.allowance = r.allowance;
    if (!found.active) patch.active = true;

    if (Object.keys(patch).length > 0) {
      await prisma.route.update({ where: { id: found.id }, data: patch });
      filled++;
      console.log(`  ~ ${origin} → ${destination} (${vehicleType}) — เติมช่องที่ว่าง`);
    } else {
      untouched++;
    }
  }

  // เติมชื่อสถานที่และประเภทรถเข้ารายการตัวเลือก (dropdown หน้าบันทึกงาน/เส้นทาง)
  for (const value of places) {
    await prisma.lookup.upsert({
      where: { kind_value: { kind: "location", value } },
      update: {},
      create: { kind: "location", value },
    });
  }
  for (const value of vehicleTypes) {
    await prisma.lookup.upsert({
      where: { kind_value: { kind: "vehicleType", value } },
      update: {},
      create: { kind: "vehicleType", value },
    });
  }

  console.log(
    `\nเส้นทาง: เพิ่มใหม่ ${created} · เติมข้อมูลที่ขาด ${filled} · มีครบอยู่แล้ว ${untouched}`,
  );
  console.log(`สถานที่ในรายการตัวเลือก: ตรวจ/เพิ่มแล้ว ${places.size} ชื่อ`);

  if (mergeDump) await mergeDumpType(prisma);
  else await reportDumpType(prisma);

  console.log("\nขั้นถัดไป: เปิดเว็บ ฐานข้อมูล → เส้นทาง ระยะทาง ราคา");
  console.log("เพื่อกรอกระยะทาง เบี้ยเลี้ยง และราคาตามช่วงน้ำมันของเส้นทางที่เพิ่งเพิ่ม");
}

/** แจ้งเตือนเฉยๆ ว่ามีเส้นทางที่ประเภทรถสะกดไม่ตรงกับทะเบียนรถจริง */
async function reportDumpType(prisma: typeof import("../src/lib/prisma").prisma) {
  const stale = await prisma.route.count({ where: { vehicleType: "รถดั๊มพ์" } });
  if (stale === 0) return;
  console.log(`\n⚠ พบเส้นทางประเภท "รถดั๊มพ์" อยู่ ${stale} เส้นทาง`);
  console.log('  แต่ทะเบียนรถในระบบใช้คำว่า "รถดั๊ม" (ไม่มี พ์) — เส้นทางกลุ่มนี้จึงไม่ถูกจับคู่กับงาน');
  console.log("  ถ้าต้องการรวมให้เป็นคำเดียวกัน ให้รัน:  npm run routes:add -- --merge-dump");
}

/** รวมเส้นทาง "รถดั๊มพ์" เข้ากับ "รถดั๊ม" ให้ตรงกับประเภทรถที่ใช้จริงในทะเบียนรถ */
async function mergeDumpType(prisma: typeof import("../src/lib/prisma").prisma) {
  const stale = await prisma.route.findMany({ where: { vehicleType: "รถดั๊มพ์" } });
  if (stale.length === 0) {
    console.log('\nไม่มีเส้นทางประเภท "รถดั๊มพ์" ค้างอยู่ — ข้ามการรวม');
    return;
  }

  let renamed = 0;
  let merged = 0;

  for (const old of stale) {
    const twin = await prisma.route.findUnique({
      where: {
        origin_destination_vehicleType: {
          origin: old.origin,
          destination: old.destination,
          vehicleType: "รถดั๊ม",
        },
      },
    });

    if (!twin) {
      // ไม่มีคู่แฝด — เปลี่ยนชื่อประเภทรถได้เลย ราคาที่ผูกไว้ติดไปด้วย
      await prisma.route.update({ where: { id: old.id }, data: { vehicleType: "รถดั๊ม" } });
      renamed++;
      continue;
    }

    // มีทั้งสองแบบ — ยกค่าที่ตัวใหม่ยังว่างมาจากตัวเก่า แล้วลบตัวเก่าทิ้ง
    const patch: Record<string, unknown> = {};
    if (twin.distanceKm == null && old.distanceKm != null) patch.distanceKm = old.distanceKm;
    if (twin.targetKmPerL == null && old.targetKmPerL != null) patch.targetKmPerL = old.targetKmPerL;
    if (!twin.allowance && old.allowance) patch.allowance = old.allowance;
    if (Object.keys(patch).length > 0) {
      await prisma.route.update({ where: { id: twin.id }, data: patch });
    }

    // ย้ายราคาตามช่วงน้ำมันที่ตัวใหม่ยังไม่มี แล้วค่อยลบเส้นทางเก่า
    const oldPrices = await prisma.routePrice.findMany({ where: { routeId: old.id } });
    for (const p of oldPrices) {
      const exists = await prisma.routePrice.findUnique({
        where: { routeId_bandId: { routeId: twin.id, bandId: p.bandId } },
      });
      if (!exists) {
        await prisma.routePrice.create({
          data: {
            routeId: twin.id,
            bandId: p.bandId,
            customerPrice: p.customerPrice,
            outsourcePrice: p.outsourcePrice,
          },
        });
      }
    }

    // ย้ายงานที่ผูกกับเส้นทางเก่ามาที่เส้นทางใหม่ ก่อนลบ
    await prisma.job.updateMany({ where: { routeId: old.id }, data: { routeId: twin.id } });
    await prisma.route.delete({ where: { id: old.id } });
    merged++;
  }

  await prisma.lookup.deleteMany({ where: { kind: "vehicleType", value: "รถดั๊มพ์" } });

  console.log(`\nรวมประเภทรถแล้ว: เปลี่ยนชื่อ ${renamed} เส้นทาง · รวมกับเส้นทางที่มีอยู่ ${merged} เส้นทาง`);
  console.log('  ตอนนี้เส้นทางทั้งหมดใช้ "รถดั๊ม" ตรงกับทะเบียนรถในระบบแล้ว');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .then(() => process.exit());
