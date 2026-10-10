"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type SearchOption = { value: string; label: string };

/**
 * ช่องเลือกที่มีช่องค้นหาในตัว — รายการยาว (เช่น พขร.) พิมพ์บางส่วนของชื่อแล้วเลือกได้เลย
 * ตามหลัก "มีช่องค้นหาเสมอเมื่อรายการยาว"
 */
export function SearchSelect({
  options,
  value,
  onChange,
  placeholder = "— เลือก —",
  invalid = false,
  disabled = false,
}: {
  options: SearchOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** ยังไม่ได้เลือกแต่ต้องเลือก → กรอบแดง */
  invalid?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const picked = options.find((o) => o.value === value);

  const shown = useMemo(() => {
    const k = q.replace(/\s+/g, "").toLowerCase();
    return k ? options.filter((o) => o.label.replace(/\s+/g, "").toLowerCase().includes(k)) : options;
  }, [q, options]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
    setQ("");
  };

  return (
    <div ref={box} className="relative inline-block min-w-[10rem] text-left">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`inp flex w-full items-center justify-between gap-2 text-center ${
          invalid ? "border-red-400 bg-red-50 font-bold text-red-700" : ""
        }`}
      >
        <span className="flex-1 truncate">{picked ? picked.label : placeholder}</span>
        <span className="text-[10px] text-slate-500">▼</span>
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-64 rounded-lg border border-[var(--border)] bg-white p-1.5 shadow-lg">
          <input
            autoFocus
            className="inp mb-1 w-full"
            placeholder="🔍 พิมพ์ชื่อเพื่อค้นหา…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && shown[0]) {
                e.preventDefault();
                choose(shown[0].value);
              }
            }}
          />
          <div className="max-h-56 overflow-y-auto">
            {shown.length === 0 && <div className="px-2 py-1.5 text-[13px] text-slate-500">ไม่พบชื่อนี้</div>}
            {shown.map((o) => (
              <button
                type="button"
                key={o.value}
                onClick={() => choose(o.value)}
                className={`block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-slate-100 ${
                  o.value === value ? "bg-emerald-50 font-bold" : ""
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
