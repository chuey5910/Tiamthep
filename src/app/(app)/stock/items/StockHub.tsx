"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";
import { baht, num } from "@/lib/format";
import { createRecord, deleteRecord, updateRecord } from "../../crud/actions";
import type { Option } from "@/lib/crud";

export type MoveView = {
  id: number;
  kind: "in" | "out";
  date: string;
  qty: number;
  /** รับเข้า = ราคาต่อหน่วย · เบิก = มูลค่าที่เบิกทั้งรายการ */
  money: number;
  party: string | null;
  ref: string | null;
  plate: string | null;
  position: string | null;
  note: string | null;
};

export type ItemView = {
  code: string;
  name: string;
  category: string | null;
  unit: string;
  trackingType: string;
  reorderPoint: number;
  note: string | null;
  inQty: number;
  outQty: number;
  balance: number;
  lastCost: number;
  value: number;
  lastMoveDate: string | null;
  moves: MoveView[];
};

type Dialog =
  | { kind: "receive"; item: ItemView }
  | { kind: "issue"; item: ItemView }
  | { kind: "item"; item?: ItemView }
  | { kind: "moves"; item: ItemView };

const today = () => new Date().toISOString().slice(0, 10);
const fold = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, "");

export function StockHub({
  items,
  units,
  suppliers,
  vehicles,
}: {
  items: ItemView[];
  units: Option[];
  suppliers: Option[];
  vehicles: Option[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "low" | "moved">("all");
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const shown = useMemo(() => {
    const fq = fold(q);
    return items.filter((it) => {
      if (only === "low" && !(it.balance <= it.reorderPoint)) return false;
      if (only === "moved" && it.moves.length === 0) return false;
      if (!fq) return true;
      return [it.code, it.name, it.category, it.unit, it.trackingType, it.note].some((v) => fold(v).includes(fq));
    });
  }, [items, q, only]);

  const totalValue = shown.reduce((a, it) => a + it.value, 0);

  return (
    <>
      <div className="no-print card mb-4 flex flex-wrap items-end gap-3 p-3">
        <div>
          <label className="lbl">ค้นหา</label>
          <input
            className="inp w-72"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="รหัส ชื่อสินค้า หมวดหมู่ หน่วย…"
          />
        </div>
        <div>
          <label className="lbl">แสดง</label>
          <select className="inp w-56" value={only} onChange={(e) => setOnly(e.target.value as typeof only)}>
            <option value="all">— ทุกรายการ —</option>
            <option value="low">เฉพาะที่ต้องสั่งซื้อ</option>
            <option value="moved">เฉพาะที่เคยมีความเคลื่อนไหว</option>
          </select>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: "item" })}>
          + เพิ่มสินค้าใหม่
        </button>
        <span className="pb-2 text-[12px] text-slate-500">
          พบ {shown.length} จาก {items.length} รายการ · มูลค่าคงเหลือรวม {baht(totalValue)} บาท
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>รหัส</th>
              <th>ชื่อสินค้า</th>
              <th>หมวดหมู่</th>
              <th>หน่วย</th>
              <th>การติดตาม</th>
              <th className="num">รับเข้าสะสม</th>
              <th className="num">เบิกออกสะสม</th>
              <th className="num">คงเหลือ</th>
              <th className="num">จุดสั่งซื้อ</th>
              <th className="num">ทุนล่าสุด/หน่วย</th>
              <th className="num">มูลค่าคงเหลือ</th>
              <th>เคลื่อนไหวล่าสุด</th>
              <th className="no-print">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={13} className="px-4 py-8 text-center text-slate-500">
                  ไม่พบสินค้าตามเงื่อนไขที่กรอง
                </td>
              </tr>
            )}
            {shown.map((it) => {
              const low = it.balance <= it.reorderPoint;
              return (
                <tr key={it.code} className={low ? "row-danger" : undefined}>
                  <td className="font-bold">{it.code}</td>
                  <td>{it.name}</td>
                  <td className="text-slate-600">{it.category || "-"}</td>
                  <td className="text-slate-600">{it.unit}</td>
                  <td>
                    <Badge tone={it.trackingType === "รายชิ้น" ? "info" : "muted"}>{it.trackingType}</Badge>
                  </td>
                  <td className="num">{num(it.inQty, 0)}</td>
                  <td className="num">{num(it.outQty, 0)}</td>
                  <td className="num font-bold">{num(it.balance, 0)}</td>
                  <td className="num text-slate-600">{num(it.reorderPoint, 0)}</td>
                  <td className="num">{it.lastCost ? baht(it.lastCost) : "-"}</td>
                  <td className="num">{it.value ? baht(it.value) : "-"}</td>
                  <td className="whitespace-nowrap text-[12px] text-slate-600">
                    {it.lastMoveDate ? (
                      <button
                        type="button"
                        className="underline decoration-dotted underline-offset-2 hover:text-brand-700"
                        onClick={() => setDialog({ kind: "moves", item: it })}
                      >
                        {it.lastMoveDate} ({it.moves.length} รายการ)
                      </button>
                    ) : (
                      "ยังไม่มี"
                    )}
                  </td>
                  <td className="no-print">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        className="btn btn-ghost px-2 py-1 text-[12px]"
                        onClick={() => setDialog({ kind: "receive", item: it })}
                      >
                        📥 รับเข้า
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost px-2 py-1 text-[12px]"
                        onClick={() => setDialog({ kind: "issue", item: it })}
                      >
                        📤 เบิกใช้
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost px-2 py-1 text-[12px]"
                        onClick={() => setDialog({ kind: "item", item: it })}
                      >
                        แก้ไข
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {dialog?.kind === "receive" && (
        <FormDialog
          title={`📥 รับเข้าสต็อก — ${dialog.item.code} ${dialog.item.name}`}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            router.refresh();
          }}
          submit={(form) => {
            form.set("itemCode", dialog.item.code);
            return createRecord("stock-in", form);
          }}
        >
          {(item = dialog.item) => (
            <>
              <F label="วันที่รับเข้า" required>
                <input type="date" name="date" className="inp" defaultValue={today()} required />
              </F>
              <F label={`จำนวนที่รับเข้า (${item.unit})`} required>
                <input type="number" step="1" min="1" name="qty" className="inp" required />
              </F>
              <F label="ราคาต่อหน่วย (บาท)" help={item.lastCost ? `ครั้งก่อน ${baht(item.lastCost)} บาท` : undefined}>
                <input type="number" step="1" min="0" name="unitCost" className="inp" defaultValue={item.lastCost || ""} />
              </F>
              <F label="ผู้ขาย / ร้านค้า">
                <Select name="vendor" options={suppliers} empty="— ไม่ระบุ —" />
              </F>
              <F label="เลขที่บิล / ใบกำกับ">
                <input name="billNo" className="inp" />
              </F>
              <F label="หมายเหตุ" wide>
                <input name="note" className="inp" />
              </F>
            </>
          )}
        </FormDialog>
      )}

      {dialog?.kind === "issue" && (
        <FormDialog
          title={`📤 เบิกใช้สต็อก — ${dialog.item.code} ${dialog.item.name}`}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            router.refresh();
          }}
          submit={(form) => {
            form.set("itemCode", dialog.item.code);
            return createRecord("stock-out", form);
          }}
        >
          {(item = dialog.item) => (
            <>
              <p className="lg:col-span-4 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-[12px] font-medium text-brand-900">
                – คงเหลือตอนนี้ <b>{num(item.balance, 0)} {item.unit}</b> · เบิกแล้วระบบตัดสต็อกและคิดเป็นต้นทุนของรถคันที่เลือกให้เอง
                {item.trackingType === "รายชิ้น" && " · ของรายชิ้น ให้กรอกรหัสอุปกรณ์ใหม่/เก่าด้วย"}
              </p>
              <F label="วันที่เบิก" required>
                <input type="date" name="date" className="inp" defaultValue={today()} required />
              </F>
              <F label={`จำนวนที่เบิก (${item.unit})`} required>
                <input type="number" step="1" min="1" name="qty" className="inp" required />
              </F>
              <F label="ทะเบียนรถที่ใช้">
                <Select name="plate" options={vehicles} empty="— ไม่ระบุ —" />
              </F>
              <F label="ตำแหน่ง (เช่น ล้อหน้าซ้าย)">
                <input name="position" className="inp" />
              </F>
              <F label="อู่ / ผู้ขาย">
                <Select name="vendor" options={suppliers} empty="— ไม่ระบุ —" />
              </F>
              <F label="รหัสสั่งซ่อม">
                <input name="workOrder" className="inp" />
              </F>
              <F label="ผู้เบิก">
                <input name="issuedBy" className="inp" />
              </F>
              <F label="มูลค่าที่เบิก (บาท)" help="เว้นว่าง = คิดจากทุนล่าสุด × จำนวน">
                <input type="number" step="1" min="0" name="cost" className="inp" />
              </F>
              {item.trackingType === "รายชิ้น" && (
                <>
                  <F label="รหัสอุปกรณ์ใหม่ที่ติดตั้ง" help="ดูรหัสที่หน้าทะเบียนยาง/แบตเตอรี่">
                    <input name="newUnitCode" className="inp" placeholder="TU00001" />
                  </F>
                  <F label="รหัสอุปกรณ์เก่าที่ถอด" help="กรอกแล้วชิ้นนี้เข้าทะเบียนของเก่ารอขายทันที">
                    <input name="oldUnitCode" className="inp" placeholder="TU00007" />
                  </F>
                </>
              )}
              <F label="หมายเหตุ" wide>
                <input name="note" className="inp" />
              </F>
            </>
          )}
        </FormDialog>
      )}

      {dialog?.kind === "item" && (
        <FormDialog
          title={dialog.item ? `แก้ไขสินค้า — ${dialog.item.code}` : "เพิ่มสินค้าใหม่"}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            router.refresh();
          }}
          onDelete={
            dialog.item && dialog.item.moves.length === 0
              ? () => deleteRecord("items", dialog.item!.code)
              : undefined
          }
          submit={(form) =>
            dialog.item ? updateRecord("items", dialog.item.code, form) : createRecord("items", form)
          }
        >
          {(item = dialog.item) => (
            <>
              <F label="รหัสสินค้า" required>
                <input name="code" className="inp" defaultValue={item?.code ?? ""} required disabled={!!item} />
              </F>
              <F label="ชื่อสินค้า" required wide2>
                <input name="name" className="inp" defaultValue={item?.name ?? ""} required />
              </F>
              <F label="หมวดหมู่">
                <input name="category" className="inp" defaultValue={item?.category ?? ""} />
              </F>
              <F label="หน่วยนับ">
                <Select name="unit" options={units} empty="— ไม่ระบุ —" value={item?.unit} />
              </F>
              <F label="ประเภทการติดตาม" help="รายชิ้น = ของมูลค่าสูงที่ต้องรู้ serial (ยาง/แบตเตอรี่)">
                <select name="trackingType" className="inp" defaultValue={item?.trackingType ?? "จำนวน"}>
                  <option value="จำนวน">จำนวน</option>
                  <option value="รายชิ้น">รายชิ้น</option>
                </select>
              </F>
              <F label="จุดสั่งซื้อขั้นต่ำ" help="คงเหลือต่ำกว่านี้จะขึ้นเตือน">
                <input type="number" step="1" min="0" name="reorderPoint" className="inp" defaultValue={item?.reorderPoint ?? 0} />
              </F>
              <F label="หมายเหตุ" wide>
                <input name="note" className="inp" defaultValue={item?.note ?? ""} />
              </F>
            </>
          )}
        </FormDialog>
      )}

      {dialog?.kind === "moves" && (
        <Dialog title={`ความเคลื่อนไหว — ${dialog.item.code} ${dialog.item.name}`} onClose={() => setDialog(null)}>
          <MoveTable item={dialog.item} onDeleted={() => router.refresh()} />
        </Dialog>
      )}
    </>
  );
}

function MoveTable({ item, onDeleted }: { item: ItemView; onDeleted: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // moves เรียงจากเก่าไปใหม่ — เดินยอดสะสมตามลำดับนั้น แล้วค่อยกลับด้านให้ใหม่สุดอยู่บนสุด
  let running = 0;
  const lines = item.moves.map((m) => {
    running += m.kind === "in" ? m.qty : -m.qty;
    return { m, balance: Math.round(running * 100) / 100 };
  });
  lines.reverse();

  return (
    <>
      {error && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</p>
      )}
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>วันที่</th>
              <th>ประเภท</th>
              <th className="num">จำนวน</th>
              <th className="num">คงเหลือหลังรายการ</th>
              <th className="num">ราคา/มูลค่า</th>
              <th>ผู้ขาย / อู่</th>
              <th>บิล / รหัสสั่งซ่อม</th>
              <th>ทะเบียน · ตำแหน่ง</th>
              <th>หมายเหตุ</th>
              <th className="no-print"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ m, balance: bal }) => (
                <tr key={`${m.kind}${m.id}`}>
                  <td className="whitespace-nowrap">{m.date}</td>
                  <td>
                    <Badge tone={m.kind === "in" ? "ok" : "warn"}>{m.kind === "in" ? "📥 รับเข้า" : "📤 เบิกใช้"}</Badge>
                  </td>
                  <td className={`num font-bold ${m.kind === "in" ? "text-emerald-700" : "text-red-600"}`}>
                    {m.kind === "in" ? "+" : "-"}
                    {num(m.qty, 0)}
                  </td>
                  <td className="num">{num(bal, 0)}</td>
                  <td className="num">
                    {m.money ? baht(m.money) : "-"}
                    <span className="ml-1 text-[10px] text-slate-500">{m.kind === "in" ? "/หน่วย" : "รวม"}</span>
                  </td>
                  <td>{m.party ?? "-"}</td>
                  <td>{m.ref ?? "-"}</td>
                  <td>{[m.plate, m.position].filter(Boolean).join(" · ") || "-"}</td>
                  <td className="text-[12px] text-slate-600">{m.note ?? "-"}</td>
                  <td className="no-print">
                    <button
                      type="button"
                      className="btn btn-danger px-2 py-1 text-[12px]"
                      disabled={pending}
                      onClick={() => {
                        if (!confirm("ยืนยันลบรายการนี้? สต็อกคงเหลือจะถูกคำนวณใหม่")) return;
                        setError(null);
                        start(async () => {
                          const res = await deleteRecord(m.kind === "in" ? "stock-in" : "stock-out", String(m.id));
                          if (!res.ok) setError(res.error ?? "ลบไม่สำเร็จ");
                          else onDeleted();
                        });
                      }}
                    >
                      ลบ
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** ช่องกรอก 1 ช่องในฟอร์ม (จัดเป็นกริด 4 คอลัมน์เหมือนฟอร์มอื่นทั้งเว็บ) */
function F({
  label,
  children,
  required,
  help,
  wide,
  wide2,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  help?: string;
  wide?: boolean;
  wide2?: boolean;
}) {
  return (
    <div className={wide ? "lg:col-span-4" : wide2 ? "lg:col-span-2" : undefined}>
      <label className="lbl">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {help && <p className="mt-0.5 text-[12px] text-slate-500">– {help}</p>}
    </div>
  );
}

function Select({
  name,
  options,
  empty,
  value,
}: {
  name: string;
  options: Option[];
  empty: string;
  value?: string;
}) {
  return (
    <select name={name} className="inp" defaultValue={value ?? ""}>
      <option value="">{empty}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6" onClick={onClose}>
      <div className="card w-full max-w-5xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5">
          <h2 className="text-[15px] font-bold text-slate-900">{title}</h2>
          <button type="button" className="btn btn-ghost px-2 py-1" onClick={onClose}>
            ✕ ปิด
          </button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function FormDialog({
  title,
  children,
  submit,
  onClose,
  onDone,
  onDelete,
}: {
  title: string;
  children: () => React.ReactNode;
  submit: (form: FormData) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
  onDone: () => void;
  onDelete?: () => Promise<{ ok: boolean; error?: string }>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Dialog title={title} onClose={onClose}>
      <form
        action={(form) => {
          setError(null);
          start(async () => {
            const res = await submit(form);
            if (!res.ok) setError(res.error ?? "บันทึกไม่สำเร็จ");
            else onDone();
          });
        }}
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">{children()}</div>

        {error && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={pending}>
            {pending ? "กำลังบันทึก…" : "บันทึก"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>
            ยกเลิก
          </button>
          {onDelete && (
            <button
              type="button"
              className="btn btn-danger ml-auto"
              disabled={pending}
              onClick={() => {
                if (!confirm("ยืนยันลบสินค้านี้?")) return;
                setError(null);
                start(async () => {
                  const res = await onDelete();
                  if (!res.ok) setError(res.error ?? "ลบไม่สำเร็จ");
                  else onDone();
                });
              }}
            >
              ลบสินค้า
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
