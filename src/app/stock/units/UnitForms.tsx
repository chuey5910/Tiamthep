"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createSerialUnits, deleteSerialUnit, saveScrap } from "./actions";
import type { Option } from "@/lib/crud";

export function SerialUnitForm({ items, suppliers }: { items: Option[]; suppliers: Option[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      action={(form) => {
        setError(null);
        start(async () => {
          const res = await createSerialUnits(form);
          if (!res.ok) setError(res.error ?? "บันทึกไม่สำเร็จ");
          else router.refresh();
        });
      }}
    >
      <div className="grid gap-3 lg:grid-cols-4">
        <div>
          <label className="lbl">วันที่รับเข้า <span className="text-red-500">*</span></label>
          <input type="date" name="receivedAt" className="inp" defaultValue={new Date().toISOString().slice(0, 10)} required />
        </div>
        <div className="lg:col-span-2">
          <label className="lbl">สินค้า <span className="text-red-500">*</span></label>
          <select name="itemCode" className="inp" required>
            <option value="">— เลือก —</option>
            {items.map((i) => (
              <option key={i.value} value={i.value}>{i.label}</option>
            ))}
          </select>
          <p className="mt-0.5 text-[11px] text-slate-400">แสดงเฉพาะสินค้าที่ตั้งประเภทการติดตามเป็น &laquo;รายชิ้น&raquo;</p>
        </div>
        <div>
          <label className="lbl">จำนวนที่รับเข้า (ชิ้น) <span className="text-red-500">*</span></label>
          <input type="number" name="qty" className="inp" defaultValue={1} min={1} max={50} required />
          <p className="mt-0.5 text-[11px] text-slate-400">ระบบออกรหัสอุปกรณ์ให้ทีละชิ้น</p>
        </div>
        <div>
          <label className="lbl">ยี่ห้อ / รุ่น</label>
          <input name="brand" className="inp" placeholder="Bridgestone R150" />
        </div>
        <div>
          <label className="lbl">ราคาทุนต่อชิ้น (บาท)</label>
          <input type="number" step="0.01" name="cost" className="inp" />
        </div>
        <div>
          <label className="lbl">ผู้ขาย / ร้านค้า</label>
          <select name="vendor" className="inp">
            <option value="">— ไม่ระบุ —</option>
            {suppliers.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="lbl">เลขที่บิล</label>
          <input name="billNo" className="inp" />
        </div>
        <div className="lg:col-span-4">
          <label className="lbl">Serial / DOT (กรอกทีละบรรทัด หรือคั่นด้วยจุลภาค)</label>
          <textarea name="serials" className="inp" rows={2} placeholder="DOT 1234ABC5026&#10;DOT 1234ABC5126" />
          <p className="mt-0.5 text-[11px] text-slate-400">
            เว้นว่างได้ แต่ถ้ากรอก ต้องมีจำนวนเท่ากับจำนวนชิ้นที่รับเข้า · แนะนำถ่ายรูป serial เก็บไว้คู่กับรหัสอุปกรณ์
          </p>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</p>
      )}

      <div className="mt-4">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "กำลังบันทึก…" : "+ รับอุปกรณ์เข้าสต็อก"}
        </button>
      </div>
    </form>
  );
}

export function DeleteUnitButton({ code }: { code: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-danger px-2 py-1 text-[12px]"
      disabled={pending}
      onClick={() => {
        if (!confirm(`ยืนยันลบอุปกรณ์ ${code}?`)) return;
        start(async () => {
          const res = await deleteSerialUnit(code);
          if (!res.ok) alert(res.error);
          else router.refresh();
        });
      }}
    >
      ลบ
    </button>
  );
}

export type ScrapInitial = {
  treadMm: string;
  status: string;
  buyer: string;
  salePrice: string;
  soldAt: string;
  note: string;
};

/** ฟอร์มแถวเดียวสำหรับบันทึกสถานะของเก่า — แก้ในตารางได้เลย ไม่ต้องเปิดหน้าใหม่ */
export function ScrapRowForm({ unitCode, initial }: { unitCode: string; initial: ScrapInitial }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <form
      className="contents"
      action={(form) => {
        setError(null);
        setSaved(false);
        start(async () => {
          const res = await saveScrap(unitCode, form);
          if (!res.ok) setError(res.error ?? "บันทึกไม่สำเร็จ");
          else {
            setSaved(true);
            router.refresh();
          }
        });
      }}
    >
      <td className="num">
        <input name="treadMm" type="number" step="0.1" className="inp w-20 text-right" defaultValue={initial.treadMm} />
      </td>
      <td>
        <select name="status" className="inp w-28" defaultValue={initial.status}>
          <option value="รอขาย">รอขาย</option>
          <option value="ขายแล้ว">ขายแล้ว</option>
          <option value="ทิ้ง">ทิ้ง</option>
          <option value="ส่งหล่อดอก">ส่งหล่อดอก</option>
        </select>
      </td>
      <td>
        <input name="buyer" className="inp w-32" defaultValue={initial.buyer} />
      </td>
      <td className="num">
        <input name="salePrice" type="number" step="0.01" className="inp w-24 text-right" defaultValue={initial.salePrice} />
      </td>
      <td>
        <input name="soldAt" type="date" className="inp w-36" defaultValue={initial.soldAt} />
      </td>
      <td className="no-print">
        <button className="btn btn-ghost px-2 py-1 text-[12px]" disabled={pending}>
          {pending ? "…" : saved ? "✓ บันทึกแล้ว" : "บันทึก"}
        </button>
        {error && <div className="mt-0.5 text-[10px] text-red-600">{error}</div>}
      </td>
    </form>
  );
}
