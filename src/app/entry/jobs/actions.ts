"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseDate } from "@/lib/date";
import { buildContext, resolveDriver, routeKey } from "@/lib/calc";

export type JobResult = { ok: boolean; error?: string };

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}
function numOrNull(form: FormData, key: string): number | null {
  const s = str(form, key);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function collect(form: FormData) {
  const loadDate = parseDate(str(form, "loadDate"));
  if (!loadDate) return { error: "กรุณากรอกวันที่ขึ้นสินค้า" as const };

  const headPlate = str(form, "headPlate");
  if (!headPlate) return { error: "กรุณาเลือกทะเบียนแม่" as const };

  const customerId = Number(str(form, "customerId"));
  if (!Number.isFinite(customerId) || customerId <= 0) return { error: "กรุณาเลือกลูกค้า" as const };

  const origin = str(form, "origin");
  const destination = str(form, "destination");
  if (!origin || !destination) return { error: "กรุณาเลือกต้นทางและปลายทาง" as const };
  if (origin === destination) return { error: "ต้นทางกับปลายทางต้องไม่ใช่ที่เดียวกัน" as const };

  const trailerPlate = str(form, "trailerPlate") || null;
  const unloadDate = parseDate(str(form, "unloadDate"));

  // รหัสรอบเว้นว่างได้ ระบบตั้งให้เอง — แต่ถ้าอยากรวมขาไป-ขากลับเป็นรอบเดียว ต้องกรอกให้ตรงกัน
  const tripCode =
    str(form, "tripCode") ||
    `${headPlate}-${loadDate.toISOString().slice(0, 10).split("-").reverse().join("")}`;

  const ctx = await buildContext();

  // บันทึกชื่อ พขร. ณ เวลานั้นไว้เลย เพื่อไม่ให้ข้อมูลย้อนหลังเปลี่ยนตามการจับคู่ใหม่
  const driverCode = resolveDriver(ctx.pairings, headPlate, trailerPlate, loadDate);

  const vehicle = ctx.vehicleByPlate.get(headPlate);
  const route = vehicle ? ctx.routeByKey.get(routeKey(origin, destination, vehicle.vehicleType)) ?? null : null;

  return {
    data: {
      loadDate,
      unloadDate: unloadDate ?? loadDate,
      tripCode,
      headPlate,
      trailerPlate,
      driverCode,
      customerId,
      origin,
      destination,
      weightOrigin: numOrNull(form, "weightOrigin"),
      weightDest: numOrNull(form, "weightDest"),
      cargoType: str(form, "cargoType") || null,
      routeId: route?.id ?? null,
      note: str(form, "note") || null,
    },
  };
}

export async function createJob(form: FormData): Promise<JobResult> {
  const res = await collect(form);
  if ("error" in res) return { ok: false, error: res.error };
  try {
    await prisma.job.create({ data: res.data });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateJob(id: number, form: FormData): Promise<JobResult> {
  const res = await collect(form);
  if ("error" in res) return { ok: false, error: res.error };
  try {
    await prisma.job.update({ where: { id }, data: res.data });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteJob(id: number): Promise<JobResult> {
  try {
    await prisma.job.delete({ where: { id } });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ลบไม่สำเร็จ" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * บันทึกขากลับจากขาไปที่เลือก — สลับต้นทาง/ปลายทาง ใช้รหัสรอบเดิม
 * นี่คือขั้นตอนที่ทำบ่อยที่สุดในแต่ละวัน จึงทำให้เหลือคลิกเดียว
 */
export async function createReturnLeg(jobId: number): Promise<JobResult> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return { ok: false, error: "ไม่พบงานต้นทาง" };

  const ctx = await buildContext();
  const vehicle = ctx.vehicleByPlate.get(job.headPlate);
  const route = vehicle
    ? ctx.routeByKey.get(routeKey(job.destination, job.origin, vehicle.vehicleType)) ?? null
    : null;

  try {
    await prisma.job.create({
      data: {
        loadDate: job.loadDate,
        unloadDate: job.unloadDate,
        tripCode: job.tripCode,
        headPlate: job.headPlate,
        trailerPlate: job.trailerPlate,
        driverCode: job.driverCode,
        customerId: job.customerId,
        origin: job.destination,
        destination: job.origin,
        weightOrigin: null,
        weightDest: null,
        cargoType: null,
        routeId: route?.id ?? null,
        note: "ขากลับ",
      },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
