"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { SearchSelect, type SearchOption } from "@/components/SearchSelect";
import { cancelOrder, installMenu, postOrder, refreshOrders, type PostLine } from "./actions";

export type PostOptions = { plates: string[]; categories: string[]; items: SearchOption[] };
export type PostDefaults = { kind: "vehicle" | "stock"; plate: string; category: string; itemCode: string };
type OrderForPost = {
  id: string;
  shopName: string;
  target: string;
  items: { id: number; seq: number; description: string; qty: number; unit: string | null; shopPrice: number | null; posted: boolean }[];
};

const n = (v: number | null | undefined) => (v == null ? "-" : v.toLocaleString("th-TH", { maximumFractionDigits: 2 }));

function Msg({ text }: { text: string | null }) {
  if (!text) return null;
  const tone = text.startsWith("❌") ? "text-red-700" : text.startsWith("⚠️") ? "text-amber-700" : "text-emerald-700";
  return <span className={`self-center whitespace-pre-line text-[13px] font-bold ${tone}`}>{text}</span>;
}

export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <Msg text={msg} />
      <button
        type="button"
        className="btn btn-ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await refreshOrders();
            setMsg(r.ok ? r.message : `❌ ${r.error}`);
            router.refresh();
          })
        }
      >
        {pending ? "⏳ กำลังดึง…" : "🔄 ดึงล่าสุดจากไลน์"}
      </button>
    </>
  );
}

export function CancelButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={pending}
        onClick={() => {
          if (!confirm(`ยกเลิกใบสั่งงาน ${id}?\nร้านจะไม่เห็นใบนี้ในเมนูอีก — อย่าลืมแจ้งร้านในแชทว่าไม่ต้องทำ`)) return;
          start(async () => {
            const r = await cancelOrder(id);
            // ช่องปุ่มตรึงอยู่ขวาสุดของตาราง — ข้อความยาวจะดันช่องจนบังคอลัมน์อื่น จึงแจ้งเป็นกล่องแทน
            if (!r.ok) alert(`❌ ${r.error}`);
            router.refresh();
          });
        }}
      >
        {pending ? "⏳" : "ยกเลิก"}
      </button>
    </>
  );
}

export function InstallMenuButton({ installed }: { installed: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        className={`btn ${installed ? "btn-ghost" : "btn-primary"}`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await installMenu();
            setMsg(r.ok ? r.message : `❌ ${r.error}`);
            router.refresh();
          })
        }
      >
        {pending ? "⏳ กำลังติดตั้ง…" : installed ? "🔁 ติดตั้งเมนูร้านใหม่" : "📲 ติดตั้งเมนูร้านในไลน์"}
      </button>
      <Msg text={msg} />
    </div>
  );
}

type Row = PostDefaults & { itemId: number; amount: string };

export function PostButton({ order, options, defaults }: { order: OrderForPost; options: PostOptions; defaults: Record<string, PostDefaults> }) {
  const [open, setOpen] = useState(false);
  const label = order.target === "คลัง" ? "✅ รับเข้าคลัง" : "✅ ลงค่าใช้จ่ายรถ";
  return (
    <>
      <button type="button" className="btn btn-primary whitespace-nowrap" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && <PostDialog order={order} options={options} defaults={defaults} onClose={() => setOpen(false)} />}
    </>
  );
}

function PostDialog({
  order,
  options,
  defaults,
  onClose,
}: {
  order: OrderForPost;
  options: PostOptions;
  defaults: Record<string, PostDefaults>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const todo = order.items.filter((it) => !it.posted);
  const [rows, setRows] = useState<Row[]>(() =>
    todo.map((it) => ({
      itemId: it.id,
      amount: it.shopPrice == null ? "" : String(it.shopPrice),
      ...(defaults[String(it.id)] ?? { kind: "vehicle", plate: "", category: "", itemCode: "" }),
    })),
  );
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const plateOpts = options.plates.map((p) => ({ value: p, label: p }));
  const total = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const missing = rows.filter((r) => r.amount.trim() === "" || (r.kind === "vehicle" ? !r.plate || !r.category : !r.itemCode)).length;

  const submit = () =>
    start(async () => {
      setError(null);
      const lines: PostLine[] = rows.map((r) => ({ itemId: r.itemId, kind: r.kind, plate: r.plate, category: r.category, itemCode: r.itemCode, amount: Number(r.amount) }));
      const res = await postOrder(order.id, lines);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.warning) alert(res.warning);
      onClose();
      router.refresh();
    });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 text-left sm:p-6" onClick={onClose}>
      <div className="card w-full max-w-5xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5">
          <h2 className="min-w-0 truncate text-[15px] font-bold text-slate-900">
            ✅ ลงบัญชี {order.id} — {order.shopName}
          </h2>
          <button type="button" className="btn btn-ghost px-2 py-1" onClick={onClose}>
            ✕ ปิด
          </button>
        </header>
        <div className="p-4">
          <ul className="mb-3 space-y-1 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-[13px] font-medium leading-relaxed text-brand-900">
            <li>– ยอดเงิน = ราคารวมที่ร้านแจ้ง (แก้ได้ถ้าบิลจริงต่าง — ระบบจดไว้ในหมายเหตุว่าร้านแจ้งเท่าไร แก้เป็นเท่าไร)</li>
            <li>– 🚚 รถ → หน้า ค่าใช้จ่าย ของคันนั้น · 📦 คลัง → รับเข้าคลัง (ทุนต่อหน่วย = รวม ÷ จำนวน)</li>
          </ul>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>รายการ</th>
                  <th>จำนวน</th>
                  <th>ลงที่</th>
                  <th>ทะเบียน / สินค้าในคลัง</th>
                  <th>ประเภทค่าใช้จ่าย</th>
                  <th>ร้านแจ้ง</th>
                  <th>ยอดที่ลง (บาท)</th>
                </tr>
              </thead>
              <tbody>
                {todo.map((it, i) => {
                  const r = rows[i];
                  const diff = it.shopPrice != null && r.amount !== "" && Number(r.amount) !== it.shopPrice;
                  return (
                    <tr key={it.id}>
                      <td className="text-left">
                        {it.seq}. {it.description}
                      </td>
                      <td className="whitespace-nowrap">
                        {n(it.qty)} {it.unit ?? ""}
                      </td>
                      <td>
                        <select className="inp w-28" value={r.kind} onChange={(e) => set(i, { kind: e.target.value as Row["kind"] })}>
                          <option value="vehicle">🚚 รถ</option>
                          <option value="stock">📦 คลัง</option>
                        </select>
                      </td>
                      <td>
                        {r.kind === "vehicle" ? (
                          <SearchSelect options={plateOpts} value={r.plate} onChange={(v) => set(i, { plate: v })} placeholder="— เลือกทะเบียน —" invalid={!r.plate} />
                        ) : (
                          <SearchSelect
                            options={options.items}
                            value={r.itemCode}
                            onChange={(v) => set(i, { itemCode: v })}
                            placeholder="— เลือกสินค้าในคลัง —"
                            invalid={!r.itemCode}
                            className="min-w-[14rem]"
                          />
                        )}
                      </td>
                      <td>
                        {r.kind === "vehicle" ? (
                          <select
                            className={`inp w-40 ${r.category ? "" : "border-red-400 bg-red-50 font-bold text-red-700"}`}
                            value={r.category}
                            onChange={(e) => set(i, { category: e.target.value })}
                          >
                            <option value="">— เลือก —</option>
                            {options.categories.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="num">{n(it.shopPrice)}</td>
                      <td>
                        <input
                          className={`inp num w-28 ${diff ? "border-amber-400 bg-amber-50" : ""}`}
                          inputMode="decimal"
                          value={r.amount}
                          onChange={(e) => set(i, { amount: e.target.value.replace(/[^\d.]/g, "") })}
                        />
                        {diff && <div className="text-[11.5px] font-bold text-amber-700">⚠️ ไม่ตรงกับที่ร้านแจ้ง</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6} className="text-right font-bold">
                    รวมที่จะลงบัญชี
                  </td>
                  <td className="num font-bold">{n(Math.round(total * 100) / 100)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {error && <p className="mt-3 whitespace-pre-line rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-primary" onClick={submit} disabled={pending || missing > 0}>
              {pending ? "⏳ กำลังบันทึก…" : `✅ ลงบัญชี ${rows.length} รายการ`}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>
              ยกเลิก
            </button>
            {missing > 0 && <span className="text-[13px] font-bold text-red-700">❌ ยังเลือกไม่ครบ {missing} รายการ (ช่องสีแดง)</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
