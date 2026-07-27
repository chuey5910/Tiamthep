"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { NAV } from "@/lib/nav";
import { logout } from "@/app/(auth)/actions";
import { Logo } from "@/components/Logo";
import { ROLE_LABEL, type SessionUser } from "@/lib/roles";

export function Shell({
  children,
  companyName,
  user,
  pendingCount = 0,
}: {
  children: React.ReactNode;
  companyName: string;
  user: SessionUser;
  pendingCount?: number;
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
          <Logo withThai={false} className="h-7 w-auto" title={companyName} />
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
          {groups.map((group) => (
            <div key={group.title} className="mb-3">
              <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                <span className="mr-1">{group.icon}</span>
                {group.title}
              </div>
              {group.items.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname === item.href || pathname.startsWith(item.href + "/");
                const badge = item.href === "/admin/users" && pendingCount > 0 ? pendingCount : null;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-[13px] transition-colors ${
                      active
                        ? "bg-brand-50 font-semibold text-brand-700"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
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
          ))}
        </div>

        <UserBar user={user} />
      </nav>

      <main className="min-w-0 flex-1 p-4 lg:p-6">
        {/* หัวกระดาษ — โผล่เฉพาะตอนสั่งพิมพ์รายงาน */}
        <div className="print-head">
          <Logo className="w-52" title={companyName} />
          <div className="text-right text-[11px] leading-relaxed text-slate-600">
            <div className="font-semibold text-slate-900">{companyName}</div>
            <div>ระบบบริหารงานขนส่ง</div>
          </div>
        </div>
        {children}
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
