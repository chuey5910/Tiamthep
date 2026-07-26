"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { TH_MONTHS_FULL } from "@/lib/date";

function useSetParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const set = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, v);
    }
    start(() => router.push(`${pathname}?${next.toString()}`));
  };

  return { set, pending, params };
}

/** ตัวกรองช่วงวันที่ พร้อมปุ่มลัดเลือกทั้งเดือน */
export function DateRangeFilter({ from, to }: { from: string; to: string }) {
  const { set, pending } = useSetParams();

  const shiftMonth = (delta: number) => {
    const d = new Date(from + "T00:00:00Z");
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + delta;
    const first = new Date(Date.UTC(y, m, 1));
    const last = new Date(Date.UTC(y, m + 1, 0));
    set({ from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) });
  };

  const thisMonth = () => {
    const now = new Date();
    const first = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    const last = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));
    set({ from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) });
  };

  return (
    <div className="no-print card mb-4 flex flex-wrap items-end gap-3 p-3">
      <div>
        <label className="lbl">ตั้งแต่วันที่</label>
        <input type="date" className="inp w-40" value={from} onChange={(e) => set({ from: e.target.value })} />
      </div>
      <div>
        <label className="lbl">ถึงวันที่</label>
        <input type="date" className="inp w-40" value={to} onChange={(e) => set({ to: e.target.value })} />
      </div>
      <div className="flex gap-2">
        <button className="btn btn-ghost" onClick={() => shiftMonth(-1)} disabled={pending}>
          ◀ เดือนก่อน
        </button>
        <button className="btn btn-ghost" onClick={thisMonth} disabled={pending}>
          เดือนนี้
        </button>
        <button className="btn btn-ghost" onClick={() => shiftMonth(1)} disabled={pending}>
          เดือนถัดไป ▶
        </button>
      </div>
      {pending && <span className="text-xs text-slate-400">กำลังคำนวณ…</span>}
    </div>
  );
}

/** ตัวกรองแบบเลือกเดือน/ปี ใช้กับรายงานที่ดูเป็นรายเดือน */
export function MonthFilter({
  year,
  month,
  extra,
}: {
  year: number;
  month: number;
  extra?: React.ReactNode;
}) {
  const { set, pending } = useSetParams();
  const years: number[] = [];
  const nowY = new Date().getFullYear();
  for (let y = nowY - 4; y <= nowY + 1; y++) years.push(y);

  return (
    <div className="no-print card mb-4 flex flex-wrap items-end gap-3 p-3">
      <div>
        <label className="lbl">เดือน</label>
        <select className="inp w-36" value={month} onChange={(e) => set({ month: e.target.value })}>
          {TH_MONTHS_FULL.map((name, i) => (
            <option key={i} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="lbl">ปี (พ.ศ.)</label>
        <select className="inp w-28" value={year} onChange={(e) => set({ year: e.target.value })}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y + 543}
            </option>
          ))}
        </select>
      </div>
      {extra}
      {pending && <span className="text-xs text-slate-400">กำลังคำนวณ…</span>}
    </div>
  );
}

/** dropdown ทั่วไปที่ผูกกับ query string */
export function SelectFilter({
  name,
  label,
  value,
  options,
  width = "w-56",
}: {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  width?: string;
}) {
  const { set } = useSetParams();
  return (
    <div>
      <label className="lbl">{label}</label>
      <select className={`inp ${width}`} value={value} onChange={(e) => set({ [name]: e.target.value })}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** ช่องค้นหาแบบส่งเมื่อกด Enter */
export function SearchFilter({ value, placeholder = "ค้นหา…" }: { value: string; placeholder?: string }) {
  const { set } = useSetParams();
  return (
    <div>
      <label className="lbl">ค้นหา</label>
      <input
        className="inp w-64"
        defaultValue={value}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === "Enter") set({ q: (e.target as HTMLInputElement).value, page: null });
        }}
        onBlur={(e) => set({ q: e.target.value, page: null })}
      />
    </div>
  );
}
