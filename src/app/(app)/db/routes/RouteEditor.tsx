"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { copyPricesFrom, deleteRoute, savePrices, saveRoute } from "./actions";
import { PRICE_UNITS } from "@/lib/price-unit";
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

/** ให้ค่าที่แถวนี้ใช้อยู่เป็นตัวเลือกเสมอ — ถึงชื่อนั้นจะถูกลบจากรายการตัวเลือกไปแล้ว ก็ยังแก้ช่องอื่นแล้วบันทึกได้ */
function withCurrent(options: Option[], current: string | undefined): Option[] {
  if (!current || options.some((o) => o.value === current)) return options;
  return [{ value: current, label: `${current} (ชื่อเดิมของแถวนี้)` }, ...options];
}

export function RouteForm({
  locations,
  vehicleTypes,
  initial,
  backHref = "?",
}: {
  locations: Option[];
  vehicleTypes: Option[];
  initial?: RouteRow;
  backHref?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const editing = !!initial;

  const originOptions = withCurrent(locations, initial?.origin);
  const destinationOptions = withCurrent(locations, initial?.destination);
  const vehicleTypeOptions = withCurrent(vehicleTypes, initial?.vehicleType);

  return (
    <form
      key={initial?.id ?? "new"}
      action={(form) => {
        setError(null);
        start(async () => {
          const res = await saveRoute(initial?.id ?? null, form);
          if (!res.ok) setError(res.error ?? "บันทึกไม่สำเร็จ");
          else if (editing) router.push(backHref);
          else router.refresh();
        });
      }}
    >
      {editing && (
        <p className="mb-3 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-[12px] text-brand-900">
          กำลังแก้ไขเส้นทาง <b>#{initial.id}</b> — ทุกช่องแสดงค่าเดิมของแถวนี้ แก้เฉพาะช่องที่ต้องการแล้วกด «บันทึกการแก้ไข»
          จะมีผลกับแถวนี้แถวเดียว
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <div>
          <label className="lbl">ต้นทาง <span className="text-red-500">*</span></label>
          <select name="origin" className="inp" defaultValue={initial?.origin ?? ""} required>
            <option value="">— เลือก —</option>
            {originOptions.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="lbl">ปลายทาง <span className="text-red-500">*</span></label>
          <select name="destination" className="inp" defaultValue={initial?.destination ?? ""} required>
            <option value="">— เลือก —</option>
            {destinationOptions.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="lbl">ประเภทรถ <span className="text-red-500">*</span></label>
          <select name="vehicleType" className="inp" defaultValue={initial?.vehicleType ?? ""} required>
            <option value="">— เลือก —</option>
            {vehicleTypeOptions.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="lbl">หน่วยคิดราคา</label>
          <select name="priceUnit" className="inp" defaultValue={initial?.priceUnit ?? "ต่อเที่ยว"}>
            {PRICE_UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
          <p className="mt-0.5 text-[11px] text-slate-400">ต่อตัน/ต่อกิโลกรัม = ราคา × น้ำหนักที่ลูกค้าใช้คิดเงิน</p>
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

      {/* ต้นทาง/ปลายทางเลือกได้เฉพาะชื่อที่มีในระบบ — บอกทางไปเพิ่มชื่อใหม่ให้ชัด */}
      <p className="mt-2 text-[12px] text-slate-500">
        ไม่มีชื่อต้นทาง/ปลายทางที่ต้องการ? เพิ่มชื่อใหม่ได้ที่{" "}
        <a href="/settings/lookups?q=location" className="font-semibold text-brand-700 hover:underline">
          ตั้งค่า → รายการตัวเลือก
        </a>{" "}
        เลือกประเภท &laquo;สถานที่&raquo; แล้วกลับมาหน้านี้
      </p>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</p>
      )}

      <div className="mt-4 flex gap-2">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "กำลังบันทึก…" : editing ? "บันทึกการแก้ไข" : "+ เพิ่มเส้นทาง"}
        </button>
        {editing && (
          <button type="button" className="btn btn-ghost" onClick={() => router.push(backHref)}>
            ยกเลิก
          </button>
        )}
      </div>
    </form>
  );
}

export function RouteActions({ id, backHref = "?" }: { id: number; backHref?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // ต่อท้ายคำค้นเดิม ("?" หรือ "?q=…") จะได้กลับมาเจอตารางที่กรองไว้เหมือนเดิม
  const link = (k: string) => `${backHref}${backHref === "?" ? "" : "&"}${k}=${id}`;
  return (
    <div className="flex gap-1">
      <a href={link("route")} className="btn btn-ghost px-2 py-1 text-[12px]">
        ตั้งราคา
      </a>
      <a href={link("edit")} className="btn btn-ghost px-2 py-1 text-[12px]">
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

/** ค่าในช่องกรอก เก็บเป็นข้อความตามที่พิมพ์ — ช่องว่าง = ไม่มีราคาที่ช่วงนั้น */
type Cell = { c: string; o: string };
type Cells = Record<number, Cell>;

const cellsFrom = (bands: BandRow[], prices: PriceRow[]): Cells => {
  const byBand = new Map(prices.map((p) => [p.bandId, p]));
  const out: Cells = {};
  for (const b of bands) {
    const p = byBand.get(b.id);
    out[b.id] = { c: p?.customerPrice != null ? String(p.customerPrice) : "", o: p?.outsourcePrice != null ? String(p.outsourcePrice) : "" };
  }
  return out;
};

const toNum = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * ตารางราคาของเส้นทางหนึ่ง — ทุกอย่างทำบนหน้าจอก่อน แล้วค่อยกด «บันทึก» ครั้งเดียว
 *
 * เดิม «เติมให้ทุกช่วง» ไปอ่านราคาฐานจากฐานข้อมูล ทั้งที่ผู้ใช้เพิ่งพิมพ์ในช่องยังไม่ได้บันทึก
 * เลยฟ้องว่ายังไม่กรอก และช่องกรอกเป็นแบบ defaultValue ค่าที่ระบบเติมให้ก็ไม่โผล่จนกว่าจะรีเฟรช
 * ตอนนี้ช่องทุกช่องผูกกับ state เดียว: พิมพ์เอง เติมขั้นบันได คัดลอกจากเส้นทางอื่น ล้วนแก้ state นั้น
 * เห็นผลทันที แก้รายช่วงได้ตามใจ แล้วค่อยบันทึกทั้งตาราง
 */
export function PriceMatrix({
  routeId,
  routeLabel,
  priceUnit,
  bands,
  prices,
  otherRoutes,
  backHref = "?",
}: {
  routeId: number;
  routeLabel: string;
  priceUnit: string;
  bands: BandRow[];
  prices: PriceRow[];
  otherRoutes: Option[];
  backHref?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const saved = cellsFrom(bands, prices);
  const [cells, setCells] = useState<Cells>(saved);
  const [ladderBand, setLadderBand] = useState<string>(String(bands[0]?.id ?? ""));
  const [cStep, setCStep] = useState("0");
  const [oStep, setOStep] = useState("0");
  const [copyFrom, setCopyFrom] = useState("");

  const isDirty = (id: number) => cells[id]?.c !== saved[id]?.c || cells[id]?.o !== saved[id]?.o;
  const dirtyCount = bands.filter((b) => isDirty(b.id)).length;

  // ปิดแท็บ/เปลี่ยนหน้าทั้งที่ยังไม่บันทึก — ให้เบราว์เซอร์ถามก่อน
  useEffect(() => {
    if (dirtyCount === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyCount]);

  const setCell = (id: number, k: keyof Cell, v: string) => {
    setMsg(null);
    setCells((prev) => ({ ...prev, [id]: { ...prev[id], [k]: v } }));
  };

  /** ไล่ราคาจากช่วงฐานไปทุกช่วง (ขั้น 0 = ราคาเท่ากันทุกช่วง) — ทำบนหน้าจอ ยังไม่บันทึก */
  const fillLadder = () => {
    setError(null);
    setMsg(null);
    const baseId = Number(ladderBand);
    const baseIndex = bands.findIndex((b) => b.id === baseId);
    const base = cells[baseId];
    const bc = toNum(base?.c ?? "");
    const bo = toNum(base?.o ?? "");
    if (baseIndex < 0 || (bc == null && bo == null)) {
      setError(`กรอกราคาในช่อง «${bands[baseIndex]?.label ?? "ช่วงฐาน"}» ในตารางด้านล่างก่อน แล้วค่อยกดเติม`);
      return;
    }
    const cs = Number(cStep) || 0;
    const os = Number(oStep) || 0;
    setCells((prev) => {
      const next = { ...prev };
      bands.forEach((b, i) => {
        const steps = i - baseIndex;
        next[b.id] = {
          c: bc == null ? prev[b.id].c : fmt(bc + steps * cs),
          o: bo == null ? prev[b.id].o : fmt(bo + steps * os),
        };
      });
      return next;
    });
    setMsg(
      cs === 0 && os === 0
        ? "เติมราคาเท่ากันให้ทุกช่วงแล้ว — แก้รายช่วงได้ตามต้องการ แล้วกด «บันทึกราคาทั้งหมด»"
        : "ไล่ราคาให้ทุกช่วงแล้ว — ตรวจ/แก้รายช่วงได้ แล้วกด «บันทึกราคาทั้งหมด»",
    );
  };

  const copy = () => {
    setError(null);
    setMsg(null);
    start(async () => {
      const res = await copyPricesFrom(Number(copyFrom));
      if (!res.ok || !res.prices) {
        setError(res.error ?? "คัดลอกไม่สำเร็จ");
        return;
      }
      setCells(cellsFrom(bands, res.prices));
      setMsg("คัดลอกราคามาแล้ว — ตรวจแล้วกด «บันทึกราคาทั้งหมด»");
    });
  };

  const save = () => {
    setError(null);
    setMsg(null);
    start(async () => {
      const res = await savePrices(
        routeId,
        bands.map((b) => ({ bandId: b.id, customerPrice: toNum(cells[b.id].c), outsourcePrice: toNum(cells[b.id].o) })),
      );
      if (!res.ok) setError(res.error ?? "บันทึกไม่สำเร็จ");
      else {
        setMsg(`บันทึกราคาแล้ว ${res.saved ?? 0} ช่วง`);
        router.refresh();
      }
    });
  };

  const clearAll = () => {
    if (!confirm("ล้างราคาทุกช่องบนหน้าจอ? (ยังไม่มีผลจนกว่าจะกดบันทึก)")) return;
    setCells(Object.fromEntries(bands.map((b) => [b.id, { c: "", o: "" }])));
    setMsg(null);
  };

  return (
    <div>
      <p className="mb-3 text-[13px] text-slate-600">
        ตั้งราคาของเส้นทาง <b>{routeLabel}</b> — ราคาเป็นบาท <b>{priceUnit}</b> ·
        พิมพ์ในตารางได้เลยทีละช่วง หรือใช้ตัวช่วยด้านล่าง · ใส่ทศนิยมได้ 3 ตำแหน่ง (เช่น 0.261 บาท/กก.) · เว้นช่องว่างไว้ได้ถ้าไม่มีราคาที่ช่วงนั้น ·
        ทุกอย่างมีผลเมื่อกด «บันทึกราคาทั้งหมด»
      </p>

      {/* เครื่องมือช่วยกรอก — ไม่ต้องพิมพ์ทีละ 22 ช่อง */}
      <div className="mb-4 grid gap-3 rounded-lg border border-[var(--border)] bg-slate-50 p-3 lg:grid-cols-2">
        <div>
          <div className="mb-1.5 text-[12px] font-bold text-slate-700">เติมจากช่วงฐานให้ทุกช่วง</div>
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
              <input className="inp w-24" inputMode="decimal" value={cStep} onChange={(e) => setCStep(e.target.value)} />
            </div>
            <div>
              <label className="lbl">+ รถร่วม/ช่วง</label>
              <input className="inp w-24" inputMode="decimal" value={oStep} onChange={(e) => setOStep(e.target.value)} />
            </div>
            <button type="button" className="btn btn-ghost" disabled={pending} onClick={fillLadder}>
              เติมให้ทุกช่วง
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            พิมพ์ราคาในช่องของช่วงฐาน (ในตารางด้านล่าง) แล้วกดปุ่มนี้ — ใส่ 0 = ราคาเท่ากันทุกช่วง ·
            ใส่ตัวเลข = ช่วงถัดไปบวกเพิ่มทีละเท่านั้น (ช่วงก่อนหน้าลดลง)
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
            <button type="button" className="btn btn-ghost" disabled={pending || !copyFrom} onClick={copy}>
              คัดลอก
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">ใช้ตอนเพิ่มเส้นทางขากลับ ที่ราคาใกล้เคียงกัน</p>
        </div>
      </div>

      <div className="max-h-[28rem] overflow-y-auto">
        {/* ตารางกว้างเท่าที่จำเป็น หัวคอลัมน์กับช่องกรอกจะได้ตรงกัน ไม่ยืดจนช่องไปโผล่ใต้หัวคอลัมน์อื่น */}
        <table className="tbl" style={{ width: "auto", minWidth: 0 }}>
          <thead>
            <tr>
              <th>ช่วงราคาน้ำมัน (บาท/ลิตร)</th>
              <th>ราคาลูกค้า</th>
              <th>ราคาจ่ายรถร่วม</th>
              <th>ส่วนต่าง</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {bands.map((b) => {
              const cell = cells[b.id];
              const c = toNum(cell.c);
              const o = toNum(cell.o);
              const diff = c != null && o != null ? c - o : null;
              const dirty = isDirty(b.id);
              return (
                <tr key={b.id} className={dirty ? "bg-amber-50" : undefined}>
                  <td className="font-medium">{b.label}</td>
                  <td>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      inputMode="decimal"
                      className="inp w-28 text-right"
                      value={cell.c}
                      onChange={(e) => setCell(b.id, "c", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      inputMode="decimal"
                      className="inp w-28 text-right"
                      value={cell.o}
                      onChange={(e) => setCell(b.id, "o", e.target.value)}
                    />
                  </td>
                  <td className={`num ${diff != null && diff < 0 ? "text-red-700" : "text-slate-500"}`}>
                    {diff != null ? diff.toLocaleString("th-TH") : "-"}
                  </td>
                  <td className="text-[11px] text-amber-700">{dirty ? "แก้แล้ว ยังไม่บันทึก" : ""}</td>
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

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>
          {pending ? "กำลังบันทึก…" : dirtyCount > 0 ? `บันทึกราคาทั้งหมด (${dirtyCount} ช่วงที่แก้)` : "บันทึกราคาทั้งหมด"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={pending} onClick={clearAll}>
          ล้างทุกช่อง
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            if (dirtyCount > 0 && !confirm(`มี ${dirtyCount} ช่วงที่แก้แล้วยังไม่บันทึก ปิดโดยไม่บันทึก?`)) return;
            router.push(backHref);
          }}
        >
          ปิด
        </button>
      </div>
    </div>
  );
}
