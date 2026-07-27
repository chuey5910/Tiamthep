import Link from "next/link";
import { Badge, Card, Empty, Formula, PageHeader, Stat } from "@/components/ui";
import { formatThaiDate } from "@/lib/date";
import { ROLE_LABEL, STATUS_LABEL, lockRemainingMinutes, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AddUserForm } from "./AddUserForm";
import { ApproveControls, ManageControls } from "./UserActions";

export const dynamic = "force-dynamic";
export const metadata = { title: "จัดการผู้ใช้งาน" };

function when(d: Date | null): string {
  if (!d) return "-";
  return `${formatThaiDate(d)} ${d.toISOString().slice(11, 16)} น.`;
}

export default async function UsersPage() {
  const me = await requireAdmin();

  const users = await prisma.user.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: { approvedBy: { select: { name: true, username: true } } },
  });

  const pending = users.filter((u) => u.status === "PENDING");
  const active = users.filter((u) => u.status === "ACTIVE");
  const suspended = users.filter((u) => u.status === "SUSPENDED");

  return (
    <>
      <PageHeader
        title="จัดการผู้ใช้งาน"
        subtitle="อนุมัติคำขอสมัคร กำหนดสิทธิ์ และระงับการใช้งาน"
        actions={
          <Link href="/admin/login-log" className="btn btn-ghost">
            ดูบันทึกการเข้าระบบ →
          </Link>
        }
      />

      <Formula>
        <b>สิทธิ์การใช้งาน</b> — <b>ผู้ดูแลระบบ</b>: ทำได้ทุกอย่าง รวมถึงจัดการผู้ใช้และตั้งค่าระบบ ·{" "}
        <b>พนักงาน</b>: บันทึกข้อมูลและดูรายงานได้ แต่จัดการผู้ใช้ไม่ได้ · <b>ดูอย่างเดียว</b>: เปิดดูได้อย่างเดียว บันทึกหรือแก้ไขไม่ได้
        <br />
        ผู้ใช้ที่สมัครใหม่จะอยู่ในสถานะ &laquo;รออนุมัติ&raquo; และเข้าระบบไม่ได้จนกว่าจะมีผู้ดูแลอนุมัติ
      </Formula>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="รออนุมัติ"
          value={pending.length}
          hint="คำขอ"
          tone={pending.length > 0 ? "warn" : "default"}
        />
        <Stat label="ใช้งานได้" value={active.length} hint="คน" tone="good" />
        <Stat label="ถูกระงับ" value={suspended.length} hint="คน" />
        <Stat label="ผู้ดูแลระบบ" value={active.filter((u) => u.role === "ADMIN").length} hint="คน" />
      </div>

      {/* ผู้บริหารหรือคนนอกทะเบียนพนักงาน สมัครหน้าเว็บเองไม่ได้ — ผู้ดูแลสร้างให้ตรงนี้ */}
      <Card title="สร้างบัญชีโดยผู้ดูแล" className="mb-4" bodyClass="p-4">
        <AddUserForm />
      </Card>

      <Card
        title={`คำขอที่รออนุมัติ (${pending.length})`}
        className={`mb-4 ${pending.length > 0 ? "border-amber-300" : ""}`}
        bodyClass="p-0"
      >
        {pending.length === 0 ? (
          <Empty>ไม่มีคำขอที่รออนุมัติ</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>ชื่อ-นามสกุล</th>
                  <th>ชื่อผู้ใช้</th>
                  <th>เบอร์โทร</th>
                  <th>วันที่สมัคร</th>
                  <th className="no-print">อนุมัติด้วยสิทธิ์</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((u) => (
                  <tr key={u.id}>
                    <td className="font-semibold">{u.name}</td>
                    <td className="font-mono text-[12px]">{u.username}</td>
                    <td>{u.phone ?? "-"}</td>
                    <td className="whitespace-nowrap text-slate-500">{when(u.createdAt)}</td>
                    <td className="no-print">
                      <ApproveControls userId={u.id} name={u.name} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`ผู้ใช้ในระบบ (${active.length + suspended.length})`} bodyClass="p-0">
        {active.length + suspended.length === 0 ? (
          <Empty>ยังไม่มีผู้ใช้ที่อนุมัติแล้ว</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>ชื่อ-นามสกุล</th>
                  <th>ชื่อผู้ใช้</th>
                  <th>สิทธิ์</th>
                  <th>สถานะ</th>
                  <th>เข้าระบบล่าสุด</th>
                  <th>อนุมัติโดย</th>
                  <th className="no-print">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {[...active, ...suspended].map((u) => {
                  const lockedMin = lockRemainingMinutes(u.lockedUntil);
                  const isSelf = u.id === me.id;
                  return (
                    <tr key={u.id}>
                      <td className="font-semibold">
                        {u.name}
                        {isSelf && <span className="ml-1.5 text-[11px] font-normal text-slate-400">(คุณ)</span>}
                      </td>
                      <td className="font-mono text-[12px]">{u.username}</td>
                      <td>
                        <Badge tone={u.role === "ADMIN" ? "info" : u.role === "VIEWER" ? "muted" : "ok"}>
                          {ROLE_LABEL[u.role] ?? u.role}
                        </Badge>
                      </td>
                      <td>
                        {u.status === "ACTIVE" ? (
                          lockedMin > 0 ? (
                            <Badge tone="warn">ถูกล็อก {lockedMin} นาที</Badge>
                          ) : (
                            <Badge tone="ok">{STATUS_LABEL[u.status]}</Badge>
                          )
                        ) : (
                          <Badge tone="error">{STATUS_LABEL[u.status] ?? u.status}</Badge>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-slate-500">{when(u.lastLoginAt)}</td>
                      <td className="text-slate-500">{u.approvedBy?.name ?? "-"}</td>
                      <td className="no-print">
                        <ManageControls
                          userId={u.id}
                          name={u.name}
                          role={u.role}
                          status={u.status}
                          locked={lockedMin > 0}
                          isSelf={isSelf}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
