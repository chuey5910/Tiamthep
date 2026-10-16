"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SearchSelect } from "@/components/SearchSelect";
import type { ShipRow } from "@/lib/ship-ticket";
import { confirmShipTicket, confirmShipTickets, refreshShipTickets, setShipTicketUnused, type ConfirmInput, type ShipResult } from "./actions";

type Edit = { ticketNo: string; date: string; net: string; driver: string; plate: string };

/**
 * ตารางตั๋วรอตรวจ — ข้อมูลอยู่กึ่งกลางคอลัมน์ทุกช่อง (หลักของเจ้าของ)
 * ช่องที่อ่านไม่ชัด = ❌ ตัวแดง เว้นว่างให้กรอก · กรอกครบแล้วปุ่มยืนยันเปลี่ยนเป็นสีแดง รอให้กด
 */
export function ShipTable({
  rows,
  drivers,
  vehicles,
  canEdit,
}: {
  /** ตั๋วของเส้นทางเดียว — ปุ่มยืนยันทุกแถวจึงไม่ข้ามไปเส้นทางอื่น */
  rows: ShipRow[];
  drivers: { code: string; name: string }[];
  /** ให้เลือกเมื่อทะเบียนจากตั๋วอ่านไม่ได้/ไม่พบในข้อมูลรถ */
  vehicles: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // ค่าที่คนกรอก/เลือก — แถวที่ยังไม่ได้แตะใช้ค่าที่ระบบอ่านได้ (แถวใหม่หลังดึงรูปก็ได้ค่าเองทันที)
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  // แถวที่กด ✏️ แก้ไข — เปิดทุกช่องที่ระบบอ่านมาให้แก้ได้ (กรณีอ่านผิดแต่ขึ้นว่าถูก)
  const [editing, setEditing] = useState<Record<number, boolean>>({});
  const driverOptions = useMemo(() => drivers.map((d) => ({ value: d.code, label: d.name })), [drivers]);
  const plateOptions = useMemo(() => vehicles.map((v) => ({ value: v, label: v })), [vehicles]);

  const base = (r: ShipRow): Edit => ({
    ticketNo: r.ticketNo ?? "",
    date: r.date ?? "",
    net: r.weightKg != null ? String(r.weightKg) : "",
    driver: r.driverCode ?? "",
    plate: r.plate ?? "",
  });
  const editOf = (r: ShipRow): Edit => edits[r.id] ?? base(r);
  const set = (r: ShipRow, patch: Partial<Edit>) => setEdits((e) => ({ ...e, [r.id]: { ...(e[r.id] ?? base(r)), ...patch } }));
  const startEdit = (r: ShipRow) => setEditing((x) => ({ ...x, [r.id]: true }));
  // ยกเลิกแก้ = กลับไปใช้ค่าที่ระบบอ่าน
  const stopEdit = (r: ShipRow) => {
    setEditing(({ [r.id]: _, ...x }) => x);
    setEdits(({ [r.id]: _, ...x }) => x);
  };
  /** ช่องที่คนแก้ต่างจากที่ระบบอ่าน — «ชื่อช่อง: อ่านได้ → แก้เป็น» */
  const changes = (r: ShipRow) => {
    if (!editing[r.id]) return [];
    const e = editOf(r);
    const c: string[] = [];
    if (r.ticketNo && e.ticketNo !== r.ticketNo) c.push(`เลขที่ตั๋ว ${r.ticketNo} → ${e.ticketNo || "(ว่าง)"}`);
    if (r.date && e.date !== r.date) c.push(`วันที่ ${r.dateLabel} → ${e.date ? thaiDate(e.date) : "(ว่าง)"}`);
    if (r.weightKg != null && e.net !== String(r.weightKg)) c.push(`น้ำหนัก ${kg(r.weightKg)} → ${e.net ? kg(Number(e.net)) : "(ว่าง)"} กก.`);
    if (r.plate && r.plateFromTicket && e.plate !== r.plate) c.push(`ทะเบียน ${r.plate} → ${e.plate || "(ว่าง)"}`);
    return c;
  };
  const missing = (r: ShipRow) => {
    const e = editOf(r);
    const m: string[] = [];
    if (!e.ticketNo.trim()) m.push("เลขที่ตั๋ว");
    if (!e.date) m.push("วันที่");
    if (!(Number(e.net.replace(/,/g, "")) > 0)) m.push("น้ำหนัก");
    if (!e.driver) m.push("พขร.");
    if (!e.plate) m.push("ทะเบียน");
    return m;
  };
  const ready = (r: ShipRow) => r.blockers.length === 0 && missing(r).length === 0;
  // ปุ่มรวม: เฉพาะแถวที่ระบบอ่านครบเองทุกช่องและไม่มีคำเตือน — แถวที่ต้องให้คนตัดสินต้องกดทีละแถว
  const clean = rows.filter(
    (r) => !editing[r.id] && ready(r) && r.warnings.length === 0 && r.ticketNo && r.date && r.weightKg != null && r.driverCode && !needsDriver(r),
  );

  const input = (r: ShipRow): ConfirmInput => {
    const e = editOf(r);
    return { id: r.id, ticketNo: e.ticketNo, date: e.date, netKg: e.net, driverCode: e.driver, plate: r.plate && !editing[r.id] ? undefined : e.plate };
  };
  const run = (fn: () => Promise<ShipResult>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      router.refresh();
    });

  const confirmRow = (r: ShipRow) => {
    const notes = [...r.warnings, ...changes(r).map((c) => `✏️ แก้ ${c}`)];
    if (notes.length > 0 && !window.confirm(`${notes.join("\n")}\n\nตรวจกับรูปแล้ว ยืนยันบันทึกเป็นงานใช่ไหม?`)) return;
    start(async () => {
      let res = await confirmShipTicket(input(r));
      // เลขที่ที่แก้ ซ้ำกับงาน/ตั๋วที่มีอยู่ — คนตัดสิน (เที่ยวซ้ำจริงมีได้ ระบบไม่ปฏิเสธเอง)
      if (!res.ok && res.askDup && window.confirm(`${res.error}\n\nดูรูปแล้วไม่ใช่งานซ้ำ ยืนยันบันทึกใช่ไหม?`))
        res = await confirmShipTicket({ ...input(r), allowDupNo: true });
      setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
      if (res.ok) stopEdit(r);
      router.refresh();
    });
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

      {/* พอดีความกว้างจอเสมอ (ไม่มีแถบเลื่อนข้าง) — ตัวอักษรย่อ/ขยายตามความกว้าง ดู .ship-fit ใน globals.css */}
      <div className="ship-fit">
        <table className="tbl">
          <colgroup>
            <col style={{ width: "7%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "8.5%" }} />
            <col style={{ width: "8.5%" }} />
            <col style={{ width: canEdit ? "15%" : "17%" }} />
            <col style={{ width: canEdit ? "19%" : "28%" }} />
            {canEdit && <col style={{ width: "11%" }} />}
          </colgroup>
          <thead>
            <tr>
              <th>รูป</th>
              <th>เลขที่ตั๋ว</th>
              <th>ทะเบียน</th>
              <th>วันที่</th>
              <th>น้ำหนักต้นทาง<br />(ตัน)</th>
              <th>น้ำหนักปลายทาง<br />(ตัน)</th>
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
              const ed = !!editing[r.id];
              const changed = changes(r);
              return (
                <tr key={r.id}>
                  <td>
                    <a href={r.photoUrl} target="_blank" rel="noopener" className="btn btn-ghost" title={r.fileName}>
                      {/* ไม่บอก "ใบที่" — ลำดับในระบบเรียงตามเวลา ไม่ตรงตำแหน่งในรูป ดูจากเลขที่ตั๋วแทน */}
                      ดูรูป
                    </a>
                  </td>
                  <td>
                    {r.ticketNo && !ed ? (
                      r.ticketNo
                    ) : (
                      <Fix read={r.ticketNo} edited={ed && r.ticketNo != null && e.ticketNo !== r.ticketNo}>
                        <input
                          className={`inp text-center ${e.ticketNo ? "" : "border-red-400"}`}
                          inputMode="numeric"
                          value={e.ticketNo}
                          onChange={(ev) => set(r, { ticketNo: ev.target.value.replace(/[^\dA-Za-z]/g, "").toUpperCase() })}
                        />
                      </Fix>
                    )}
                  </td>
                  <td className="nw">
                    {r.plate && !(ed && r.plateFromTicket) ? (
                      r.plate
                    ) : (
                      <Fix read={r.plate} edited={ed && r.plate != null && e.plate !== r.plate}>
                        <SearchSelect
                          options={plateOptions}
                          value={e.plate}
                          onChange={(v) => set(r, { plate: v })}
                          placeholder="เลือกทะเบียน"
                          invalid={!e.plate}
                          disabled={!canEdit}
                          className="w-full !min-w-0"
                        />
                      </Fix>
                    )}
                  </td>
                  <td>
                    {r.dateLabel && !ed ? (
                      r.dateLabel
                    ) : (
                      <Fix read={r.dateLabel} edited={ed && r.date != null && e.date !== r.date}>
                        <input
                          type="date"
                          className={`inp text-center ${e.date ? "" : "border-red-400"}`}
                          value={e.date}
                          onChange={(ev) => set(r, { date: ev.target.value })}
                        />
                      </Fix>
                    )}
                  </td>
                  <td>
                    {r.weightKg != null && !ed ? (
                      <b>{tons(r.weightKg)}</b>
                    ) : (
                      <Fix read={r.weightKg != null ? `${kg(r.weightKg)} กก.` : null} edited={ed && r.weightKg != null && e.net !== String(r.weightKg)}>
                        <input
                          className={`inp text-center ${e.net ? "" : "border-red-400"}`}
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
                      className="w-full !min-w-0"
                    />
                  </td>
                  <td className="ship-status">
                    {r.blockers.map((b) => (
                      <div key={b} className="text-red-700">{b}</div>
                    ))}
                    {r.plateNote && !e.plate && <div className="text-red-700">{r.plateNote}</div>}
                    {miss.filter((m) => m !== "พขร." && m !== "ทะเบียน").length > 0 && (
                      <div className="text-red-700">
                        ❌ {miss.filter((m) => m !== "พขร." && m !== "ทะเบียน").join(" · ")}ไม่ชัด — ดูรูปแล้วกรอกเอง
                      </div>
                    )}
                    {r.driverNote && r.blockers.length === 0 && (
                      <div className={needsDriver(r) ? "text-amber-700" : "text-emerald-700"}>{r.driverNote}</div>
                    )}
                    {r.warnings.map((w) => (
                      <div key={w} className="text-amber-700">{w}</div>
                    ))}
                    {ed && (
                      <div className="text-amber-700">
                        {changed.length > 0
                          ? changed.map((c) => <div key={c}>⚠️ แก้ {c}</div>)
                          : "⚠️ กำลังแก้ — แก้ช่องที่อ่านผิดให้ตรงรูป แล้วกดยืนยัน"}
                      </div>
                    )}
                    {!ed && r.blockers.length === 0 && miss.length === 0 && !needsDriver(r) && r.warnings.length === 0 && (
                      <div className="text-emerald-700">✅ ครบ</div>
                    )}
                    {r.blockers.length === 0 && miss.length === 0 && (ed || needsDriver(r) || r.warnings.length > 0) && (
                      <div className="text-emerald-700">✅ กรอกครบแล้ว รอกดยืนยัน</div>
                    )}
                  </td>
                  {canEdit && (
                    <td>
                      <button
                        type="button"
                        className={`btn w-full ${ok ? "btn-primary" : "btn-ghost"}`}
                        disabled={pending || !ok}
                        onClick={() => confirmRow(r)}
                      >
                        ✅ ยืนยัน
                      </button>
                      {/* ระบบอ่านผิดแต่ขึ้นว่าถูก — เปิดทุกช่องให้แก้ตามรูป */}
                      <button
                        type="button"
                        className={`btn mt-1 w-full ${ed ? "btn-ghost text-amber-700" : "btn-ghost"}`}
                        disabled={pending}
                        onClick={() => (ed ? stopEdit(r) : startEdit(r))}
                      >
                        {ed ? "↩ ใช้ค่าที่อ่าน" : "✏️ แก้ไข"}
                      </button>
                      <button
                        type="button"
                        className="ship-small mt-1 block w-full text-slate-500 underline"
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

const kg = (n: number) => n.toLocaleString("th-TH");
const thaiDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });

/**
 * ช่องกรอก + ป้ายบอกที่มา
 * – อ่านไม่ชัด (read = null): ❌ อ่านไม่ชัด
 * – กด ✏️ แก้ไข: บอกค่าที่ระบบอ่านได้ไว้เทียบ · แก้แล้วเป็นสีส้ม
 */
function Fix({ children, read = null, edited = false }: { children: React.ReactNode; read?: string | null; edited?: boolean }) {
  return (
    <span className="flex w-full flex-col items-center gap-1">
      {read == null ? (
        <span className="ship-small whitespace-nowrap rounded-md border border-red-300 bg-red-50 px-1.5 py-0.5 font-bold text-red-700">❌ อ่านไม่ชัด</span>
      ) : (
        // ช่องแคบ — «อ่านได้» บรรทัดหนึ่ง ค่าอีกบรรทัด ไม่ตัดหาย
        <span className={`ship-small nw rounded-md border px-1.5 py-0.5 text-center font-bold leading-tight ${edited ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
          อ่านได้
          <br />
          {read}
        </span>
      )}
      {children}
    </span>
  );
}
