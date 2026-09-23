/**
 * เครื่องคำนวณกลางของระบบ
 *
 * ทุกตัวเลขเงินในรายงานเดินผ่านไฟล์นี้ที่เดียว เพื่อให้ผลลัพธ์ตรงกันเสมอ
 * ไม่ว่าจะเปิดจากหน้ารายงานไหน
 */

import { prisma } from "./prisma";
import { addDays, daysInMonth, startOfDay, utcDate } from "./date";
import { isWeightPriced, priceMultiplier } from "./price-unit";
import { vehicleTypeKey } from "./vehicle-type";

// ─────────────────────────────────────────────────────────────
// ราคาน้ำมันอ้างอิง
// ─────────────────────────────────────────────────────────────

export type FuelPricePoint = { date: Date; price: number };

/**
 * ราคาน้ำมันของวันใดวันหนึ่ง = ราคาประกาศล่าสุดที่มีผลไม่เกินวันนั้น
 * (ประกาศเรียงจากเก่าไปใหม่)
 */
export function priceOnDate(prices: FuelPricePoint[], date: Date): number | null {
  const t = startOfDay(date).getTime();
  let found: number | null = null;
  for (const p of prices) {
    if (p.date.getTime() <= t) found = p.price;
    else break;
  }
  return found;
}

/** ค่าเฉลี่ยราคารายวันของทุกวันในช่วง (นับทุกวันปฏิทิน รวมวันที่ราคาไม่เปลี่ยน) */
export function averagePrice(prices: FuelPricePoint[], from: Date, to: Date): number | null {
  let sum = 0;
  let n = 0;
  for (let d = startOfDay(from); d.getTime() <= startOfDay(to).getTime(); d = addDays(d, 1)) {
    const p = priceOnDate(prices, d);
    if (p != null) {
      sum += p;
      n++;
    }
  }
  return n === 0 ? null : Math.round((sum / n) * 100) / 100;
}

export type BasisConfig = {
  id: number;
  name: string;
  kind: string;
  dayOfMonth: number | null;
  startDay: number | null;
  endDay: number | null;
  monthOffset: number;
};

/**
 * ราคาน้ำมันอ้างอิงที่ใช้คิดค่าบรรทุก ตามเกณฑ์ของลูกค้าแต่ละราย
 *
 * SHIP_DATE    — ราคา ณ วันที่ขนจริง
 * DAY_OF_MONTH — ราคาวันที่ N ของเดือน (เลื่อนเดือนตาม monthOffset)
 * SEMI_MONTHLY — วันที่ 1-15 ใช้ราคาวันที่ 1 / วันที่ 16 เป็นต้นไปใช้ราคาวันที่ 16
 * AVERAGE      — เฉลี่ยราคารายวันในช่วง startDay ถึง endDay
 *                ถ้า startDay > endDay คือคาบข้ามเดือน (เช่น 16→15)
 *                monthOffset = ถอยหลังกี่เดือนจากเดือนของงาน (1 = ใช้คาบที่จบเดือนก่อนหน้า)
 */
export function resolveReferencePrice(
  prices: FuelPricePoint[],
  basis: BasisConfig | null | undefined,
  jobDate: Date,
): number | null {
  if (!basis) return priceOnDate(prices, jobDate);

  const y = jobDate.getUTCFullYear();
  const m = jobDate.getUTCMonth() + 1; // 1-12

  switch (basis.kind) {
    case "SHIP_DATE":
      return priceOnDate(prices, jobDate);

    case "DAY_OF_MONTH": {
      const target = shiftMonth(y, m, -basis.monthOffset);
      const day = Math.min(basis.dayOfMonth ?? 1, daysInMonth(target.y, target.m));
      return priceOnDate(prices, utcDate(target.y, target.m, day));
    }

    case "SEMI_MONTHLY": {
      const target = shiftMonth(y, m, -basis.monthOffset);
      const day = jobDate.getUTCDate() <= 15 ? 1 : 16;
      return priceOnDate(prices, utcDate(target.y, target.m, day));
    }

    case "AVERAGE": {
      const startDay = basis.startDay ?? 1;
      const endDay = basis.endDay ?? 31;
      // เดือนที่คาบไปสิ้นสุด
      const endM = shiftMonth(y, m, -basis.monthOffset);
      // ถ้า startDay > endDay แปลว่าคาบเริ่มตั้งแต่เดือนก่อนหน้าเดือนที่สิ้นสุด
      const startM = startDay > endDay ? shiftMonth(endM.y, endM.m, -1) : endM;
      const from = utcDate(startM.y, startM.m, Math.min(startDay, daysInMonth(startM.y, startM.m)));
      const to = utcDate(endM.y, endM.m, Math.min(endDay, daysInMonth(endM.y, endM.m)));
      return averagePrice(prices, from, to);
    }

    default:
      return priceOnDate(prices, jobDate);
  }
}

function shiftMonth(y: number, m: number, delta: number): { y: number; m: number } {
  const total = y * 12 + (m - 1) + delta;
  return { y: Math.floor(total / 12), m: (total % 12) + 1 };
}

// ─────────────────────────────────────────────────────────────
// บริบทการคำนวณ — โหลดตารางอ้างอิงครั้งเดียว แล้วใช้ซ้ำทุกแถว
// ─────────────────────────────────────────────────────────────

export type CalcContext = Awaited<ReturnType<typeof buildContext>>;

export async function buildContext() {
  const [fuelPricesRaw, bands, routes, routePrices, customers, vehicles, pairings, settings] =
    await Promise.all([
      prisma.fuelPrice.findMany({ orderBy: { date: "asc" } }),
      prisma.priceBand.findMany({ orderBy: { minPrice: "asc" } }),
      prisma.route.findMany(),
      prisma.routePrice.findMany(),
      prisma.customer.findMany({ include: { fuelBasis: true } }),
      prisma.vehicle.findMany({ include: { partner: true } }),
      prisma.vehiclePairing.findMany({ orderBy: { effectiveDate: "asc" } }),
      prisma.setting.findMany(),
    ]);

  const fuelPrices: FuelPricePoint[] = fuelPricesRaw.map((f) => ({ date: f.date, price: f.price }));

  const routeById = new Map(routes.map((r) => [r.id, r]));

  // เส้นทางที่ "ถือว่าเป็นเส้นเดียวกัน" (ต้นทาง+ปลายทาง+ประเภทรถ หลังล้างคำสะกด) แต่มีหลายแถว
  // เกิดได้จากตอนที่ยังสะกด "หัวลาก"/"รถหัวลาก" คนละแบบ — สองแถวอาจตั้งหน่วย/ราคาไม่เหมือนกัน
  // ถ้าเลือกมั่วเงินจะผิด จึงเก็บรายการซ้ำไว้ให้ computeJob ขึ้นเตือน และเลือกแถวที่ "ใช้งาน + มีราคา" ก่อน
  const routesByKey = new Map<string, typeof routes>();
  for (const r of routes) {
    const k = routeKey(r.origin, r.destination, r.vehicleType);
    const list = routesByKey.get(k);
    if (list) list.push(r);
    else routesByKey.set(k, [r]);
  }
  const priceCount = new Map<number, number>();
  for (const p of routePrices) priceCount.set(p.routeId, (priceCount.get(p.routeId) ?? 0) + 1);
  const routeByKey = new Map<string, (typeof routes)[number]>();
  const routeTwins = new Map<number, number[]>();
  for (const [k, list] of routesByKey) {
    const sorted = [...list].sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        (priceCount.get(b.id) ?? 0) - (priceCount.get(a.id) ?? 0) ||
        a.id - b.id,
    );
    routeByKey.set(k, sorted[0]);
    if (list.length > 1) for (const r of list) routeTwins.set(r.id, list.map((x) => x.id));
  }

  // ราคาต่อเส้นทาง: routeId -> bandId -> ราคา
  const priceByRoute = new Map<number, Map<number, { customerPrice: number | null; outsourcePrice: number | null }>>();
  for (const p of routePrices) {
    let inner = priceByRoute.get(p.routeId);
    if (!inner) {
      inner = new Map();
      priceByRoute.set(p.routeId, inner);
    }
    inner.set(p.bandId, { customerPrice: p.customerPrice, outsourcePrice: p.outsourcePrice });
  }

  const customerById = new Map(customers.map((c) => [c.id, c]));
  const vehicleByPlate = new Map(vehicles.map((v) => [v.plate, v]));

  const settingMap = new Map(settings.map((s) => [s.key, s.value]));
  const fuelBuybackRate = Number(settingMap.get("fuelBuybackRate") ?? 30);
  const docAlertDays = Number(settingMap.get("docAlertDays") ?? 30);

  return {
    fuelPrices,
    bands,
    routes,
    routeById,
    routeByKey,
    routeTwins,
    priceByRoute,
    customers,
    customerById,
    vehicles,
    vehicleByPlate,
    pairings,
    fuelBuybackRate,
    docAlertDays,
  };
}

/**
 * คีย์จับคู่งาน ↔ เส้นทาง — ต้นทาง/ปลายทางเทียบแบบไม่สนช่องว่างซ้ำและตัวพิมพ์ใหญ่-เล็ก
 * ประเภทรถเทียบผ่าน vehicleTypeKey ("หัวลาก" กับ "รถหัวลาก" ถือว่าตัวเดียวกัน)
 */
export function routeKey(origin: string, destination: string, vehicleType: string): string {
  const place = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return `${place(origin)}|${place(destination)}|${vehicleTypeKey(vehicleType)}`;
}

/** หาช่วงราคาน้ำมันที่ราคานี้ตกอยู่ (นอกช่วงให้ใช้ช่วงต่ำสุด/สูงสุด) */
export function bandFor(
  bands: { id: number; minPrice: number; maxPrice: number; label: string }[],
  price: number | null,
) {
  if (price == null || bands.length === 0) return null;
  for (const b of bands) {
    if (price > b.minPrice && price <= b.maxPrice) return b;
  }
  if (price <= bands[0].minPrice) return bands[0];
  return bands[bands.length - 1];
}

/**
 * หา พขร. ที่ผูกกับคู่รถนี้ ณ วันที่ทำงาน
 * ใช้แถวที่ effectiveDate ใหม่ที่สุดแต่ไม่เกินวันทำงาน
 */
export function resolveDriver(
  pairings: { headPlate: string; trailerPlate: string; driverCode: string | null; effectiveDate: Date }[],
  headPlate: string,
  trailerPlate: string | null,
  onDate: Date,
): string | null {
  const head = headPlate.trim();
  const trailer = (trailerPlate ?? "").trim();
  const t = startOfDay(onDate).getTime();
  let best: { driverCode: string | null; effectiveDate: Date } | null = null;
  for (const p of pairings) {
    if (p.headPlate.trim() !== head) continue;
    if (p.trailerPlate.trim() !== trailer) continue;
    if (p.effectiveDate.getTime() > t) continue;
    if (!best || p.effectiveDate.getTime() >= best.effectiveDate.getTime()) best = p;
  }
  return best?.driverCode ?? null;
}

// ─────────────────────────────────────────────────────────────
// คำนวณรายขา
// ─────────────────────────────────────────────────────────────

export type JobInput = {
  id: number;
  loadDate: Date;
  unloadDate: Date | null;
  tripCode: string;
  headPlate: string;
  trailerPlate: string | null;
  driverCode: string | null;
  customerId: number;
  origin: string;
  destination: string;
  weightOrigin: number | null;
  weightDest: number | null;
  routeId: number | null;
  /** รหัสงานจากชีตสั่งงาน — ใช้จับคู่กับรายการเงินเดินทางของขานั้น */
  sheetRef?: string | null;
};

/** ช่องข้อมูลในตารางงานที่อาจมีปัญหา */
export type JobField =
  | "plate"
  | "driver"
  | "route"
  | "weight"
  | "price"
  | "revenue"
  | "outsource";

export type JobCalc = {
  jobId: number;
  /** วันที่ที่ใช้เรียกเก็บเงิน (ขึ้นหรือลงสินค้า ตามเกณฑ์ของลูกค้า) */
  billingDate: Date;
  driverCode: string | null;
  vehicleType: string | null;
  /** "รถบริษัท" | "รถร่วม" */
  ownerType: string;
  partnerName: string | null;
  routeId: number | null;
  routeFound: boolean;
  distanceKm: number | null;
  /** เป้าหมายลิตรที่ควรใช้ในขานี้ */
  kpiLitres: number | null;
  allowance: number;
  priceUnit: string;
  /** น้ำหนักที่ใช้คิดราคา ตามเกณฑ์ของลูกค้า (ตัน) */
  billingWeight: number;
  referencePrice: number | null;
  bandLabel: string | null;
  customerRate: number | null;
  /**
   * รายได้ค่าบรรทุกของขานี้ — เก็บเต็มความละเอียด ยังไม่ปัดเศษ
   *
   * ปัดทีละขาแล้วค่อยบวก จะทำให้ยอดรวมเพี้ยนจาก "ราคา × น้ำหนักรวม" ไปหลายสตางค์
   * (เศษของแต่ละขาสะสมกัน) จึงเก็บค่าเต็มไว้ แล้วปัดครั้งเดียวตอนรวมเสมอ
   * ตอนแสดงผลรายขา ตัวจัดรูปแบบ (money/baht) ปัดให้เองอยู่แล้ว
   */
  revenue: number;
  outsourceRate: number | null;
  /** ค่าจ้างที่ต้องจ่ายรถร่วมสำหรับขานี้ — เก็บเต็มความละเอียดเหมือน revenue */
  outsourcePay: number;
  /** คำเตือนที่ต้องให้ผู้ใช้แก้ไข */
  issues: string[];
  /** ช่องที่เป็นต้นเหตุของคำเตือน — หน้าเว็บใช้ระบายสีแดงเฉพาะช่องนั้น */
  badFields: JobField[];
};

export function computeJob(ctx: CalcContext, job: JobInput): JobCalc {
  const issues: string[] = [];
  const badFieldSet = new Set<JobField>();
  const flag = (field: JobField, message: string) => {
    badFieldSet.add(field);
    issues.push(message);
  };
  const customer = ctx.customerById.get(job.customerId);
  const vehicle = ctx.vehicleByPlate.get(job.headPlate.trim());

  const ownerType = vehicle?.ownerType ?? "รถบริษัท";
  const partnerName = vehicle?.partner?.name ?? null;
  const vehicleType = vehicle?.vehicleType ?? null;
  if (!vehicle) flag("plate", `ไม่พบทะเบียน ${job.headPlate} ในฐานข้อมูลรถ`);

  // วันที่เรียกเก็บเงิน: ส่วนใหญ่ใช้วันขึ้นสินค้า มีบางรายใช้วันลงสินค้า
  const billingDate =
    customer?.billingDateBasis === "วันที่ลงสินค้า" ? job.unloadDate ?? job.loadDate : job.loadDate;

  // เส้นทาง: ใช้ที่ผูกไว้กับงานตอนนำเข้า — แต่ต้องยังตรงกับ ต้นทาง+ปลายทาง+ประเภทรถ ของงานอยู่
  // ถ้าเส้นทางที่ผูกไว้ถูกแก้ชื่อไปแล้ว หรือมีอีกแถวที่ตรงกว่า ให้ใช้แถวที่ตรงกับงานจริง แล้วบอกให้รู้
  const jobKey = vehicleType ? routeKey(job.origin, job.destination, vehicleType) : null;
  const linked = job.routeId != null ? ctx.routeById.get(job.routeId) ?? null : null;
  const linkedMatches = !!linked && routeKey(linked.origin, linked.destination, linked.vehicleType) === jobKey;
  const byKey = jobKey ? ctx.routeByKey.get(jobKey) ?? null : null;
  let route = linkedMatches ? linked : byKey ?? linked;
  if (linked && !linkedMatches && byKey) {
    flag(
      "route",
      `งานผูกกับเส้นทาง #${linked.id} (${linked.origin} → ${linked.destination} ${linked.vehicleType}) ที่ไม่ตรงกับงานแล้ว — ระบบใช้ #${byKey.id} แทน`,
    );
  }
  if (!route) flag("route", `ไม่พบเส้นทาง ${job.origin} → ${job.destination} (${vehicleType ?? "ไม่ทราบประเภทรถ"})`);
  const twins = route ? ctx.routeTwins.get(route.id) : undefined;
  if (route && twins) {
    flag(
      "route",
      `เส้นทาง ${route.origin} → ${route.destination} มีซ้ำ ${twins.length} แถว (#${twins.join(", #")}) หน่วย/ราคาอาจต่างกัน — รวมให้เหลือแถวเดียวที่หน้าเส้นทาง (ตอนนี้ใช้ #${route.id})`,
    );
  }

  const driverCode =
    job.driverCode ?? resolveDriver(ctx.pairings, job.headPlate, job.trailerPlate, job.loadDate);
  if (!driverCode && ownerType !== "รถร่วม") {
    flag("driver", "ไม่พบข้อมูลจับคู่ พขร. — ให้เพิ่มแถวในหน้าจับคู่รถ");
  }

  // ราคาน้ำมันอ้างอิงตามเกณฑ์ของลูกค้า
  const referencePrice = resolveReferencePrice(ctx.fuelPrices, customer?.fuelBasis ?? null, billingDate);
  if (referencePrice == null) flag("price", "ยังไม่มีราคาน้ำมันอ้างอิงสำหรับช่วงวันที่นี้");

  const band = bandFor(ctx.bands, referencePrice);

  const priceUnit = route?.priceUnit ?? "ต่อเที่ยว";
  const weightBasis = customer?.weightBasis ?? "น้ำหนักปลายทาง";
  const billingWeight =
    (weightBasis === "น้ำหนักต้นทาง" ? job.weightOrigin : job.weightDest) ?? 0;
  if (isWeightPriced(priceUnit) && billingWeight <= 0) {
    flag("weight", `เส้นทางนี้คิดราคา${priceUnit} แต่ยังไม่ได้กรอก${weightBasis}`);
  }
  // น้ำหนักในระบบมีหน่วยเป็น "ตัน" — รถบรรทุกคันเดียวไม่มีทางเกิน 100 ตัน
  // ถ้าเกิน แปลว่ากรอกเป็นกิโลกรัมมา ปล่อยผ่านแล้วรายได้จะเพี้ยนพันเท่า
  if (billingWeight > 100) {
    flag(
      "weight",
      `${weightBasis} ${billingWeight.toLocaleString("th-TH")} ตัน สูงผิดปกติ — น่าจะกรอกเป็นกิโลกรัม (ควรเป็น ${(billingWeight / 1000).toLocaleString("th-TH")} ตัน) แก้ที่หน้าบันทึกงานขนส่ง หรือแก้ในชีตแล้วดึงงานใหม่`,
    );
  }

  const rp = route && band ? ctx.priceByRoute.get(route.id)?.get(band.id) ?? null : null;
  const customerRate = rp?.customerPrice ?? null;
  const outsourceRate = rp?.outsourcePrice ?? null;

  if (route && band && customerRate == null) {
    flag("revenue", `ยังไม่ได้ตั้งราคาลูกค้า ${route.origin} → ${route.destination} (${route.vehicleType}) ที่ช่วงน้ำมัน ${band.label}`);
  }

  // ── ตัวดักหน่วยคิดราคาตั้งผิด ──
  // ตั้งผิดแล้วเงินจะเพี้ยนหลักพันเท่าโดยไม่มีอะไรฟ้อง (เช่น 185 บาท/ตัน ถ้าตั้งเป็นต่อกิโลกรัม
  // จะกลายเป็น 5,699,850 บาท/ขา) จึงต้องทักทันทีที่ตัวเลขหลุดช่วงที่เป็นไปได้จริง
  if (route && customerRate != null && customerRate > 0 && billingWeight > 0) {
    const where = `${route.origin} → ${route.destination} (${route.vehicleType})`;
    const fix = `แก้ที่ ฐานข้อมูล → เส้นทาง ระยะทาง ราคา → เส้นทาง #${route.id}`;
    if (priceUnit === "ต่อกิโลกรัม" && customerRate >= 20) {
      flag(
        "revenue",
        `ราคา ${customerRate} บาท/กก. สูงผิดปกติ — ขานี้จะคิดเป็น ${round2(customerRate * billingWeight * 1000).toLocaleString("th-TH")} บาท · ${where} น่าจะเป็น «ต่อตัน» มากกว่า · ${fix}`,
      );
    } else if (priceUnit === "ต่อตัน" && customerRate < 20) {
      flag(
        "revenue",
        `ราคา ${customerRate} บาท/ตัน ต่ำผิดปกติ — ${where} น่าจะเป็น «ต่อกิโลกรัม» มากกว่า · ${fix}`,
      );
    } else if (priceUnit === "ต่อเที่ยว" && customerRate < 500) {
      flag(
        "revenue",
        `ราคา ${customerRate} บาทต่อเที่ยว ต่ำผิดปกติสำหรับงานที่มีน้ำหนัก ${billingWeight} ตัน — ${where} น่าจะคิดต่อตันหรือต่อกิโลกรัม · ${fix}`,
      );
    }
  }

  // น้ำหนักในระบบเป็นตัน — ราคาต่อกิโลกรัม (เช่น 0.261) คูณด้วยน้ำหนักเป็นกิโล
  const multiplier = priceMultiplier(priceUnit, billingWeight);
  // ไม่ปัดตรงนี้ — ปัดครั้งเดียวตอนรวม ไม่งั้นเศษของทุกขาจะสะสมจนยอดรวมเพี้ยน
  const revenue = customerRate != null ? customerRate * multiplier : 0;

  const isOutsource = ownerType === "รถร่วม";
  if (isOutsource && route && band && outsourceRate == null) {
    flag("outsource", `ยังไม่ได้ตั้งราคาจ่ายรถร่วม ${route.origin} → ${route.destination} (${route.vehicleType}) ที่ช่วงน้ำมัน ${band.label}`);
  }
  const outsourcePay = isOutsource && outsourceRate != null ? outsourceRate * multiplier : 0;

  const distanceKm = route?.distanceKm ?? null;
  const kpiLitres =
    route?.distanceKm != null && route.targetKmPerL != null && route.targetKmPerL > 0
      ? Math.round((route.distanceKm / route.targetKmPerL) * 10) / 10
      : null;

  // เบี้ยเลี้ยงจ่ายเฉพาะ พขร. ของบริษัท — รถร่วมรับเป็นค่าจ้างเหมาอยู่แล้ว
  const allowance = isOutsource ? 0 : route?.allowance ?? 0;

  return {
    jobId: job.id,
    billingDate,
    driverCode,
    vehicleType,
    ownerType,
    partnerName,
    routeId: route?.id ?? null,
    routeFound: !!route,
    distanceKm,
    kpiLitres,
    allowance,
    priceUnit,
    billingWeight,
    referencePrice,
    bandLabel: band?.label ?? null,
    customerRate,
    revenue,
    outsourceRate,
    outsourcePay,
    issues,
    badFields: [...badFieldSet],
  };
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ─────────────────────────────────────────────────────────────
// เงินพิเศษค่าน้ำมัน (ซื้อคืนน้ำมันที่ประหยัดได้)
// ─────────────────────────────────────────────────────────────

export type TripFuelBonus = {
  tripCode: string;
  plate: string;
  driverCode: string | null;
  /** วันที่จบรอบ = วันที่ล่าสุดของขาในรอบนี้ */
  endDate: Date;
  legs: number;
  /** เป้าหมายลิตรรวมทุกขาในรอบ */
  kpiLitres: number;
  /** ลิตรที่เติมจริง (ระบบดึงจากรายการเติมน้ำมัน) */
  autoLitres: number;
  /** ลิตรที่แก้ไขเอง (กรณีเติมคนละวันกับวันจบรอบ) */
  overrideLitres: number | null;
  /** ลิตรที่ใช้จริงในการคำนวณ */
  usedLitres: number;
  /** ลิตรที่ประหยัดได้ (ติดลบ = ใช้เกิน ไม่หักเงิน) */
  savedLitres: number;
  rate: number;
  /** เงินซื้อคืนที่ต้องจ่าย พขร. */
  bonus: number;
  isOutsource: boolean;
};

/**
 * สรุปเงินพิเศษค่าน้ำมันแยกตามรอบ
 *
 * แนวคิด: 1 รอบ (tripCode) มีหลายขา แต่ละขามีเป้าหมายลิตรของตัวเอง
 * เอาเป้าหมายทุกขามารวมกัน แล้วเทียบกับลิตรที่เติมจริงหลังจบรอบ
 * ประหยัดได้เท่าไหร่ บริษัทซื้อคืนลิตรละ (อัตราในหน้าตั้งค่า)
 * ใช้เกิน = ไม่ได้เงินพิเศษ แต่ไม่หักเงิน
 *
 * วิธีนี้แก้ปัญหาการนั่งจับคู่ตารางเองว่างาน A+B ควรใช้น้ำมันเท่าไหร่
 */
export function computeFuelBonuses(
  ctx: CalcContext,
  jobs: JobInput[],
  calcs: Map<number, JobCalc>,
  fuelEntries: { date: Date; plate: string; litres: number }[],
  overrides: Map<string, number>,
): TripFuelBonus[] {
  const trips = new Map<
    string,
    { plate: string; driverCode: string | null; endDate: Date; legs: number; kpi: number }
  >();

  for (const job of jobs) {
    if (!job.tripCode) continue;
    const c = calcs.get(job.id);
    const plate = job.headPlate.trim();
    const existing = trips.get(job.tripCode);
    if (!existing) {
      trips.set(job.tripCode, {
        plate,
        driverCode: c?.driverCode ?? null,
        endDate: job.loadDate,
        legs: 1,
        kpi: c?.kpiLitres ?? 0,
      });
    } else {
      existing.legs += 1;
      existing.kpi += c?.kpiLitres ?? 0;
      if (job.loadDate.getTime() > existing.endDate.getTime()) existing.endDate = job.loadDate;
      if (!existing.driverCode) existing.driverCode = c?.driverCode ?? null;
    }
  }

  // ลิตรที่เติม แยกตาม ทะเบียน+วัน
  const litresByPlateDay = new Map<string, number>();
  for (const f of fuelEntries) {
    const k = `${f.plate.trim()}|${startOfDay(f.date).getTime()}`;
    litresByPlateDay.set(k, (litresByPlateDay.get(k) ?? 0) + f.litres);
  }

  const out: TripFuelBonus[] = [];
  for (const [tripCode, t] of trips) {
    const vehicle = ctx.vehicleByPlate.get(t.plate);
    const isOutsource = vehicle?.ownerType === "รถร่วม";
    const autoLitres = litresByPlateDay.get(`${t.plate}|${startOfDay(t.endDate).getTime()}`) ?? 0;
    const overrideLitres = overrides.has(tripCode) ? overrides.get(tripCode)! : null;
    const usedLitres = overrideLitres ?? autoLitres;
    const savedLitres = round2(t.kpi - usedLitres);
    // ไม่มีข้อมูลการเติม = ยังสรุปรอบไม่ได้ / รถร่วมไม่มีเงินพิเศษ
    const eligible = usedLitres > 0 && !isOutsource;
    const bonus = eligible ? Math.round(Math.max(0, savedLitres) * ctx.fuelBuybackRate) : 0;

    out.push({
      tripCode,
      plate: t.plate,
      driverCode: t.driverCode,
      endDate: t.endDate,
      legs: t.legs,
      kpiLitres: round2(t.kpi),
      autoLitres: round2(autoLitres),
      overrideLitres,
      usedLitres: round2(usedLitres),
      savedLitres,
      rate: ctx.fuelBuybackRate,
      bonus,
      isOutsource,
    });
  }

  out.sort((a, b) => a.endDate.getTime() - b.endDate.getTime() || a.tripCode.localeCompare(b.tripCode));
  return out;
}
