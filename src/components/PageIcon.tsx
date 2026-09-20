"use client";

import { usePathname } from "next/navigation";
import { NAV } from "@/lib/nav";

/** อีโมจิหน้าหัวข้อหน้า — หาจากเมนูที่ตรงกับ URL ปัจจุบัน (หน้าใหม่ที่ไม่มีในเมนูใช้ 📌) */
export function PageIcon() {
  const pathname = usePathname();
  let best: { len: number; icon: string } | null = null;
  for (const g of NAV) {
    for (const it of g.items) {
      const hit = it.href === "/" ? pathname === "/" : pathname === it.href || pathname.startsWith(it.href + "/");
      if (hit && (!best || it.href.length > best.len)) best = { len: it.href.length, icon: it.icon ?? g.icon };
    }
  }
  return <span className="mr-2">{best?.icon ?? "📌"}</span>;
}
