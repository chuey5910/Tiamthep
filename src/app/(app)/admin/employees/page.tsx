import { Badge, Card, Formula, PageHeader, Stat } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { MAX_ADMINS } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { AddEmployeeForm, RowControls } from "./EmployeeControls";

export const dynamic = "force-dynamic";
export const metadata = { title: "ทะเบียนพนักงาน" };

export default async function EmployeesPage() {
  await requireAdmin();

  const employees = await prisma.employee.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { user: { select: { username: true, status: true } } },
  });
  const admins = await prisma.user.count({
    where: { role: "ADMIN", status: { not: "SUSPENDED" } },
  });

  const active = employees.filter((e) => e.active);
  const withAccount = employees.filter((e) => e.userId);

  return (
    <>
      <PageHeader
        title="ทะเบียนพนักงาน (สิทธิ์สมัครใช้งานเว็บ)"
        subtitle="ผู้ที่จะสมัครใช้งานได้ต้องมีชื่อในทะเบียนนี้ และ 1 รายชื่อสร้างได้ 1 บัญชีเท่านั้น"
      />

      <Formula>
        ตอนสมัคร ระบบเทียบ <b>ชื่อ-นามสกุล</b> ที่ผู้สมัครกรอกกับทะเบียนนี้ (ต้องสะกดตรงกัน
        ช่องว่างซ้ำไม่เป็นไร) · พนักงานลาออกให้กด <b>ปิดใช้งาน</b> — ชื่อจะสมัครใหม่ไม่ได้
        ส่วนบัญชีที่มีอยู่แล้วให้ไประงับที่หน้าจัดการผู้ใช้งาน · ผู้ดูแลระบบมีได้สูงสุด {MAX_ADMINS} คน
        (ตอนนี้ {admins} คน)
      </Formula>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="รายชื่อทั้งหมด" value={employees.length} />
        <Stat label="ใช้งานได้" value={active.length} />
        <Stat label="สร้างบัญชีแล้ว" value={withAccount.length} />
        <Stat label={`ผู้ดูแลระบบ (เต็ม ${MAX_ADMINS})`} value={admins} />
      </div>

      <Card title="เพิ่มรายชื่อพนักงาน" bodyClass="p-4">
        <AddEmployeeForm />
      </Card>

      <div className="h-4" />

      <Card title={`รายชื่อพนักงาน (${employees.length})`} bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>ชื่อ-นามสกุล</th>
                <th>ตำแหน่ง</th>
                <th>สถานะ</th>
                <th>บัญชีผู้ใช้</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-400">
                    ยังไม่มีรายชื่อ — เพิ่มรายชื่อพนักงานก่อน คนอื่นจึงจะสมัครใช้งานได้
                  </td>
                </tr>
              )}
              {employees.map((e) => (
                <tr key={e.id}>
                  <td className="font-medium">{e.name}</td>
                  <td className="text-slate-500">{e.position ?? "-"}</td>
                  <td>
                    {e.active ? <Badge tone="ok">ใช้งานได้</Badge> : <Badge tone="muted">ปิดใช้งาน</Badge>}
                  </td>
                  <td>
                    {e.user ? (
                      <span className="text-[13px]">
                        {e.user.username}{" "}
                        {e.user.status === "PENDING" && <Badge tone="warn">รออนุมัติ</Badge>}
                        {e.user.status === "SUSPENDED" && <Badge tone="error">ถูกระงับ</Badge>}
                      </span>
                    ) : (
                      <span className="text-slate-400">ยังไม่สมัคร</span>
                    )}
                  </td>
                  <td>
                    <RowControls
                      id={e.id}
                      name={e.name}
                      position={e.position}
                      active={e.active}
                      hasUser={!!e.userId}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
