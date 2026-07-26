import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { ClearDemoButton, SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await prisma.setting.findMany();
  const values = Object.fromEntries(settings.map((s) => [s.key, s.value]));

  const demoCount = await prisma.job.count({ where: { note: "ข้อมูลตัวอย่าง" } });

  return (
    <>
      <PageHeader title="ตั้งค่าระบบ" subtitle="ค่าที่มีผลกับการคำนวณทั้งระบบ" />

      <Card title="ข้อมูลบริษัทและค่าคงที่" className="mb-4">
        <SettingsForm values={values} />
      </Card>

      <Card title="หน้าตั้งค่าอื่น" className="mb-4">
        <ul className="space-y-2 text-[13px]">
          <li>
            <Link href="/settings/fuel-basis" className="font-semibold text-brand-700 hover:underline">
              เกณฑ์ราคาน้ำมันของลูกค้า →
            </Link>
            <p className="text-slate-500">
              สูตรหาราคาน้ำมันอ้างอิง (ราคาวันที่ 1 / เฉลี่ย 16-15 / เฉลี่ย 1-31 / ราคาวันขนส่ง ฯลฯ) — เพิ่มสูตรใหม่ได้เอง
            </p>
          </li>
          <li>
            <Link href="/settings/bands" className="font-semibold text-brand-700 hover:underline">
              ช่วงราคาน้ำมัน →
            </Link>
            <p className="text-slate-500">ขั้นราคาที่ใช้แบ่งราคาค่าบรรทุก (28.01-29.00, 29.01-30.00, …)</p>
          </li>
          <li>
            <Link href="/settings/lookups" className="font-semibold text-brand-700 hover:underline">
              รายการตัวเลือก →
            </Link>
            <p className="text-slate-500">ประเภทรถ ประเภทค่าใช้จ่าย สถานที่ ผู้ให้บริการ หน่วยนับ ประเภทสินค้า</p>
          </li>
        </ul>
      </Card>

      {demoCount > 0 && (
        <Card title="ข้อมูลตัวอย่าง" className="border-amber-300">
          <p className="mb-3 text-[13px] text-slate-600">
            ตอนนี้มีข้อมูลตัวอย่างอยู่ในระบบ <b>{demoCount} ขา</b> (พร้อมค่าน้ำมัน เงินเดินทาง และค่าใช้จ่ายที่คู่กัน)
            ใส่ไว้ให้ลองใช้งานและดูว่ารายงานหน้าตาเป็นอย่างไร
            <br />
            เมื่อพร้อมเริ่มใช้จริงแล้ว ให้กดลบทิ้ง — ข้อมูลจริงที่คุณกรอกเองจะไม่ถูกแตะ
          </p>
          <ClearDemoButton />
        </Card>
      )}
    </>
  );
}
