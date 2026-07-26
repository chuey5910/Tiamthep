"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { copyPricesFrom, deleteRoute, fillPriceLadder, savePrices, saveRoute } from "./actions";
import type { Option } from "@/lib/crud";

export type RouteRow = {
  id: number;
  origin: string;
  destination: string;
  vehicleType: string;
  priceUnit: string;
  distanceKm: number | null;
  targetKmPerL: number | null;
  allowance: number;
  note: string | null;
  active: boolean;
  kpiLitres: number | null;
  pricedBands: number;
};

export function RouteForm({
  locations,
  vehicleTypes,
  initial,
}: {
  locations: Option[];
  vehicleTypes: Option[];
  initial?: RouteRow;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const editing = !!initial;

  return (
    <form
      key={initial?.id ?? "new"}
      action={(form) => {
        setError(null);
        start(async () => {
          const res = await saveRoute(initial?.id ?? null, form);
          if (!res.ok) setError(res.error ?? "บันทึกไม่สำเร็จ");
          else if (editing) router.push("?");
          else router.refresh();
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
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
          <label className="lbl">ประเภทรถ <span className="text-red-500">*</span></label>
          <select name="vehicleType" className="inp" defaultValue={initial?.vehicleType ?? ""} required>
            <option value="">— เลือก —</option>
            {vehicleTypes.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="lbl">หน่วยคิดราคา</label>
          <select name="priceUnit" className="inp" defaultValue={initial?.priceUnit ?? "ต่อเที่ยว"}>
            <option value="ต่อเที่ยว">ต่อเที่ยว</option>
            <option value="ต่อตัน">ต่อตัน</option>
          </select>
        </div>

        <div>
          <label className="lbl">ระยะทางขาเดียว (กม.)</label>
          <input type="number" step="0.1" name="distanceKm" className="inp" defaultValue={initial?.distanceKm ?? ""} />
          <p className="mt-0.5 text-[11px] text-amber-700">⚠ ขาเดียว ไม่ใช่ไป-กลับ</p>
        </div>
        <div>
          <label className="lbl">อัตราสิ้นเปลืองเป้าหมาย (กม./ลิตร)</label>
          <input type="number" step="0.01" name="targetKmPerL" className="inp" defaultValue={initial?.targetKmPerL ?? ""} />
          <p className="mt-0.5 text-[11px] text-slate-400">ใช้เป็น KPI คุมต้นทุนน้ำมันของ พขร.</p>
        </div>
        <div>
          <label className="lbl">เบี้ยเลี้ยงต่อขา (บาท)</label>
          <input type="number" step="0.01" name="allowance" className="inp" defaultValue={initial?.allowance ?? 0} />
        </div>
        <div>
          <label className="lbl">ใช้งานอยู่</label>
          <label className="flex h-[38px] items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={initial?.active ?? true} className="h-4 w-4 rounded" />
            ใช่
          </label>
        </div>
        <div className="lg:col-span-4">
          <label className="lbl">หมายเหตุ</label>
          <input name="note" className="inp" defaultValue={initial?.note ?? ""} />
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</p>
      )}

      <div className="mt-4 flex gap-2">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "กำลังบันทึก…" : editing ? "บันทึกการแก้ไข" : "+ เพิ่มเส้นทาง"}
        </button>
        {editing && (
          <button type="button" className="btn btn-ghost" onClick={() => router.push("?")}>
            ยกเลิก
          </button>
        )}
      </div>
    </form>
  );
}

export function RouteActions({ id }: { id: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-1">
      <a href={`?route=${id}`} className="btn btn-ghost px-2 py-1 text-[12px]">
        ตั้งราคา
      </a>
      <a href={`?edit=${id}`} className="btn btn-ghost px-2 py-1 text-[12px]">
        แก้ไข
      </a>
      <button
        type="button"
        className="btn btn-danger px-2 py-1 text-[12px]"
        disabled={pending}
        onClick={() => {
          if (!confirm("ยืนยันลบเส้นทางนี้? ราคาทั้งหมดของเส้นทางจะถูกลบด้วย")) return;
          start(async () => {
            const res = await deleteRoute(id);
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

export type BandRow = { id: number; label: string; minPrice: number; maxPrice: number };
export type PriceRow = { bandId: number; customerPrice: number | null; outsourcePrice: number | null };

export function PriceMatrix({
  routeId,
  routeLabel,
  priceUnit,
  bands,
  prices,
  otherRoutes,
}: {
  routeId: number;
  routeLabel: string;
  priceUnit: string;
  bands: BandRow[];
  prices: PriceRow[];
  otherRoutes: Option[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const byBand = new Map(prices.map((p) => [p.bandId, p]));

  const [ladderBand, setLadderBand] = useState<string>(String(bands[0]?.id ?? ""));
  const [cStep, setCStep] = useState("150");
  const [oStep, setOStep] = useState("140");
  const [copyFrom, setCopyFrom] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    setError(null);
    setMsg(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "ไม่สำเร็จ");
      else {
        setMsg(success);
        router.refresh();
      }
    });
  };

  return (
    <div>
      <p className="mb-3 text-[13px] text-slate-600">
        ตั้งราคาของเส้นทาง <b>{routeLabel}</b> — ราคาเป็นบาท <b>{priceUnit}</b> ·
        เว้นช่องว่างไว้ได้ถ้าไม่มีราคาที่ช่วงนั้น
      </p>

      {/* เครื่องมือช่วยกรอก — ไม่ต้องพิมพ์ทีละ 22 ช่อง */}
      <div className="mb-4 grid gap-3 rounded-lg border border-[var(--border)] bg-slate-50 p-3 lg:grid-cols-2">
        <div>
          <div className="mb-1.5 text-[12px] font-bold text-slate-700">เติมราคาแบบขั้นบันได</div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="lbl">ใช้ช่วงนี้เป็นฐาน</label>
              <select className="inp w-36" value={ladderBand} onChange={(e) => setLadderBand(e.target.value)}>
                {bands.map((b) => (
                  <option key={b.id} value={b.id}>{b.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="lbl">+ ลูกค้า/ช่วง</label>
              <input className="inp w-24" value={cStep} onChange={(e) => setCStep(e.target.value)} />
            </div>
            <div>
              <label className="lbl">+ รถร่วม/ช่วง</label>
              <input className="inp w-24" value={oStep} onChange={(e) => setOStep(e.target.value)} />
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={pending}
              onClick={() =>
                run(
                  () => fillPriceLadder(routeId, Number(ladderBand), Number(cStep) || 0, Number(oStep) || 0),
                  "เติมราคาให้ทุกช่วงแล้ว",
                )
              }
            >
              เติมให้ทุกช่วง
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            กรอกราคาช่วงฐานแล้วกดปุ่มนี้ ระบบจะไล่ราคาช่วงอื่นให้ ทั้งขึ้นและลง
          </p>
        </div>

        <div>
          <div className="mb-1.5 text-[12px] font-bold text-slate-700">คัดลอกราคาจากเส้นทางอื่น</div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="lbl">คัดลอกจาก</label>
              <select className="inp w-72" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                <option value="">— เลือกเส้นทาง —</option>
                {otherRoutes.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={pending || !copyFrom}
              onClick={() => run(() => copyPricesFrom(routeId, Number(copyFrom)), "คัดลอกราคามาแล้ว")}
            >
              คัดลอก
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">ใช้ตอนเพิ่มเส้นทางขากลับ ที่ราคาใกล้เคียงกัน</p>
        </div>
      </div>

      <form
        action={(form) => {
          setError(null);
          setMsg(null);
          start(async () => {
            const res = await savePrices(routeId, form);
            if (!res.ok) setError(res.error ?? "บันทึกไม่สำเร็จ");
            else {
              setMsg("บันทึกราคาแล้ว");
              router.refresh();
            }
          });
        }}
      >
        <div className="max-h-[28rem] overflow-y-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>ช่วงราคาน้ำมัน (บาท/ลิตร)</th>
                <th className="num">ราคาลูกค้า</th>
                <th className="num">ราคาจ่ายรถร่วม</th>
                <th className="num">ส่วนต่าง</th>
              </tr>
            </thead>
            <tbody>
              {bands.map((b) => {
                const p = byBand.get(b.id);
                const diff =
                  p?.customerPrice != null && p?.outsourcePrice != null
                    ? p.customerPrice - p.outsourcePrice
                    : null;
                return (
                  <tr key={b.id}>
                    <td className="font-medium">{b.label}</td>
                    <td className="num">
                      <input
                        name={`c_${b.id}`}
                        type="number"
                        step="0.01"
                        className="inp w-28 text-right"
                        defaultValue={p?.customerPrice ?? ""}
                      />
                    </td>
                    <td className="num">
                      <input
                        name={`o_${b.id}`}
                        type="number"
                        step="0.01"
                        className="inp w-28 text-right"
                        defaultValue={p?.outsourcePrice ?? ""}
                      />
                    </td>
                    <td className={`num ${diff != null && diff < 0 ? "text-red-700" : "text-slate-500"}`}>
                      {diff != null ? diff.toLocaleString("th-TH") : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</p>
        )}
        {msg && (
          <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
            {msg}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button className="btn btn-primary" disabled={pending}>
            {pending ? "กำลังบันทึก…" : "บันทึกราคาทั้งหมด"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => router.push("?")}>
            ปิด
          </button>
        </div>
      </form>
    </div>
  );
}
