"use client";

import { needsReorder } from "@/lib/stock-rules";
import { STOCK_GROUPS_BY_LETTER, groupByName } from "@/lib/stock-groups";

/**
 * ตัวกรองคลังอะไหล่ — ใช้ชุดเดียวกันทั้งหน้า คลังอะไหล่ (รับเข้า/เบิกใช้) และ สรุปคงเหลือ
 * ค้นหา (รหัส/ชื่อ) · หมวด (8 หมวด + บอกว่าหมวดนั้นคืออะไร) · สถานะ
 */

export type StockStatus = "all" | "low" | "negative" | "instock" | "empty" | "moved";
export type StockFilter = { q: string; cat: string; status: StockStatus };
export const NO_FILTER: StockFilter = { q: "", cat: "", status: "all" };

/** ค่าในช่องหมวดสำหรับสินค้าที่ยังไม่ได้ระบุหมวด */
const NO_CAT = "__none__";

const STATUS: { value: StockStatus; label: string }[] = [
  { value: "all", label: "— ทุกรายการ —" },
  { value: "low", label: "⚠️ ต้องสั่งซื้อ" },
  { value: "negative", label: "❌ คงเหลือติดลบ (บันทึกผิด)" },
  { value: "instock", label: "มีของในคลัง (คงเหลือมากกว่า 0)" },
  { value: "empty", label: "ของหมด (คงเหลือ 0)" },
  { value: "moved", label: "เคยมีความเคลื่อนไหว" },
];

const fold = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, "");

/** แถวนี้ผ่านตัวกรองไหม · search = ข้อความที่ให้ค้น (รหัส ชื่อ …) */
export function stockMatch(
  it: { category: string | null; balance: number; reorderPoint: number; moved: boolean; search: (string | null | undefined)[] },
  f: StockFilter,
): boolean {
  if (f.cat === NO_CAT ? !!it.category : f.cat && it.category !== f.cat) return false;
  if (f.status === "low" && !needsReorder(it.balance, it.reorderPoint)) return false;
  if (f.status === "negative" && !(it.balance < 0)) return false;
  if (f.status === "instock" && !(it.balance > 0)) return false;
  if (f.status === "empty" && it.balance !== 0) return false;
  if (f.status === "moved" && !it.moved) return false;
  const fq = fold(f.q);
  return !fq || it.search.some((v) => fold(v).includes(fq));
}

export function StockFilterBar({
  value,
  onChange,
  categories,
  children,
  summary,
}: {
  value: StockFilter;
  onChange: (f: StockFilter) => void;
  /** หมวดที่มีอยู่จริงในคลัง (นอกเหนือจาก 8 หมวด ถ้ามี ก็ให้เลือกได้) */
  categories: (string | null)[];
  /** ปุ่มเพิ่มเติม (เช่น + เพิ่มสินค้าใหม่) */
  children?: React.ReactNode;
  /** «พบ X จาก Y รายการ …» */
  summary: React.ReactNode;
}) {
  const extra = [...new Set(categories.filter((c): c is string => !!c && !groupByName(c)))].sort((a, b) => a.localeCompare(b, "th"));
  const hasNoCat = categories.some((c) => !c);
  const group = groupByName(value.cat);
  const set = (p: Partial<StockFilter>) => onChange({ ...value, ...p });
  return (
    <div className="no-print card mb-4 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="lbl">ค้นหา</label>
          <input className="inp w-64" value={value.q} onChange={(e) => set({ q: e.target.value })} placeholder="รหัส หรือ ชื่อสินค้า" />
        </div>
        <div>
          <label className="lbl">หมวด</label>
          <select className="inp w-56" value={value.cat} onChange={(e) => set({ cat: e.target.value })}>
            <option value="">— ทุกหมวด —</option>
            {STOCK_GROUPS_BY_LETTER.map((g) => (
              <option key={g.name} value={g.name}>
                {g.name} ({g.letter})
              </option>
            ))}
            {extra.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {hasNoCat && <option value={NO_CAT}>(ยังไม่ระบุหมวด)</option>}
          </select>
        </div>
        <div>
          <label className="lbl">สถานะ</label>
          <select className="inp w-64" value={value.status} onChange={(e) => set({ status: e.target.value as StockStatus })}>
            {STATUS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        {(value.q || value.cat || value.status !== "all") && (
          <button type="button" className="btn btn-ghost" onClick={() => onChange(NO_FILTER)}>
            ล้างตัวกรอง
          </button>
        )}
        {children}
        <span className="pb-2 text-[12px] text-slate-500">{summary}</span>
      </div>
      {/* หมวดที่เลือกคืออะไร — ที่เดียวกับที่ใช้จัดหมวดสินค้าใหม่ (stock-groups.ts) */}
      {group && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-[13px] font-medium text-amber-900">
          <b>{group.name} ({group.letter})</b> = {group.about}
        </p>
      )}
    </div>
  );
}
