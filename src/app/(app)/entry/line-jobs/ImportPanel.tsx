"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { importFromSheet, resolveDuplicate } from "./actions";
import type { SheetImportResult } from "@/lib/sheet-jobs";

/** ปุ่มดึงงานจากชีต + แสดงผลรายแถว */
export function ImportPanel() {
  const router = useRouter();
  const [result, setResult] = useState<SheetImportResult | null>(null);
  const [pending, start] = useTransition();

  // คนตัดสินแถวซ้ำบนเว็บ — เขียนลงชีตแล้วดึงงานใหม่ ผลที่ได้แทนที่ของเดิมทั้งก้อน
  const decide = (rowNo: number, jobId: string, action: "rename" | "cancel") => {
    const ask =
      action === "cancel"
        ? `ยืนยันว่าแถว ${rowNo} (รหัส ${jobId}) เป็นการกรอกซ้ำ?\nระบบจะตั้งสถานะเป็น «ยกเลิก» — ไม่ลบแถว ข้อมูลยังอยู่`
        : `ยืนยันว่าแถว ${rowNo} (รหัส ${jobId}) เป็นคนละเที่ยว?\nระบบจะตั้งรหัสงานใหม่ให้ แล้วดึงเข้าเว็บ`;
    if (!confirm(ask)) return;
    start(async () => {
      const res = await resolveDuplicate(rowNo, jobId, action);
      setResult(res);
      if (res.ok && res.imported > 0) router.refresh();
    });
  };

  return (
    <div>
      <button
        className="btn btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await importFromSheet();
            setResult(res);
            if (res.ok && res.imported > 0) router.refresh();
          })
        }
      >
        {pending ? "กำลังดึงข้อมูลจากชีต…" : "ดึงงานเข้าเว็บ (เฉพาะแถวที่ยืนยันแล้ว)"}
      </button>

      {result && !result.ok && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
          {result.error}
        </p>
      )}

      {result?.ok && (
        <div className="mt-4 space-y-3">
          {/* รหัสซ้ำที่ระบบตั้งรหัสใหม่ให้เองแล้ว — ทำผ่าน API จึงแก้แถวที่ชีตล็อก «ปิดงาน» ได้ */}
          {result.renumbered.length > 0 && (
            <div className="rounded-lg border-2 border-sky-400">
              <div className="border-b border-sky-300 bg-sky-50 px-3 py-2 text-[14px] font-bold text-sky-900">
                🔢 ตั้งรหัสงานใหม่ให้ {result.renumbered.length} แถว เพราะรหัสเดิมซ้ำกับแถวที่อยู่ในเว็บแล้ว
                <div className="mt-0.5 text-[12px] font-medium">
                  – ระบบเทียบข้อมูลทุกช่องกับงานในเว็บก่อน แถวที่ตรงกันเก็บรหัสเดิม แถวที่เป็นคนละขาได้รหัสใหม่
                  <br />– แถวที่ปิดงานหรือยืนยันแล้ว ดึงเข้าเว็บให้ในรอบนี้เลย · แถวที่ยังอยู่ในมือคนขับ รอจนกว่าจะยืนยัน
                </div>
              </div>
              <div className="max-h-80 overflow-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>แถวในชีต</th>
                      <th>รหัสเดิม</th>
                      <th>รหัสใหม่</th>
                      <th>ซ้ำกับแถว</th>
                      <th>ดึงเข้าเว็บ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.renumbered.map((r) => (
                      <tr key={r.row}>
                        <td className="font-bold">แถว {r.row}</td>
                        <td className="font-mono text-[12px] text-slate-500 line-through">{r.from}</td>
                        <td className="font-mono text-[12px] font-bold text-sky-800">{r.to}</td>
                        <td className="text-[12px] text-slate-600">แถว {r.keeperRow} (อยู่ในเว็บแล้ว)</td>
                        <td className="text-[12px]">{r.confirmed ? "✅ รอบนี้" : "⏳ รอยืนยันก่อน"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* แถวกรอกซ้ำที่ระบบตั้งเป็น «ยกเลิก» ให้ — ไม่ลบ ข้อมูลยังอยู่ */}
          {result.cancelled.length > 0 && (
            <div className="rounded-lg border border-slate-300">
              <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[14px] font-bold text-slate-800">
                🗑 ตั้งเป็น «ยกเลิก» ให้ {result.cancelled.length} แถว เพราะเหมือนแถวที่เก็บรหัสเดิมทุกช่อง (กรอกซ้ำ)
                <div className="mt-0.5 text-[12px] font-medium text-slate-600">
                  – ไม่ได้ลบแถว ข้อมูลยังอยู่ครบในชีต · เว็บไม่นับแถวเหล่านี้เป็นงาน จึงไม่เกิดขาซ้ำในใบวางบิล
                </div>
              </div>
              <div className="px-3 py-2 text-[12px] text-slate-700">
                {result.cancelled.map((c) => (
                  <div key={c.row}>
                    แถว <b>{c.row}</b> (รหัส <span className="font-mono">{c.from}</span>) เหมือนแถว <b>{c.keeperRow}</b> ทุกช่อง
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* รหัสซ้ำที่ระบบตัดสินให้ไม่ได้ — ให้คนกดตัดสินตรงนี้ ไม่ต้องไปแก้ชีต */}
          {result.duplicates.length > 0 && (
            <div className="rounded-lg border-2 border-red-400">
              <div className="border-b border-red-300 bg-red-50 px-3 py-2 text-[14px] font-bold text-red-900">
                ❌ รหัสงานซ้ำที่ต้องให้คนตัดสิน {result.duplicates.length} รหัส — ขาที่หายไป{" "}
                {result.duplicates.reduce((a, d) => a + d.missing, 0)} ขา
                <div className="mt-0.5 text-[12px] font-medium">
                  – ระบบแก้ให้เองเฉพาะที่พิสูจน์ได้ (เหมือนทุกช่อง = กรอกซ้ำ · คนละวัน/รถ/เส้นทาง = คนละเที่ยว)
                  <br />– แถวด้านล่างนี้ก้ำกึ่ง ให้ดูสรุปแต่ละแถวแล้ว<b>กดปุ่มตัดสินตรงนี้</b> — ไม่ต้องไปแก้ในชีต (แถวที่ล็อก «ปิดงาน» ก็ทำได้)
                </div>
              </div>
              <div className="divide-y divide-red-200">
                {result.duplicates.map((d) => (
                  <div key={d.jobId} className="px-3 py-2">
                    <div className="flex flex-wrap items-baseline gap-x-3 text-[13px]">
                      <span className="font-mono font-bold text-red-700">{d.jobId}</span>
                      <span className="text-red-700">ซ้ำ {d.rows.length} แถว · เข้าเว็บแล้ว {d.inWeb} · ขาด {d.missing}</span>
                    </div>
                    <div className="mt-1 text-[12px] leading-relaxed text-red-800">{d.reason}</div>
                    {d.detail && (
                      <table className="tbl mt-2">
                        <thead>
                          <tr>
                            <th>แถว</th>
                            <th>สถานะในชีต</th>
                            <th>ข้อมูลในแถว</th>
                            <th className="no-print">ตัดสิน</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.detail.map((r) => (
                            <tr key={r.rowNo} className={r.inWeb ? "bg-emerald-50" : undefined}>
                              <td className="font-bold">แถว {r.rowNo}</td>
                              <td className="whitespace-nowrap text-[12px]">{r.status || "-"}</td>
                              <td className="text-[12px]">
                                {r.summary}
                                {r.inWeb && <span className="ml-2 badge badge-ok">ตรงกับงานในเว็บ</span>}
                              </td>
                              <td className="no-print whitespace-nowrap">
                                {r.inWeb ? (
                                  <span className="text-[11px] text-slate-500">เก็บรหัสเดิมไว้</span>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      className="btn btn-ghost px-2 py-1 text-[12px]"
                                      disabled={pending}
                                      title="วิ่งจริงอีกเที่ยว → ตั้งรหัสใหม่ให้ แล้วดึงเข้าเว็บ"
                                      onClick={() => decide(r.rowNo, d.jobId, "rename")}
                                    >
                                      🔢 คนละเที่ยว
                                    </button>{" "}
                                    <button
                                      type="button"
                                      className="btn btn-danger px-2 py-1 text-[12px]"
                                      disabled={pending}
                                      title="กรอกซ้ำ → ตั้งเป็น «ยกเลิก» ไม่ลบแถว"
                                      onClick={() => decide(r.rowNo, d.jobId, "cancel")}
                                    >
                                      🗑 กรอกซ้ำ
                                    </button>
                                  </>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ))}
              </div>
              <p className="border-t border-red-300 px-3 py-2 text-[12px] leading-relaxed text-red-900">
                <b>คนละเที่ยว</b> = รถวิ่งจริงอีกเที่ยว ระบบตั้งรหัสใหม่ให้แล้วดึงเข้าเว็บ ·{" "}
                <b>กรอกซ้ำ</b> = แถวนี้ไม่ใช่งานจริง ระบบตั้งเป็น «ยกเลิก» (ไม่ลบ ข้อมูลยังอยู่) ·
                ทุกการตัดสินถูกเขียนไว้ในชีตคอลัมน์ «ผลนำเข้าเว็บ» ย้อนดูได้
              </p>
            </div>
          )}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900">
            นำเข้าสำเร็จ <b>{result.imported}</b> งาน
            {result.failed > 0 && (
              <>
                {" "}· ไม่ผ่าน <b className="text-red-700">{result.failed}</b> งาน
                (ดูเหตุผลในตารางล่าง และในชีตคอลัมน์ «ผลนำเข้าเว็บ»)
              </>
            )}
            {result.pendingReview > 0 && (
              <> · มีอีก <b>{result.pendingReview}</b> งานที่ส่งของเสร็จสิ้นแล้วแต่ยังไม่ได้กด «ยืนยัน» ในชีต</>
            )}
            {result.advancesSynced > 0 && (
              <>
                {" "}· ดึงเงินเดินทาง/ค่าทางด่วนจากชีต <b>{result.advancesSynced}</b> งาน
                (ดูที่หน้า «เงินเดินทาง / ค่าทางด่วน»)
              </>
            )}
            {result.refreshed > 0 && (
              <>
                {" "}· อัปเดตข้อความ «ผลนำเข้าเว็บ» ในชีตให้ตรงกับปัจจุบัน <b>{result.refreshed}</b> แถว
                (เช่น คำเตือนเก่าที่แก้ไปแล้วจะหายไป)
              </>
            )}
            {result.imported === 0 && result.failed === 0 && result.advancesSynced === 0 && result.refreshed === 0 && (
              <> — ไม่มีแถวสถานะ «ยืนยัน» ค้างอยู่ และไม่มีอะไรต้องอัปเดตในชีต</>
            )}
          </div>

          {/* โชว์เฉพาะแถวที่ไม่ผ่าน — แถวที่สำเร็จบอกแค่จำนวน เหมือนหน้านำเข้าน้ำมัน */}
          {(() => {
            const failedRows = result.rows.filter((r) => !r.ok);
            const okCount = result.rows.length - failedRows.length;
            if (result.rows.length === 0) return null;
            if (failedRows.length === 0) {
              return (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900">
                  ✓ ทุกแถวนำเข้าสำเร็จ ไม่มีแถวที่ต้องแก้
                </div>
              );
            }
            return (
              <div className="rounded-lg border border-red-200">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-900">
                  <b>แถวที่ต้องแก้ {failedRows.length} งาน</b>
                  <span className="text-[12px]">นำเข้าสำเร็จ {okCount} งาน (ไม่แสดง)</span>
                </div>
                <div className="max-h-96 overflow-auto">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>รหัสงานในชีต</th>
                        <th>ปัญหาที่พบ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failedRows.map((r, i) => (
                        <tr key={`${r.jobId}-${i}`}>
                          <td className="bg-red-50 font-mono text-[12px] font-semibold text-red-700">{r.jobId}</td>
                          <td className="text-[12px] leading-relaxed text-red-700">✕ {r.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="border-t border-red-200 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
                  แก้ข้อมูลในชีตที่แถวเหล่านี้ แล้วกดดึงงานอีกครั้งได้เลย — งานที่นำเข้าไปแล้วจะไม่ซ้ำ
                </p>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
