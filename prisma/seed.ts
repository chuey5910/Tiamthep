/**
 * นำเข้าข้อมูลตั้งต้นจากไฟล์ Excel เดิมของบริษัท (data/seed-data.json)
 *
 *   npm run db:seed              → ข้อมูลจริง + ข้อมูลตัวอย่างสำหรับลองใช้
 *   npm run db:seed -- --no-demo → ข้อมูลจริงอย่างเดียว (ใช้ตอนเริ่มใช้งานจริง)
 */

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { join } from "node:path";

const prisma = new PrismaClient();
const WITH_DEMO = !process.argv.includes("--no-demo");

type Raw = {
  lookups: Record<string, string[]>;
  settings: { fuelBuybackRate: number; docAlertDays: number };
  vehicles: {
    plate: string;
    vehicleType: string | null;
    ownerType: string | null;
    outsourceName: string | null;
    startDate: string | null;
    taxDue: string | null;
    actDue: string | null;
    insuranceDue: string | null;
    cargoInsDue: string | null;
  }[];
  drivers: {
    code: string;
    firstName: string | null;
    lastName: string | null;
    nationalId: string | null;
    licenseNo: string | null;
    licenseType: string | null;
    licenseExpiry: string | null;
  }[];
  pairings: {
    headPlate: string;
    trailerPlate: string;
    driverCode: string | null;
    effectiveDate: string | null;
    note: string | null;
  }[];
  customers: {
    code: string | null;
    name: string;
    address: string | null;
    taxId: string | null;
    branch: string | null;
    creditDays: number | null;
    billingDay: string | null;
    fuelPriceBasis: string | null;
    weightBasis: string | null;
  }[];
  priceBands: string[];
  routes: {
    origin: string;
    destination: string;
    vehicleType: string | null;
    priceUnit: string | null;
    distanceKm: number | null;
    targetKmPerL: number | null;
    allowance: number | null;
    customerPrices: (number | null)[];
    outsourcePrices: (number | null)[];
  }[];
  fuelPrices: { date: string; price: number }[];
  inventoryItems: {
    code: string;
    name: string | null;
    category: string | null;
    unit: string | null;
    trackingType: string | null;
    reorderPoint: number | null;
    note: string | null;
  }[];
};

const raw: Raw = JSON.parse(readFileSync(join(process.cwd(), "data", "seed-data.json"), "utf8"));

// ── ตัวช่วย ────────────────────────────────────────────────

/** ทะเบียนในไฟล์เดิมมีคำต่อท้ายไม่เหมือนกัน ("70-1779 ลบ.") ต้องตัดให้เหลือเลขทะเบียนล้วน */
function normPlate(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/\s*ลบ\.?\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** รองรับทั้ง ค.ศ. และ พ.ศ. รวมถึงรูปแบบ DD/MM/YYYY */
function parseDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s || s === "-") return null;

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return mk(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return mk(+m[3], +m[2], +m[1]);
  return null;
}

function mk(y: number, m: number, d: number): Date | null {
  if (y > 2400) y -= 543; // พ.ศ. → ค.ศ.
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return isNaN(dt.getTime()) ? null : dt;
}

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));


const scryptAsync = promisify(scrypt) as (p: string, s: string, k: number) => Promise<Buffer>;

/** สร้างบัญชีผู้ดูแลคนแรก ถ้ายังไม่มีผู้ใช้ในระบบเลย */
async function ensureFirstAdmin() {
  if ((await prisma.user.count()) > 0) {
    console.log("  ผู้ใช้: มีอยู่แล้ว ไม่แตะต้อง");
    return;
  }

  // ปกติไม่สร้างบัญชีจากตรงนี้ — เปิดเว็บครั้งแรกแล้วหน้าสมัครจะตั้ง
  // บัญชีแรกเป็นผู้ดูแลให้เอง จะสร้างจาก command line ก็ต่อเมื่อ
  // ตั้ง ADMIN_USERNAME หรือ ADMIN_PASSWORD_INIT ไว้ชัดเจนเท่านั้น
  if (!process.env.ADMIN_USERNAME && !process.env.ADMIN_PASSWORD_INIT) {
    console.log("  ผู้ใช้: ยังไม่มี — เปิดเว็บครั้งแรกจะให้ตั้งบัญชีผู้ดูแลเอง");
    return;
  }

  const username = (process.env.ADMIN_USERNAME || "admin").toLowerCase();
  // ไม่ตั้งรหัสตายตัวไว้ในโค้ด — สุ่มให้แล้วพิมพ์ออกมาครั้งเดียว
  const password = process.env.ADMIN_PASSWORD_INIT || randomBytes(6).toString("base64url") + "7a";

  const salt = randomBytes(16).toString("hex");
  const key = await scryptAsync(password, salt, 64);

  await prisma.user.create({
    data: {
      username,
      name: "ผู้ดูแลระบบ",
      passwordHash: `scrypt$${salt}$${key.toString("hex")}`,
      role: "ADMIN",
      status: "ACTIVE",
      approvedAt: new Date(),
      note: "บัญชีผู้ดูแลคนแรก สร้างตอนติดตั้งระบบ",
    },
  });

  console.log("\n  ┌──────────────────────────────────────────────");
  console.log("  │ บัญชีผู้ดูแลระบบคนแรก");
  console.log(`  │   ชื่อผู้ใช้ : ${username}`);
  console.log(`  │   รหัสผ่าน  : ${password}`);
  console.log("  │ เข้าระบบแล้วเปลี่ยนรหัสผ่านทันที");
  console.log("  └──────────────────────────────────────────────\n");
}

async function main() {
  console.log("ล้างข้อมูลเดิม…");
  // ลบจากตารางลูกไปหาตารางแม่ เพื่อไม่ให้ติด foreign key
  await prisma.scrapPart.deleteMany();
  await prisma.vendorBill.deleteMany();
  await prisma.stockOut.deleteMany();
  await prisma.stockIn.deleteMany();
  await prisma.serialUnit.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.fuelBonusOverride.deleteMany();
  await prisma.fuelEntry.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.travelAdvance.deleteMany();
  await prisma.job.deleteMany();
  await prisma.routePrice.deleteMany();
  await prisma.route.deleteMany();
  await prisma.priceBand.deleteMany();
  await prisma.vehiclePairing.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.fuelPriceBasis.deleteMany();
  await prisma.fuelPrice.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.partner.deleteMany();
  await prisma.lookup.deleteMany();
  await prisma.setting.deleteMany();
  // ไม่ลบ User / Session / LoginLog — บัญชีผู้ใช้และประวัติการเข้าระบบต้องอยู่รอด seed

  // ── ตั้งค่าระบบ ──
  await prisma.setting.createMany({
    data: [
      { key: "companyName", value: "บริษัท เทียมเทพ ขนส่ง จำกัด" },
      { key: "companyTaxId", value: "0165544000165" },
      { key: "fuelBuybackRate", value: String(raw.settings.fuelBuybackRate ?? 30) },
      { key: "docAlertDays", value: String(raw.settings.docAlertDays ?? 30) },
    ],
  });

  // ── รายการ dropdown ──
  const vehicleTypes = new Set<string>(raw.lookups.vehicleTypes ?? []);
  for (const v of raw.vehicles) if (v.vehicleType) vehicleTypes.add(v.vehicleType.trim());
  for (const r of raw.routes) if (r.vehicleType) vehicleTypes.add(r.vehicleType.trim());

  const lookups: { kind: string; value: string; sort: number }[] = [];
  const addLookup = (kind: string, values: Iterable<string>) => {
    let i = 0;
    const seen = new Set<string>();
    for (const v of values) {
      const t = String(v).trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      lookups.push({ kind, value: t, sort: i++ });
    }
  };
  addLookup("vehicleType", vehicleTypes);
  addLookup("expenseCategory", raw.lookups.expenseCategories ?? []);
  addLookup("location", [
    ...(raw.lookups.locations ?? []),
    ...raw.routes.flatMap((r) => [r.origin, r.destination]),
  ]);
  addLookup("supplier", raw.lookups.suppliers ?? []);
  addLookup("unit", ["เส้น", "ลูก", "ลิตร", "ชิ้น", "ครั้ง", "ชุด", "กิโลกรัม"]);
  addLookup("cargoType", ["ปูนซีเมนต์ผง", "เม็ดพลาสติก", "เศษเหล็ก", "ปุ๋ย", "หินปูน", "อื่นๆ"]);
  await prisma.lookup.createMany({ data: lookups });
  console.log(`  รายการตัวเลือก ${lookups.length} รายการ`);

  // ── รถร่วม ──
  const partnerNames = new Set<string>(raw.lookups.outsources ?? []);
  for (const v of raw.vehicles) if (v.outsourceName) partnerNames.add(v.outsourceName.trim());
  const partners = new Map<string, number>();
  for (const name of partnerNames) {
    const p = await prisma.partner.create({ data: { name } });
    partners.set(name, p.id);
  }
  console.log(`  รถร่วม ${partners.size} ราย`);

  // ── ข้อมูลรถ ──
  const seenPlate = new Set<string>();
  const vehicleRows = [];
  for (const v of raw.vehicles) {
    const plate = normPlate(v.plate);
    if (!plate || seenPlate.has(plate)) continue;
    seenPlate.add(plate);
    const ownerType = v.ownerType?.trim() === "รถร่วม" ? "รถร่วม" : "รถบริษัท";
    vehicleRows.push({
      plate,
      vehicleType: v.vehicleType?.trim() || "ไม่ระบุ",
      ownerType,
      partnerId: v.outsourceName ? partners.get(v.outsourceName.trim()) ?? null : null,
      startDate: parseDate(v.startDate),
      taxDueDate: parseDate(v.taxDue),
      actDueDate: parseDate(v.actDue),
      insuranceDue: parseDate(v.insuranceDue),
      cargoInsDue: parseDate(v.cargoInsDue),
    });
  }
  await prisma.vehicle.createMany({ data: vehicleRows });
  console.log(`  รถ ${vehicleRows.length} คัน`);

  // ── พนักงานขับรถ ──
  const seenDriver = new Set<string>();
  const driverRows = [];
  for (const d of raw.drivers) {
    const code = d.code?.trim();
    if (!code || seenDriver.has(code)) continue;
    seenDriver.add(code);
    driverRows.push({
      code,
      firstName: d.firstName?.trim() || "-",
      lastName: d.lastName?.trim() || "",
      nationalId: d.nationalId ? String(d.nationalId).trim() : null,
      licenseNo: d.licenseNo?.trim() || null,
      licenseType: d.licenseType?.trim() || null,
      licenseExpiry: parseDate(d.licenseExpiry),
    });
  }
  // พขร. ที่โผล่ในตารางจับคู่แต่ยังไม่มีในทะเบียนพนักงาน
  for (const p of raw.pairings) {
    const c = p.driverCode?.trim();
    if (c && !seenDriver.has(c)) {
      seenDriver.add(c);
      driverRows.push({
        code: c,
        firstName: "(รอกรอกชื่อ)",
        lastName: "",
        nationalId: null,
        licenseNo: null,
        licenseType: null,
        licenseExpiry: null,
      });
    }
  }
  await prisma.driver.createMany({ data: driverRows });
  console.log(`  พนักงานขับรถ ${driverRows.length} คน`);

  // ── จับคู่รถ ──
  const pairRows = [];
  for (const p of raw.pairings) {
    const head = normPlate(p.headPlate);
    if (!head) continue;
    pairRows.push({
      headPlate: head,
      trailerPlate: normPlate(p.trailerPlate),
      driverCode: p.driverCode?.trim() && seenDriver.has(p.driverCode.trim()) ? p.driverCode.trim() : null,
      effectiveDate: parseDate(p.effectiveDate) ?? utc(2026, 1, 1),
      note: p.note?.trim() || null,
    });
  }
  await prisma.vehiclePairing.createMany({ data: pairRows });
  console.log(`  การจับคู่รถ ${pairRows.length} คู่`);

  // ── เกณฑ์ราคาน้ำมันของลูกค้า ──
  // ครอบคลุมทุกแบบที่บริษัทใช้อยู่ และเพิ่มแบบใหม่ได้เองในหน้าตั้งค่า
  const basisDefs = [
    { name: "ราคาวันขนส่ง", kind: "SHIP_DATE", note: "ใช้ราคาประกาศ ณ วันที่ขนจริง" },
    { name: "ราคาวันที่ 1", kind: "DAY_OF_MONTH", dayOfMonth: 1, note: "ราคาวันที่ 1 ของเดือนที่ขน" },
    { name: "ราคาวันที่ 25", kind: "DAY_OF_MONTH", dayOfMonth: 25, note: "ราคาวันที่ 25 ของเดือนที่ขน" },
    {
      name: "ราคาวันที่ 1 และวันที่ 16",
      kind: "SEMI_MONTHLY",
      note: "งานวันที่ 1-15 ใช้ราคาวันที่ 1 / งานวันที่ 16 เป็นต้นไปใช้ราคาวันที่ 16",
    },
    {
      name: "เฉลี่ย 16-15 (ใช้เดือนถัดไป)",
      kind: "AVERAGE",
      startDay: 16,
      endDay: 15,
      monthOffset: 1,
      note: "เฉลี่ยราคาวันที่ 16 ของเดือนก่อนหน้า ถึงวันที่ 15 ของเดือนที่แล้ว มาใช้กับงานเดือนนี้",
    },
    {
      name: "เฉลี่ย 1-31 (เดือนเดียวกัน)",
      kind: "AVERAGE",
      startDay: 1,
      endDay: 31,
      monthOffset: 0,
      note: "เฉลี่ยทั้งเดือนที่ขน",
    },
    {
      name: "เฉลี่ย 20-19 (ใช้เดือนถัดไป)",
      kind: "AVERAGE",
      startDay: 20,
      endDay: 19,
      monthOffset: 1,
      note: "เฉลี่ยวันที่ 20 ถึงวันที่ 19 ของเดือนก่อนหน้า มาใช้กับงานเดือนนี้",
    },
  ];
  const basisId = new Map<string, number>();
  for (const b of basisDefs) {
    const created = await prisma.fuelPriceBasis.create({
      data: {
        name: b.name,
        kind: b.kind,
        dayOfMonth: b.dayOfMonth ?? null,
        startDay: b.startDay ?? null,
        endDay: b.endDay ?? null,
        monthOffset: b.monthOffset ?? 0,
        note: b.note,
      },
    });
    basisId.set(b.name, created.id);
  }

  /** ข้อความในไฟล์เดิมสะกดไม่เหมือนกันทุกแถว จับให้เข้าเกณฑ์มาตรฐาน */
  function matchBasis(text: string | null): number | null {
    if (!text) return basisId.get("ราคาวันขนส่ง") ?? null;
    const t = text.replace(/\s+/g, "").trim();
    if (t.includes("วันขนส่ง")) return basisId.get("ราคาวันขนส่ง")!;
    if (t.includes("วันที่1และวันที่16")) return basisId.get("ราคาวันที่ 1 และวันที่ 16")!;
    if (t.includes("16-15")) return basisId.get("เฉลี่ย 16-15 (ใช้เดือนถัดไป)")!;
    if (t.includes("20-19")) return basisId.get("เฉลี่ย 20-19 (ใช้เดือนถัดไป)")!;
    if (t.includes("1-31")) return basisId.get("เฉลี่ย 1-31 (เดือนเดียวกัน)")!;
    const day = t.match(/วันที่(\d{1,2})/);
    if (day) {
      const n = +day[1];
      if (n === 1) return basisId.get("ราคาวันที่ 1")!;
      if (n === 25) return basisId.get("ราคาวันที่ 25")!;
    }
    return basisId.get("ราคาวันขนส่ง")!;
  }

  // ── ลูกค้า ──
  const usedCodes = new Set<string>();
  let autoCode = 1;
  const customerRows = [];
  for (const c of raw.customers) {
    let code = c.code?.trim();
    if (!code || usedCodes.has(code)) {
      do {
        code = `C${String(autoCode++).padStart(3, "0")}`;
      } while (usedCodes.has(code));
    }
    usedCodes.add(code);
    customerRows.push({
      code,
      name: c.name.trim(),
      address: c.address?.trim() || null,
      taxId: c.taxId ? String(c.taxId).trim() : null,
      branch: c.branch ? String(c.branch).trim() : null,
      creditDays: Number(c.creditDays ?? 30) || 0,
      billingDay: c.billingDay?.trim() || null,
      fuelBasisId: matchBasis(c.fuelPriceBasis),
      weightBasis: c.weightBasis?.trim() === "น้ำหนักต้นทาง" ? "น้ำหนักต้นทาง" : "น้ำหนักปลายทาง",
      billingDateBasis: "วันที่ขึ้นสินค้า",
    });
  }
  await prisma.customer.createMany({ data: customerRows });
  console.log(`  ลูกค้า ${customerRows.length} ราย`);

  // ── ช่วงราคาน้ำมัน ──
  const bandIds: number[] = [];
  for (let i = 0; i < raw.priceBands.length; i++) {
    const label = raw.priceBands[i];
    const m = label.match(/([\d.]+)\s*-\s*([\d.]+)/);
    const minPrice = m ? Math.round((parseFloat(m[1]) - 0.01) * 100) / 100 : 28 + i;
    const maxPrice = m ? parseFloat(m[2]) : 29 + i;
    const b = await prisma.priceBand.create({ data: { label, minPrice, maxPrice, sort: i } });
    bandIds.push(b.id);
  }
  console.log(`  ช่วงราคาน้ำมัน ${bandIds.length} ช่วง`);

  // ── เส้นทาง + ราคา ──
  let routeCount = 0;
  let priceCount = 0;
  const seenRoute = new Set<string>();
  for (const r of raw.routes) {
    const key = `${r.origin}|${r.destination}|${r.vehicleType ?? ""}`;
    if (seenRoute.has(key)) continue;
    seenRoute.add(key);
    const route = await prisma.route.create({
      data: {
        origin: r.origin.trim(),
        destination: r.destination.trim(),
        vehicleType: r.vehicleType?.trim() || "ไม่ระบุ",
        priceUnit: r.priceUnit?.trim() === "ต่อตัน" ? "ต่อตัน" : "ต่อเที่ยว",
        distanceKm: r.distanceKm ?? null,
        targetKmPerL: r.targetKmPerL ?? null,
        allowance: r.allowance ?? 0,
      },
    });
    routeCount++;
    const data = bandIds
      .map((bandId, i) => ({
        routeId: route.id,
        bandId,
        customerPrice: r.customerPrices[i] ?? null,
        outsourcePrice: r.outsourcePrices[i] ?? null,
      }))
      .filter((p) => p.customerPrice != null || p.outsourcePrice != null);
    if (data.length) {
      await prisma.routePrice.createMany({ data });
      priceCount += data.length;
    }
  }
  console.log(`  เส้นทาง ${routeCount} เส้นทาง (${priceCount} ราคา)`);

  // ── ราคาน้ำมันอ้างอิง ──
  const fpRows = raw.fuelPrices
    .map((f) => ({ date: parseDate(f.date), price: f.price }))
    .filter((f): f is { date: Date; price: number } => f.date != null);
  await prisma.fuelPrice.createMany({ data: fpRows });
  console.log(`  ราคาน้ำมันอ้างอิง ${fpRows.length} รายการ`);

  // ── สินค้าคงคลัง ──
  const itemRows = raw.inventoryItems.map((it) => ({
    code: it.code.trim(),
    name: it.name?.trim() || it.code.trim(),
    category: it.category?.trim() || null,
    unit: it.unit?.trim() || "ชิ้น",
    trackingType: it.trackingType?.trim() === "รายชิ้น" ? "รายชิ้น" : "จำนวน",
    reorderPoint: Number(it.reorderPoint ?? 0) || 0,
    note: it.note?.trim() || null,
  }));
  if (itemRows.length) await prisma.inventoryItem.createMany({ data: itemRows });
  console.log(`  สินค้าคงคลัง ${itemRows.length} รายการ`);

  await ensureFirstAdmin();

  if (WITH_DEMO) await seedDemo();

  console.log("\nเสร็จแล้ว");
}

/**
 * ข้อมูลตัวอย่างสำหรับลองใช้งาน — ลบทิ้งได้ที่หน้า "ตั้งค่า → ล้างข้อมูลตัวอย่าง"
 * หรือรัน `npm run db:seed -- --no-demo` เพื่อเริ่มจากฐานข้อมูลจริงอย่างเดียว
 */
async function seedDemo() {
  const routes = await prisma.route.findMany();
  if (routes.length === 0) {
    console.log("  (ข้ามข้อมูลตัวอย่าง: ยังไม่มีเส้นทางในระบบ)");
    return;
  }

  // ใช้รถที่มีประเภทตรงกับเส้นทางที่มีราคา เพื่อให้ตัวอย่างคำนวณออกจริง
  const routeTypes = new Set(routes.map((r) => r.vehicleType));
  let vehicles = await prisma.vehicle.findMany({
    where: { ownerType: "รถบริษัท", vehicleType: { in: [...routeTypes] } },
    take: 3,
  });
  if (vehicles.length === 0) {
    // ไม่มีรถประเภทที่ตรงกับเส้นทาง — สร้างรถตัวอย่างขึ้นมาให้ตรง
    const t = [...routeTypes][0];
    vehicles = [
      await prisma.vehicle.create({
        data: { plate: "ตัวอย่าง-01", vehicleType: t, ownerType: "รถบริษัท", startDate: new Date(Date.UTC(2021, 0, 15)) },
      }),
    ];
  }

  const partner = await prisma.partner.findFirst();
  let outsourceVehicle = await prisma.vehicle.findFirst({
    where: { ownerType: "รถร่วม", vehicleType: { in: [...routeTypes] } },
  });
  if (!outsourceVehicle && partner) {
    outsourceVehicle = await prisma.vehicle.create({
      data: {
        plate: "ตัวอย่าง-99",
        vehicleType: [...routeTypes][0],
        ownerType: "รถร่วม",
        partnerId: partner.id,
      },
    });
  }

  const drivers = await prisma.driver.findMany({ take: 3 });
  const customers = await prisma.customer.findMany({ take: 3 });
  if (!customers.length || !drivers.length) return;

  // จับคู่รถให้รถตัวอย่าง เพื่อให้ระบบหา พขร. เจอ
  for (let i = 0; i < vehicles.length; i++) {
    await prisma.vehiclePairing.create({
      data: {
        headPlate: vehicles[i].plate,
        trailerPlate: "",
        driverCode: drivers[i % drivers.length].code,
        effectiveDate: new Date(Date.UTC(2026, 0, 1)),
        note: "ข้อมูลตัวอย่าง",
      },
    });
  }
  if (outsourceVehicle) {
    await prisma.vehiclePairing.create({
      data: {
        headPlate: outsourceVehicle.plate,
        trailerPlate: "",
        driverCode: null,
        effectiveDate: new Date(Date.UTC(2026, 0, 1)),
        note: "ข้อมูลตัวอย่าง (รถร่วม)",
      },
    });
  }

  const YEAR = 2026;
  const MONTH = 7;
  let jobs = 0;
  let fuelRows = 0;

  for (let day = 1; day <= 25; day++) {
    const date = new Date(Date.UTC(YEAR, MONTH - 1, day));
    if (date.getUTCDay() === 0) continue; // เว้นวันอาทิตย์

    const fleet = outsourceVehicle ? [...vehicles, outsourceVehicle] : vehicles;
    for (let vi = 0; vi < fleet.length; vi++) {
      const v = fleet[vi];
      const outbound = routes[(day + vi) % routes.length];
      // หาเส้นทางขากลับ (ปลายทาง → ต้นทาง) ถ้ามี
      const inbound =
        routes.find(
          (r) => r.origin === outbound.destination && r.destination === outbound.origin && r.vehicleType === outbound.vehicleType,
        ) ?? null;

      const tripCode = `${v.plate}-${String(day).padStart(2, "0")}${String(MONTH).padStart(2, "0")}${YEAR}`;
      const customer = customers[(day + vi) % customers.length];

      const legs = inbound ? [outbound, inbound] : [outbound];
      for (const leg of legs) {
        if (leg.vehicleType !== v.vehicleType) continue;
        await prisma.job.create({
          data: {
            loadDate: date,
            unloadDate: date,
            tripCode,
            headPlate: v.plate,
            trailerPlate: null,
            driverCode: null,
            customerId: customer.id,
            origin: leg.origin,
            destination: leg.destination,
            weightOrigin: 30 + ((day * 7 + vi) % 5),
            weightDest: 29.5 + ((day * 7 + vi) % 5),
            cargoType: "ปูนซีเมนต์ผง",
            routeId: leg.id,
            note: "ข้อมูลตัวอย่าง",
          },
        });
        jobs++;
      }

      // เติมน้ำมันตอนจบรอบ — ใช้ประมาณ 92-104% ของเป้าหมาย เพื่อให้เห็นทั้งได้และไม่ได้เงินพิเศษ
      const kpi = legs.reduce(
        (a, r) => a + (r.distanceKm && r.targetKmPerL ? r.distanceKm / r.targetKmPerL : 0),
        0,
      );
      if (kpi > 0) {
        const factor = 0.92 + ((day * 13 + vi * 7) % 13) / 100;
        const litres = Math.round(kpi * factor * 10) / 10;
        const pricePerL = 35.2;
        await prisma.fuelEntry.create({
          data: {
            date,
            source: vi % 2 === 0 ? "ปั๊มบริษัท" : "FleetCard",
            plate: v.plate,
            driverCode: v.ownerType === "รถร่วม" ? null : drivers[vi % drivers.length].code,
            litres,
            pricePerL,
            amount: Math.round(litres * pricePerL * 100) / 100,
            refNo: `DEMO-${v.plate}-${day}`,
            note: "ข้อมูลตัวอย่าง",
          },
        });
        fuelRows++;
      }

      // เงินเดินทางจ่ายก่อนออกงานทุกวัน + ค่าทางด่วนที่ พขร. สำรองจ่าย
      if (v.ownerType !== "รถร่วม") {
        await prisma.travelAdvance.create({
          data: {
            date,
            plate: v.plate,
            driverCode: drivers[vi % drivers.length].code,
            advance: 500,
            toll: day % 3 === 0 ? 250 : 0,
            note: "ข้อมูลตัวอย่าง",
          },
        });
      }
    }
  }

  // ค่าใช้จ่ายตัวอย่าง
  const suppliers = await prisma.lookup.findMany({ where: { kind: "supplier" } });
  const cats = await prisma.lookup.findMany({ where: { kind: "expenseCategory" } });
  const sampleExpenses = [
    { day: 8, cat: "ค่ายาง", detail: "ยางใหม่ 2 เส้น", unitPrice: 8500, qty: 2, unit: "เส้น" },
    { day: 12, cat: "ซ่อมบำรุง", detail: "เปลี่ยนผ้าเบรก", unitPrice: 4500, qty: 1, unit: "ครั้ง" },
    { day: 18, cat: "ค่าปรับ", detail: "ใบสั่งความเร็ว", unitPrice: 500, qty: 1, unit: "ครั้ง" },
    { day: 20, cat: "ซ่อมบำรุง", detail: "เปลี่ยนน้ำมันเครื่อง", unitPrice: 3200, qty: 1, unit: "ครั้ง" },
  ];
  for (let i = 0; i < sampleExpenses.length; i++) {
    const e = sampleExpenses[i];
    const cat = cats.find((c) => c.value === e.cat)?.value ?? cats[0]?.value ?? "อื่นๆ";
    await prisma.expense.create({
      data: {
        date: new Date(Date.UTC(YEAR, MONTH - 1, e.day)),
        plate: vehicles[i % vehicles.length].plate,
        driverCode: drivers[i % drivers.length].code,
        supplier: suppliers[i % Math.max(1, suppliers.length)]?.value ?? null,
        category: cat,
        detail: e.detail,
        unitPrice: e.unitPrice,
        qty: e.qty,
        unit: e.unit,
        amount: e.unitPrice * e.qty,
        note: "ข้อมูลตัวอย่าง",
      },
    });
  }
  // ค่าใช้จ่ายส่วนกลาง (ไม่ผูกทะเบียน)
  await prisma.expense.create({
    data: {
      date: new Date(Date.UTC(YEAR, MONTH - 1, 25)),
      category: "เงินเดือนสำนักงาน",
      detail: "เงินเดือนพนักงานสำนักงาน",
      unitPrice: 120000,
      qty: 1,
      unit: "เดือน",
      amount: 120000,
      note: "ข้อมูลตัวอย่าง",
    },
  });

  console.log(`  ข้อมูลตัวอย่าง: งาน ${jobs} ขา, เติมน้ำมัน ${fuelRows} ครั้ง`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
