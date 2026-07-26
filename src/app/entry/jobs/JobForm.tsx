"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createJob, createReturnLeg, deleteJob, updateJob } from "./actions";
import type { Option } from "@/lib/crud";

export type JobInitial = {
  id: number;
  loadDate: string;
  unloadDate: string;
  tripCode: string;
  headPlate: string;
  trailerPlate: string;
  customerId: string;
  origin: string;
  destination: string;
  weightOrigin: string;
  weightDest: string;
  cargoType: string;
  note: string;
};

export function JobForm({
  vehicles,
  trailers,
  customers,
  locations,
  cargoTypes,
  initial,
}: {
  vehicles: Option[];
  trailers: Option[];
  customers: Option[];
  locations: Option[];
  cargoTypes: Option[];
  initial?: JobInitial;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const editing = !!initial;

  const today = new Date().toISOString().slice(0, 10);

  const onSubmit = (form: FormData) => {
    setError(null);
    start(async () => {
      const res = editing ? await updateJob(initial.id, form) : await createJob(form);
      if (!res.ok) {
        setError(res.error ?? "บันทึกไม่สำเร็จ");
        return;
      }
      if (editing) router.push("?");
      else router.refresh();
    });
  };

  return (
    <form action={onSubmit} key={initial?.id ?? "new"}>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <div>
          <label className="lbl">วันที่ขึ้นสินค้า <span className="text-red-500">*</span></label>
          <input type="date" name="loadDate" className="inp" defaultValue={initial?.loadDate ?? today} required />
        </div>
        <div>
          <label className="lbl">วันที่ลงสินค้า</label>
          <input type="date" name="unloadDate" className="inp" defaultValue={initial?.unloadDate ?? ""} />
          <p className="mt-0.5 text-[11px] text-slate-400">เว้นว่าง = วันเดียวกับวันขึ้นสินค้า</p>
        </div>
        <div>
          <label className="lbl">ทะเบียนแม่ (หัวลาก/รถเดี่ยว) <span className="text-red-500">*</span></label>
          <select name="headPlate" className="inp" defaultValue={initial?.headPlate ?? ""} required>
            <option value="">— เลือก —</option>
            {vehicles.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="lbl">หางพ่วง</label>
          <select name="trailerPlate" className="inp" defaultValue={initial?.trailerPlate ?? ""}>
            <option value="">— ไม่มี —</option>
            {trailers.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
          <p className="mt-0.5 text-[11px] text-slate-400">ระบบใช้ทะเบียนแม่+หางพ่วง หา พขร. ให้เอง</p>
        </div>

        <div>
          <label className="lbl">ลูกค้า <span className="text-red-500">*</span></label>
          <select name="customerId" className="inp" defaultValue={initial?.customerId ?? ""} required>
            <option value="">— เลือก —</option>
            {customers.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="lbl">ต้นทาง <span className="text-red-500">*</span></label>
          <select name="origin" className="inp" defaultValue={initial?.origin ?? ""} required>
            <option value="">— เลือก —</option>
            {locations.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="lbl">ปลายทาง <span className="text-red-500">*</span></label>
          <select name="destination" className="inp" defaultValue={initial?.destination ?? ""} required>
            <option value="">— เลือก —</option>
            {locations.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="lbl">ประเภทสินค้า</label>
          <select name="cargoType" className="inp" defaultValue={initial?.cargoType ?? ""}>
            <option value="">— ไม่ระบุ —</option>
            {cargoTypes.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="lbl">น้ำหนักต้นทาง (ตัน)</label>
          <input type="number" step="0.01" name="weightOrigin" className="inp" defaultValue={initial?.weightOrigin ?? ""} />
        </div>
        <div>
          <label className="lbl">น้ำหนักปลายทาง (ตัน)</label>
          <input type="number" step="0.01" name="weightDest" className="inp" defaultValue={initial?.weightDest ?? ""} />
          <p className="mt-0.5 text-[11px] text-slate-400">ระบบเลือกใช้ตัวไหนตามเกณฑ์ของลูกค้ารายนั้น</p>
        </div>
        <div>
          <label className="lbl">รหัสรอบ</label>
          <input name="tripCode" className="inp" defaultValue={initial?.tripCode ?? ""} placeholder="เว้นว่าง = ตั้งให้อัตโนมัติ" />
          <p className="mt-0.5 text-[11px] text-slate-400">ขาไป+ขากลับของรอบเดียวกัน ต้องใช้รหัสนี้ตรงกัน</p>
        </div>
        <div>
          <label className="lbl">หมายเหตุ</label>
          <input name="note" className="inp" defaultValue={initial?.note ?? ""} />
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "กำลังบันทึก…" : editing ? "บันทึกการแก้ไข" : "+ บันทึกงาน"}
        </button>
        {editing && (
          <button type="button" className="btn btn-ghost" onClick={() => router.push("?")} disabled={pending}>
            ยกเลิก
          </button>
        )}
      </div>
    </form>
  );
}

export function JobRowActions({ id, canReturn }: { id: number; canReturn: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="flex gap-1">
      {canReturn && (
        <button
          type="button"
          className="btn btn-ghost px-2 py-1 text-[12px]"
          title="สร้างขากลับ: สลับต้นทาง-ปลายทาง ใช้รหัสรอบเดิม"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await createReturnLeg(id);
              if (!res.ok) alert(res.error);
              else router.refresh();
            })
          }
        >
          + ขากลับ
        </button>
      )}
      <a href={`?edit=${id}`} className="btn btn-ghost px-2 py-1 text-[12px]">
        แก้ไข
      </a>
      <button
        type="button"
        className="btn btn-danger px-2 py-1 text-[12px]"
        disabled={pending}
        onClick={() => {
          if (!confirm("ยืนยันลบงานนี้?")) return;
          start(async () => {
            const res = await deleteJob(id);
            if (!res.ok) alert(res.error);
            else router.refresh();
          });
        }}
      >
        ลบ
      </button>
    </div>
  );
}
