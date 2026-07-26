"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAV } from "@/lib/nav";

export function Shell({ children, companyName }: { children: React.ReactNode; companyName: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen lg:flex">
      {/* แถบบนสำหรับจอเล็ก */}
      <header className="no-print flex items-center gap-3 border-b border-[var(--border)] bg-white px-4 py-3 lg:hidden">
        <button className="btn btn-ghost px-2 py-1" onClick={() => setOpen((v) => !v)} aria-label="เมนู">
          ☰
        </button>
        <span className="font-bold text-slate-800">{companyName}</span>
      </header>

      <nav
        className={`no-print w-full shrink-0 border-r border-[var(--border)] bg-white lg:sticky lg:top-0 lg:block lg:h-screen lg:w-64 lg:overflow-y-auto ${
          open ? "block" : "hidden lg:block"
        }`}
      >
        <div className="hidden border-b border-[var(--border)] px-4 py-4 lg:block">
          <div className="text-[13px] font-bold leading-tight text-slate-800">{companyName}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">ระบบบริหารงานขนส่ง</div>
        </div>

        <div className="px-2 py-3">
          {NAV.map((group) => (
            <div key={group.title} className="mb-3">
              <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                <span className="mr-1">{group.icon}</span>
                {group.title}
              </div>
              {group.items.map((item) => {
                const active =
                  item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`block rounded-lg px-3 py-1.5 text-[13px] transition-colors ${
                      active
                        ? "bg-brand-50 font-semibold text-brand-700"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </nav>

      <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
    </div>
  );
}
