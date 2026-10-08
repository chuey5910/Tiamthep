"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { NAV, type NavTone } from "@/lib/nav";

/**
 * สีพาสเทลของแต่ละหัวข้อหลักในเมนูซ้าย — หัวข้อย่อยใช้สีเดียวกับหัวข้อหลักของตัวเอง
 * เขียนคลาสเต็มไว้ตรงนี้ (Tailwind ต้องเห็นชื่อคลาสครบ ประกอบสตริงเองไม่ได้)
 */
const TONES: Record<NavTone, { head: string; line: string; active: string; hover: string }> = {
  sky: { head: "bg-sky-100 text-sky-900", line: "border-sky-200", active: "bg-sky-200 text-sky-900", hover: "hover:bg-sky-50" },
  emerald: { head: "bg-emerald-100 text-emerald-900", line: "border-emerald-200", active: "bg-emerald-200 text-emerald-900", hover: "hover:bg-emerald-50" },
  violet: { head: "bg-violet-100 text-violet-900", line: "border-violet-200", active: "bg-violet-200 text-violet-900", hover: "hover:bg-violet-50" },
  amber: { head: "bg-amber-100 text-amber-900", line: "border-amber-200", active: "bg-amber-200 text-amber-900", hover: "hover:bg-amber-50" },
  orange: { head: "bg-orange-100 text-orange-900", line: "border-orange-200", active: "bg-orange-200 text-orange-900", hover: "hover:bg-orange-50" },
  pink: { head: "bg-pink-100 text-pink-900", line: "border-pink-200", active: "bg-pink-200 text-pink-900", hover: "hover:bg-pink-50" },
  indigo: { head: "bg-indigo-100 text-indigo-900", line: "border-indigo-200", active: "bg-indigo-200 text-indigo-900", hover: "hover:bg-indigo-50" },
};
import { logout } from "@/app/(auth)/actions";
import { Logo } from "@/components/Logo";
import { ROLE_LABEL, type SessionUser } from "@/lib/roles";

export function Shell({
  children,
  companyName,
  user,
  badges = {},
}: {
  children: React.ReactNode;
  companyName: string;
  user: SessionUser;
  /** ตัวเลขสีส้มข้างเมนู (เช่น ผู้ใช้รออนุมัติ · ตั๋วเรือรอตรวจ) — href → จำนวน */
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const groups = NAV.filter((g) => !g.adminOnly || user.role === "ADMIN");

  return (
    <div className="min-h-screen lg:flex">
      {/* แถบบนสำหรับจอเล็ก */}
      <header className="no-print flex items-center gap-3 border-b border-[var(--border)] bg-white px-4 py-3 lg:hidden">
        <button className="btn btn-ghost px-2 py-1" onClick={() => setOpen((v) => !v)} aria-label="เมนู">
          ☰
        </button>
        <div className="min-w-0 flex-1">
          {/* จอเล็ก: ใช้โลโก้ตัวเต็ม ห้ามครอปส่วนชื่อไทยออก — ย่อขนาดอย่างเดียว */}
          <Logo className="w-32" title={companyName} />
        </div>
        <span className="truncate text-[12px] text-slate-500">{user.name}</span>
      </header>

      <nav
        className={`no-print w-full shrink-0 border-r border-[var(--border)] bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:flex-col ${
          open ? "block" : "hidden lg:flex"
        }`}
      >
        <div className="hidden border-b border-[var(--border)] px-4 py-4 lg:block">
          <Logo className="w-44" title={companyName} />
          <div className="mt-1.5 text-[11px] text-slate-500">ระบบบริหารงานขนส่ง</div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          {groups.map((group) => {
            const t = TONES[group.tone];
            return (
              <div key={group.title} className="mb-3">
                {/* หัวข้อหลัก — แถบสีพาสเทลประจำกลุ่ม อีโมจิใหญ่ชัด */}
                <div className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${t.head}`}>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white text-[17px] leading-none shadow-sm">
                    {group.icon}
                  </span>
                  <span className="text-[14px] font-extrabold">{group.title}</span>
                </div>
                {/* หัวข้อย่อย — เยื้องเข้าขวา มีเส้นสีเดียวกับหัวข้อหลักนำหน้า */}
                <div className={`ml-5 mt-1 border-l-2 pl-2 ${t.line}`}>
                  {group.items.map((item) => {
                    const active =
                      item.href === "/"
                        ? pathname === "/"
                        : pathname === item.href || pathname.startsWith(item.href + "/");
                    const badge = (badges[item.href] ?? 0) > 0 ? badges[item.href] : null;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[14px] transition-colors ${
                          active ? `font-bold ${t.active}` : `font-medium text-slate-800 ${t.hover}`
                        }`}
                      >
                        <span>{item.label}</span>
                        {badge && (
                          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">
                            {badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <UserBar user={user} />
      </nav>

      <main className="min-w-0 flex-1 p-4 lg:p-6">
        {/* โครง "แผ่นกระดาษ" ตอนพิมพ์ — บนจอมองไม่เห็น (display: contents)
            ตอนพิมพ์กลายเป็นตารางคลุมทั้งเอกสาร: แถวหัว 2.5 ซม. และแถวท้าย 2 ซม.
            ซ้ำเองทุกหน้า จึงได้ขอบบน-ล่างครบทุกแผ่น ไม่ว่าหน้าต่างพิมพ์จะตั้ง Margins เป็นอะไร
            (ถ้าพึ่ง @page margin อย่างเดียว เบราว์เซอร์ที่ตั้ง "Margins: None" จะโยนขอบทิ้งหมด) */}
        <table className="print-sheet">
          <thead>
            <tr>
              <td className="print-sheet-top" />
            </tr>
          </thead>
          <tfoot>
            <tr>
              <td className="print-sheet-bottom" />
            </tr>
          </tfoot>
          <tbody>
            <tr>
              <td className="print-sheet-body">
                {/* หัวกระดาษ — โผล่เฉพาะตอนสั่งพิมพ์รายงาน */}
                <div className="print-head">
                  <Logo className="w-52" title={companyName} />
                  <div className="text-right text-[11px] leading-relaxed text-slate-600">
                    <div className="font-semibold text-slate-900">{companyName}</div>
                    <div>ระบบบริหารงานขนส่ง</div>
                  </div>
                </div>
                {children}
              </td>
            </tr>
          </tbody>
        </table>
      </main>
    </div>
  );
}

function UserBar({ user }: { user: SessionUser }) {
  const [pending, start] = useTransition();

  return (
    <div className="border-t border-[var(--border)] px-3 py-3">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[13px] font-bold text-brand-700">
          {user.name.trim().charAt(0) || "?"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-slate-800">{user.name}</div>
          <div className="truncate text-[11px] text-slate-500">
            {ROLE_LABEL[user.role] ?? user.role} · {user.username}
          </div>
        </div>
      </div>
      <form action={() => start(async () => void (await logout()))}>
        <button className="btn btn-ghost w-full py-1 text-[12px]" disabled={pending}>
          {pending ? "กำลังออก…" : "ออกจากระบบ"}
        </button>
      </form>
    </div>
  );
}
