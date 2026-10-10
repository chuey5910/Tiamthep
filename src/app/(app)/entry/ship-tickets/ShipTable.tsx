"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SearchSelect } from "@/components/SearchSelect";
import type { ShipRow } from "@/lib/ship-ticket";
import { confirmShipTicket, confirmShipTickets, refreshShipTickets, setShipTicketUnused, type ConfirmInput } from "./actions";

type Edit = { ticketNo: string; date: string; net: string; driver: string };

/**
 * ตารางตั๋วรอตรวจ — ข้อมูลอยู่กึ่งกลางคอลัมน์ทุกช่อง (หลักของเจ้าของ)
 * ช่องที่อ่านไม่ชัด = ❌ ตัวแดง เว้นว่างให้กรอก · กรอกครบแล้วปุ่มยืนยันเปลี่ยนเป็นสีแดง รอให้กด
 */
export function ShipTable({
  rows,
  drivers,
  canEdit,
  blocked,
}: {
  rows: ShipRow[];
  drivers: { code: string; name: string }[];
  canEdit: boolean;
  /** ปัญหาทั้งหน้าที่ทำให้ยืนยันไม่ได้ (เช่น ไม่มีลูกค้า BM) */
  blocked: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // ค่าที่คนกรอก/เลือก — แถวที่ยังไม่ได้แตะใช้ค่าที่ระบบอ่านได้ (แถวใหม่หลังดึงรูปก็ได้ค่าเองทันที)
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const driverOptions = useMemo(() => drivers.map((d) => ({ value: d.code, label: d.name })), [drivers]);

  const base = (r: ShipRow): Edit => ({
    ticketNo: r.ticketNo ?? "",
    date: r.date ?? "",
    net: r.weightKg != null ? String(r.weightKg) : "",
    driver: r.driverCode ?? "",
  });
  const editOf = (r: ShipRow): Edit => edits[r.id] ?? base(r);
  const set = (r: ShipRow, patch: Partial<Edit>) => setEdits((e) => ({ ...e, [r.id]: { ...(e[r.id] ?? base(r)), ...patch } }));
  const missing = (r: ShipRow) => {
    const e = editOf(r);
    const m: string[] = [];
    if (!e.ticketNo.trim()) m.push("เลขที่ตั๋ว");
    if (!e.date) m.push("วันที่");
    if (!(Number(e.net.replace(/,/g, "")) > 0)) m.push("น้ำหนัก");
    if (!e.driver) m.push("พขร.");
    return m;
  };
  const ready = (r: ShipRow) => !blocked && r.blockers.length === 0 && missing(r).length === 0;
  // ปุ่มรวม: เฉพาะแถวที่ระบบอ่านครบเองทุกช่องและไม่มีคำเตือน — แถวที่ต้องให้คนตัดสินต้องกดทีละแถว
  const clean = rows.filter(
    (r) => ready(r) && r.warnings.length === 0 && r.ticketNo && r.date && r.weightKg != null && r.driverCode && !needsDriver(r),
  );

  const input = (r: ShipRow): ConfirmInput => {
    const e = editOf(r);
    return { id: r.id, ticketNo: e.ticketNo, date: e.date, netKg: e.net, driverCode: e.driver };
  };
  const run = (fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      router.refresh();
    });

  const confirmRow = (r: ShipRow) => {
    if (r.warnings.length > 0 && !window.confirm(`${r.warnings.join("\n")}\n\nตรวจแล้ว ยืนยันบันทึกเป็นงานใช่ไหม?`)) return;
    run(() => confirmShipTicket(input(r)));
  };

  return (
    <>
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        {canEdit && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || clean.length === 0}
            onClick={() => run(() => confirmShipTickets(clean.map(input)))}
          >
            ✅ ยืนยันทุกแถวที่ไม่มีตัวแดง ({clean.length})
          </button>
        )}
        {canEdit && (
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => run(refreshShipTickets)}>
            🔄 ดึงรูปใหม่
          </button>
        )}
        {pending && <span className="text-[13px] text-slate-500">กำลังบันทึก…</span>}
        {msg && <span className={`text-[13px] font-bold ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</span>}
      </div>

      <div className="overflow-x-auto">
        <table className="tbl [&_td]:whitespace-nowrap [&_td]:!px-2 [&_th]:!px-2">
          <thead>
            <tr>
              <th>รูป</th>
              <th>เลขที่ตั๋ว</th>
              <th>ทะเบียน</th>
              <th>วันที่</th>
              <th>น้ำหนักต้นทาง (ตัน)</th>
              <th>น้ำหนักปลายทาง (ตัน)</th>
              <th>พขร.</th>
              <th>สถานะ</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const e = editOf(r);
              const miss = missing(r);
              const ok = ready(r);
              return (
                <tr key={r.id}>
                  <td>
                    <a href={r.photoUrl} target="_blank" rel="noopener" className="btn btn-ghost px-2 py-1 text-[12px]" title={r.fileName}>
                      {/* ไม่บอก "ใบที่" — ลำดับในระบบเรียงตามเวลา ไม่ตรงตำแหน่งในรูป ดูจากเลขที่ตั๋วแทน */}
                      ดูรูป
                    </a>
                  </td>
                  <td>
                    {r.ticketNo ? (
                      r.ticketNo
                    ) : (
                      <Fix>
                        <input
                          className={`inp text-center ${e.ticketNo ? "" : "border-red-400"}`}
                          style={{ width: "8.5rem" }}
                          inputMode="numeric"
                          value={e.ticketNo}
                          onChange={(ev) => set(r, { ticketNo: ev.target.value.replace(/\D/g, "") })}
                        />
                      </Fix>
                    )}
                  </td>
                  <td>{r.plate}</td>
                  <td>
                    {r.dateLabel ? (
                      r.dateLabel
                    ) : (
                      <Fix>
                        <input
                          type="date"
                          className={`inp text-center ${e.date ? "" : "border-red-400"}`}
                          style={{ width: "9rem" }}
                          value={e.date}
                          onChange={(ev) => set(r, { date: ev.target.value })}
                        />
                      </Fix>
                    )}
                  </td>
                  <td>
                    {r.weightKg != null ? (
                      <b>{tons(r.weightKg)}</b>
                    ) : (
                      <Fix>
                        <input
                          className={`inp text-center ${e.net ? "" : "border-red-400"}`}
                          style={{ width: "7rem" }}
                          inputMode="numeric"
                          title="กรอกเป็นกิโลกรัมตามที่พิมพ์ในตั๋ว เช่น 21210"
                          placeholder={r.weightHint ? `${r.weightHint.toLocaleString("th-TH")} ?` : "กก. ตามตั๋ว"}
                          value={e.net}
                          onChange={(ev) => set(r, { net: ev.target.value.replace(/[^\d]/g, "") })}
                        />
                      </Fix>
                    )}
                  </td>
                  {/* น้ำหนักปลายทาง = น้ำหนักต้นทาง เสมอ (งานตั๋วเรือ) */}
                  <td>{Number(e.net) > 0 ? <b>{tons(Number(e.net))}</b> : <span className="text-slate-400">–</span>}</td>
                  <td>
                    <SearchSelect
                      options={driverOptions}
                      value={e.driver}
                      onChange={(v) => set(r, { driver: v })}
                      placeholder="⚠️ เลือก พขร."
                      invalid={!e.driver}
                      disabled={!canEdit}
                    />
                  </td>
                  <td className="min-w-[11rem] max-w-[16rem] !whitespace-normal text-[12.5px] leading-relaxed">
                    {r.blockers.map((b) => (
                      <div key={b} className="text-red-700">{b}</div>
                    ))}
                    {miss.filter((m) => m !== "พขร.").length > 0 && (
                      <div className="text-red-700">
                        ❌ {miss.filter((m) => m !== "พขร.").join(" · ")}ไม่ชัด — ดูรูปแล้วกรอกเอง
                      </div>
                    )}
                    {r.driverNote && r.blockers.length === 0 && (
                      <div className={needsDriver(r) ? "text-amber-700" : "text-emerald-700"}>{r.driverNote}</div>
                    )}
                    {r.warnings.map((w) => (
                      <div key={w} className="text-amber-700">{w}</div>
                    ))}
                    {r.blockers.length === 0 && miss.length === 0 && !needsDriver(r) && r.warnings.length === 0 && (
                      <div className="text-emerald-700">✅ ครบ</div>
                    )}
                    {r.blockers.length === 0 && miss.length === 0 && (needsDriver(r) || r.warnings.length > 0) && (
                      <div className="text-emerald-700">✅ กรอกครบแล้ว รอกดยืนยัน</div>
                    )}
                  </td>
                  {canEdit && (
                    <td>
                      <button
                        type="button"
                        className={`btn px-3 py-1 text-[12px] ${ok ? "btn-primary" : "btn-ghost"}`}
                        disabled={pending || !ok}
                        onClick={() => confirmRow(r)}
                      >
                        ✅ ยืนยัน
                      </button>
                      <button
                        type="button"
                        className="mt-1 block w-full text-[11.5px] text-slate-500 underline"
                        title="รูปซ้ำ / ไม่ใช่ตั๋ว — เอาออกจากหน้านี้ (กลับมาตรวจใหม่ได้)"
                        disabled={pending}
                        onClick={() => run(() => setShipTicketUnused(r.id, true))}
                      >
                        ไม่ใช้
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** ชื่อ พขร. ต้องให้คนตัดสินไหม (ข้อความขึ้นต้น ⚠️) */
const needsDriver = (r: ShipRow) => !!r.driverNote?.startsWith("⚠️");

/** กก. → ตัน ทศนิยม 3 ตำแหน่ง (21,210 กก. → 21.210) */
const tons = (kg: number) => (kg / 1000).toLocaleString("th-TH", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** ช่องที่อ่านไม่ชัด: ป้ายแดง + ช่องกรอก */
function Fix({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex flex-col items-center gap-1">
      <span className="whitespace-nowrap rounded-md border border-red-300 bg-red-50 px-2 py-0.5 text-[12px] font-bold text-red-700">❌ อ่านไม่ชัด</span>
      {children}
    </span>
  );
}
