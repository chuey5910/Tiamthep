import Link from "next/link";
import { Badge, Card, Empty, Formula, PageHeader, Stat } from "@/components/ui";
import { SelectFilter } from "@/components/Filters";
import { ACTION_LABEL, requireAdmin } from "@/lib/auth";
import { formatThaiDate } from "@/lib/date";
import { readInt, readString, type SearchParams } from "@/lib/params";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const metadata = { title: "บันทึกการเข้าระบบ" };

const PAGE_SIZE = 100;

export default async function LoginLogPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const sp = await searchParams;

  const action = readString(sp, "action");
  const result = readString(sp, "result");
  const page = Math.max(1, readInt(sp, "page", 1));

  const where: Record<string, unknown> = {};
  if (action) where.action = action;
  if (result === "success") where.success = true;
  if (result === "fail") where.success = false;

  const [logs, total, failed24h, logins24h] = await Promise.all([
    prisma.loginLog.findMany({
      where,
      orderBy: { at: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      include: { user: { select: { name: true } } },
    }),
    prisma.loginLog.count({ where }),
    prisma.loginLog.count({
      where: { action: "LOGIN", success: false, at: { gte: new Date(Date.now() - 86400_000) } },
    }),
    prisma.loginLog.count({
      where: { action: "LOGIN", success: true, at: { gte: new Date(Date.now() - 86400_000) } },
    }),
  ]);

  const pages = Math.ceil(total / PAGE_SIZE);
  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    if (action) p.set("action", action);
    if (result) p.set("result", result);
    for (const [k, v] of Object.entries(over)) v ? p.set(k, v) : p.delete(k);
    return `?${p.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="บันทึกการเข้าระบบ"
        subtitle="ทุกครั้งที่มีคนเข้าระบบ ออกจากระบบ สมัคร หรือถูกอนุมัติ จะถูกบันทึกไว้ที่นี่"
        actions={
          <>
            <Link href="/admin/users" className="btn btn-ghost">
              ← จัดการผู้ใช้งาน
            </Link>
            <button type="button" className="btn btn-ghost" data-print>
              🖨 พิมพ์
            </button>
          </>
        }
      />

      <Formula>
        บันทึกนี้ <b>แก้ไขและลบไม่ได้จากหน้าเว็บ</b> เพื่อให้ใช้ตรวจสอบย้อนหลังได้จริง ·&nbsp;
        การพยายามเข้าระบบที่ล้มเหลวก็ถูกบันทึกด้วย รวมถึงกรณีที่ใส่ชื่อผู้ใช้ที่ไม่มีอยู่จริง
      </Formula>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="เข้าระบบสำเร็จ (24 ชม.)" value={logins24h} hint="ครั้ง" />
        <Stat
          label="เข้าระบบไม่สำเร็จ (24 ชม.)"
          value={failed24h}
          hint="ครั้ง"
          tone={failed24h > 10 ? "bad" : failed24h > 0 ? "warn" : "good"}
        />
        <Stat label="รายการทั้งหมด" value={total.toLocaleString("th-TH")} hint="รายการ" />
        <Stat label="หน้า" value={`${page} / ${Math.max(1, pages)}`} />
      </div>

      {failed24h > 10 && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-900">
          ⚠ มีการพยายามเข้าระบบไม่สำเร็จ {failed24h} ครั้งใน 24 ชั่วโมงที่ผ่านมา — ตรวจดูว่าเป็นการเดารหัสผ่านหรือไม่
        </p>
      )}

      <div className="no-print card mb-4 flex flex-wrap items-end gap-3 p-3">
        <SelectFilter
          name="action"
          label="ประเภทเหตุการณ์"
          value={action}
          width="w-48"
          options={[
            { value: "", label: "ทั้งหมด" },
            ...Object.entries(ACTION_LABEL).map(([value, label]) => ({ value, label })),
          ]}
        />
        <SelectFilter
          name="result"
          label="ผลลัพธ์"
          value={result}
          width="w-40"
          options={[
            { value: "", label: "ทั้งหมด" },
            { value: "success", label: "สำเร็จ" },
            { value: "fail", label: "ไม่สำเร็จ" },
          ]}
        />
      </div>

      <Card bodyClass="p-0">
        {logs.length === 0 ? (
          <Empty>ไม่พบรายการตามเงื่อนไขที่เลือก</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>วันเวลา</th>
                  <th>เหตุการณ์</th>
                  <th>ชื่อผู้ใช้</th>
                  <th>ชื่อ-นามสกุล</th>
                  <th>ผล</th>
                  <th>รายละเอียด</th>
                  <th>ที่อยู่ IP</th>
                  <th>อุปกรณ์</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap">
                      {formatThaiDate(l.at)}{" "}
                      <span className="text-slate-400">{l.at.toISOString().slice(11, 19)}</span>
                    </td>
                    <td>
                      <Badge tone={l.action === "LOGIN" ? "info" : l.action === "REGISTER" ? "warn" : "muted"}>
                        {ACTION_LABEL[l.action] ?? l.action}
                      </Badge>
                    </td>
                    <td className="font-mono text-[12px]">{l.username}</td>
                    <td>{l.user?.name ?? <span className="text-slate-300">—</span>}</td>
                    <td>
                      {l.success ? <Badge tone="ok">สำเร็จ</Badge> : <Badge tone="error">ไม่สำเร็จ</Badge>}
                    </td>
                    <td className="max-w-xs text-[12px] text-slate-600">{l.reason ?? "-"}</td>
                    <td className="font-mono text-[11px] text-slate-500">{l.ip ?? "-"}</td>
                    <td className="max-w-[14rem] truncate text-[11px] text-slate-400" title={l.userAgent ?? ""}>
                      {l.userAgent ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="no-print flex items-center justify-between border-t border-[var(--border)] px-4 py-2 text-[13px]">
            <span className="text-slate-500">
              หน้า {page} จาก {pages}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={qs({ page: String(page - 1) })} className="btn btn-ghost">
                  ◀ ก่อนหน้า
                </Link>
              )}
              {page < pages && (
                <Link href={qs({ page: String(page + 1) })} className="btn btn-ghost">
                  ถัดไป ▶
                </Link>
              )}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
