import { Card, Empty, Formula, PageHeader } from "@/components/ui";
import { getCurrentUser, requireAuth } from "@/lib/auth";
import { formatThaiDate, formatThaiDateTime } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import type { SearchParams } from "@/lib/params";
import { canWrite } from "@/lib/roles";
import { SHIP_SETTINGS, localOcrProgress, pullShipTickets, runLocalOcrQueue, shipReview } from "@/lib/ship-ticket";
import { ShipTable } from "./ShipTable";
import { UndoUnused } from "./UndoUnused";

export const dynamic = "force-dynamic";

/**
 * ตั๋วเรือรอตรวจ — ระบบอ่านรูปตั๋วจาก Google Drive ให้แล้ว คนตรวจทีละแถวแล้วกดยืนยันถึงจะเป็นงาน
 * ทุกครั้งที่เปิดหน้า ดึงรูปใหม่จากชีตให้เอง (ไม่ต้องกดปุ่ม)
 */
export default async function ShipTicketsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  await requireAuth();
  const user = await getCurrentUser();
  const pulled = await pullShipTickets();
  // ตัวอ่านที่สองทำงานเบื้องหลัง ไม่รอ — เปิดหน้าใหม่ภายหลังจะเห็นผลที่อ่านเสร็จแล้ว
  runLocalOcrQueue().catch(() => {});
  const local = await localOcrProgress();
  const data = await shipReview();
  // ตรวจทีละเส้นทาง — เส้นทางเดียวบนจอ ไม่ปนกัน (ระบบยังอ่านรูปทุกเส้นทางเบื้องหลัง สลับไปแล้วพร้อมตรวจทันที)
  const want = typeof sp.route === "string" ? sp.route : null;
  const route = data.routes.find((r) => r.folder === want) ?? data.routes[0] ?? null;
  const rows = route ? data.rows.filter((x) => x.routeFolder === route.folder) : [];
  const recent = await prisma.shipTicket.findMany({
    where: { status: { not: "รอตรวจ" }, ...(route ? { routeFolder: route.folder } : {}) },
    orderBy: { decidedAt: "desc" },
    take: 30,
  });
  // งานที่ยืนยันไปแล้วแต่ถูกลบทิ้งทีหลัง — ให้เอาตั๋วกลับมาตรวจใหม่ได้
  const jobIds = recent.map((t) => t.jobId).filter((n): n is number => n != null);
  const liveJobs = new Set(
    (await prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true } })).map((j) => j.id),
  );

  return (
    <>
      <PageHeader
        title="ตั๋วเรือรอตรวจ"
        subtitle="ระบบอ่านรูปจากโฟลเดอร์ «ตั๋วเรือ» ใน Google Drive ให้แล้ว — แยกกลุ่มตามโฟลเดอร์เส้นทาง (ต้นทาง - ปลายทาง)"
      />

      <Formula>
        <b>ดูทีละแถว ถูกแล้วกด ✅ ยืนยัน</b> จึงจะกลายเป็นงานในระบบ
        <br />– ❌ ตัวแดง = อ่านไม่ชัด ระบบเว้นว่างไว้ กด «ดูรูป» แล้วกรอกเอง · กรอกครบแล้วปุ่มยืนยันเปลี่ยนเป็นสีแดง
        <br />– <b>น้ำหนักต้นทาง</b> อ่านจากตั๋ว · <b>น้ำหนักปลายทาง</b> = ค่าเดียวกับต้นทาง · ช่องว่างให้กรอกเป็นกิโลกรัมตามตั๋ว
        <br />– อ่านด้วย 2 ตัวอ่าน (Google + ตัวอ่านบนเครื่อง) ตรงกันถึงใส่ให้เอง · อ่านได้ไม่ตรงกัน = ⚠️ ว่างไว้ให้ดูรูป
        <br />– ทะเบียน = ชื่อโฟลเดอร์ทะเบียน · พขร. จากตารางจับคู่รถ ถ้าชื่อในตั๋วไม่ตรงให้เลือกเอง (ระบบจำไว้ ครั้งหน้าไม่ต้องเลือกซ้ำ)
        <br />– ต้นทาง / ปลายทาง / ลูกค้า / แบบตั๋ว ตั้งครั้งเดียวต่อโฟลเดอร์เส้นทาง ที่หน้า <a className="font-bold underline" href="/settings/ship-routes">{SHIP_SETTINGS}</a>
      </Formula>

      {!pulled.ok && <p className="mb-3 text-[13px] font-bold text-amber-700">⚠️ ดึงรูปตั๋วใหม่ไม่ได้ — {pulled.error}</p>}
      {local.waiting > 0 && (
        <p className="mb-3 text-[13px] font-bold text-sky-800">
          🔍 ตัวอ่านที่สองกำลังอ่านรูปซ้ำ — เหลือ {local.waiting} รูป · ใบในรูปเหล่านั้นจะเติมค่าให้เองเมื่ออ่านเสร็จ (เปิดหน้านี้ใหม่เพื่อดูผล)
        </p>
      )}
      {local.failed > 0 && (
        <p className="mb-3 text-[13px] font-bold text-amber-700">
          ⚠️ ตัวอ่านที่สองอ่านไม่ได้ {local.failed} รูป — {local.error} (ลองล่าสุด {local.triedAt ? formatThaiDateTime(local.triedAt) : "-"} · ระบบลองใหม่เองทุก {local.retryEvery})
        </p>
      )}
      {data.notices.map((n) => (
        <p key={n} className={`mb-3 text-[13px] font-bold ${n.startsWith("❌") ? "text-red-700" : "text-amber-700"}`}>
          {n}
        </p>
      ))}

      {data.routes.length > 1 && (
        <div className="no-print mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-bold text-slate-700">เลือกเส้นทางที่จะตรวจ:</span>
          {data.routes.map((r) => {
            const n = data.rows.filter((x) => x.routeFolder === r.folder).length;
            const on = r.folder === route?.folder;
            return (
              <a
                key={r.folder}
                href={`?route=${encodeURIComponent(r.folder)}`}
                className={`btn ${on ? "btn-primary" : "btn-ghost"}`}
                title={`โฟลเดอร์ «${r.folder}»`}
              >
                {r.problem ? "❌ " : ""}
                {r.origin ?? r.folder} → {r.destination ?? "❓"} ({n})
              </a>
            );
          })}
        </div>
      )}

      {!route ? (
        <Card title="รอตรวจ 0 ใบ" className="mb-4" bodyClass="p-3">
          <Empty>✅ ไม่มีตั๋วรอตรวจ — ถ่ายรูปตั๋วเก็บเข้าโฟลเดอร์ทะเบียนรถใน Drive แล้วเปิดหน้านี้ใหม่</Empty>
        </Card>
      ) : (
        // หัวกล่องบอกเลยว่าตั๋วชุดนี้จะเป็นงาน ต้นทาง → ปลายทาง ของลูกค้าไหน
        <Card
          title={
            <>
              {route.origin ?? "❓ ต้นทาง"} → {route.destination ?? "❓ ปลายทาง"} · ลูกค้า {route.customer ?? "❓"}
              <span className="ml-2 text-[13px] font-normal text-slate-500">
                รอตรวจ {rows.length} ใบ · โฟลเดอร์ «{route.folder}» · {route.format}
              </span>
            </>
          }
          className="mb-4"
          bodyClass="p-3"
        >
          {route.problem && <p className="mb-3 text-[13px] font-bold text-red-700">{route.problem}</p>}
          <ShipTable rows={rows} drivers={data.drivers} canEdit={canWrite(user)} />
        </Card>
      )}

      {recent.length > 0 && (
        <Card title={`ตรวจแล้วล่าสุด${data.routes.length > 1 && route ? ` · ${route.origin ?? route.folder} → ${route.destination ?? "❓"}` : ""}`} bodyClass="p-0">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>เลขที่ตั๋ว</th>
                  <th>ทะเบียน</th>
                  <th>วันที่</th>
                  <th>ผล</th>
                  <th>ตรวจโดย</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recent.map((t) => (
                  <tr key={t.id}>
                    <td>{t.ticketNo ?? "-"}</td>
                    <td>{t.folderPlate}</td>
                    <td>{t.ticketDate ? formatThaiDate(t.ticketDate) : "-"}</td>
                    <td>
                      {t.status === "ยืนยันแล้ว" && t.jobId != null && liveJobs.has(t.jobId) ? (
                        <a className="font-bold text-emerald-700 underline" href={`/entry/jobs?edit=${t.jobId}`}>
                          ✅ งาน #{t.jobId}
                        </a>
                      ) : t.status === "ยืนยันแล้ว" ? (
                        <span className="font-bold text-amber-700">⚠️ งาน #{t.jobId} ถูกลบแล้ว</span>
                      ) : (
                        <span className="text-slate-500">ไม่ใช้</span>
                      )}
                    </td>
                    <td className="text-[12.5px] text-slate-600">
                      {t.decidedBy ?? "-"} · {formatThaiDateTime(t.decidedAt)}
                    </td>
                    <td>
                      {canWrite(user) && (t.status === "ไม่ใช้" || (t.jobId != null && !liveJobs.has(t.jobId))) && (
                        <UndoUnused id={t.id} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
