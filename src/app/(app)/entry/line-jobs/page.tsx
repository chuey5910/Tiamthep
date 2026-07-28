import { Badge, Card, Empty, Formula, PageHeader } from "@/components/ui";
import { formatThaiDate } from "@/lib/date";
import { sheetConfig } from "@/lib/google-sheets";
import { num } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { ImportPanel } from "./ImportPanel";

export const dynamic = "force-dynamic";

/**
 * งานจากไลน์ — ปลายทางของชีตสั่งงานคนขับ
 * เว็บเป็นฝ่ายดึงข้อมูล (pull) เฉพาะแถวที่พนักงานตรวจและกด «ยืนยัน» ในชีตแล้วเท่านั้น
 */
export default async function LineJobsPage() {
  const cfg = sheetConfig();
  const configured = !("error" in cfg);

  const recent = await prisma.job.findMany({
    where: { sheetRef: { not: null } },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
    include: { customer: true },
  });

  return (
    <>
      <PageHeader
        title="งานจากไลน์ (ชีตสั่งงานคนขับ)"
        subtitle="ดึงงานที่พนักงานยืนยันแล้วจากชีตสั่งงาน เข้ามาบันทึกเป็นงานขนส่งในเว็บ"
      />

      <Formula>
        ขั้นตอน: ออฟฟิศกรอกงานในชีต → ไลน์บอทแจ้งคนขับล่วงหน้า 17:00 น. (เก็บตก 20:00 น.) → คนขับส่งรูปตั๋ว ระบบอ่านตัวเลขให้ →
        ออฟฟิศตรวจในชีตแล้วเปลี่ยนสถานะเป็น <b>«ยืนยัน»</b> → กดปุ่มด้านล่างเพื่อดึงเข้าเว็บ ·&nbsp;
        กดซ้ำกี่ครั้งก็ไม่เกิดงานซ้ำ เพราะระบบจำรหัสงานของทุกแถวไว้ ·&nbsp;
        แถวที่ข้อมูลไม่ครบหรือไม่ตรงกับฐานข้อมูล จะถูกตีกลับพร้อมเหตุผลในชีต ไม่มีการเดาข้อมูลแทน
      </Formula>

      {!configured && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          ⚠ {(cfg as { error: string }).error}
        </p>
      )}

      <Card title="ดึงข้อมูลจากชีต" className="mb-4">
        {configured ? (
          <ImportPanel />
        ) : (
          <p className="text-[13px] text-slate-500">
            ตั้งค่าใน .env ให้ครบก่อน จึงจะใช้งานได้ — ดูคู่มือติดตั้งในโฟลเดอร์ <code>line-bot/</code> ของโปรเจกต์
          </p>
        )}
      </Card>

      <Card title="งานที่ดึงมาจากชีตล่าสุด" bodyClass="p-0">
        {recent.length === 0 ? (
          <Empty>ยังไม่เคยดึงงานจากชีต</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>รหัสงานในชีต</th>
                  <th>วันที่</th>
                  <th>ทะเบียน</th>
                  <th>พขร.</th>
                  <th>ลูกค้า</th>
                  <th>เส้นทาง</th>
                  <th className="num">นน.ต้นทาง</th>
                  <th className="num">นน.ปลายทาง</th>
                  <th>เส้นทางในระบบ</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((j) => (
                  <tr key={j.id}>
                    <td className="font-mono text-[12px]">{j.sheetRef}</td>
                    <td className="whitespace-nowrap">{formatThaiDate(j.loadDate)}</td>
                    <td className="font-medium">{j.headPlate}</td>
                    <td>{j.driverCode ?? "-"}</td>
                    <td>{j.customer.code}</td>
                    <td>
                      {j.origin} → {j.destination}
                    </td>
                    <td className="num">{j.weightOrigin != null ? num(j.weightOrigin, 2) : "-"}</td>
                    <td className="num">{j.weightDest != null ? num(j.weightDest, 2) : "-"}</td>
                    <td>
                      {j.routeId != null ? (
                        <Badge tone="ok">จับคู่แล้ว</Badge>
                      ) : (
                        <Badge tone="warn">ยังไม่จับคู่ — แก้ในหน้าบันทึกงานขนส่ง</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
