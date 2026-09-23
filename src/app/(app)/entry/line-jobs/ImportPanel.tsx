"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { importFromSheet } from "./actions";
import type { SheetImportResult } from "@/lib/sheet-jobs";

/** ปุ่มดึงงานจากชีต + แสดงผลรายแถว */
export function ImportPanel() {
  const router = useRouter();
  const [result, setResult] = useState<SheetImportResult | null>(null);
  const [pending, start] = useTransition();

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
          {/* รหัสงานซ้ำ = ขาหายจากใบวางบิล ต้องเด่นที่สุดในหน้า */}
          {result.duplicates.length > 0 && (
            <div className="rounded-lg border-2 border-red-400">
              <div className="border-b border-red-300 bg-red-50 px-3 py-2 text-[14px] font-bold text-red-900">
                ❌ พบรหัสงานซ้ำในชีต {result.duplicates.length} รหัส — ขาที่หายไป{" "}
                {result.duplicates.reduce((a, d) => a + d.missing, 0)} ขา
                <div className="mt-0.5 text-[12px] font-medium">
                  – เว็บรับได้รหัสละ 1 ขา · แถวที่ใช้รหัสซ้ำกันจึงเข้าเว็บไม่ได้ และวางบิลไม่ได้
                  <br />– ระบบไม่เดาให้ว่าแถวไหนคือขาจริง ต้องไปตั้งรหัสงานใหม่ในชีตเอง
                </div>
              </div>
              <div className="max-h-80 overflow-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>รหัสงานที่ซ้ำ</th>
                      <th>แถวในชีต</th>
                      <th className="num">ในชีต</th>
                      <th className="num">เข้าเว็บแล้ว</th>
                      <th className="num">ขาด</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.duplicates.map((d) => (
                      <tr key={d.jobId} className="bg-red-50">
                        <td className="font-mono text-[12px] font-bold text-red-700">{d.jobId}</td>
                        <td className="text-[12px] text-red-700">แถว {d.rows.join(", ")}</td>
                        <td className="num text-red-700">{d.rows.length}</td>
                        <td className="num text-red-700">{d.inWeb}</td>
                        <td className="num font-bold text-red-700">{d.missing}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-red-300 px-3 py-2 text-[12px] leading-relaxed text-red-900">
                <b>วิธีแก้ในชีต:</b> เปิดแท็บ «งาน» ไปที่แถวที่ระบุ → แถวแรกเก็บรหัสเดิมไว้ ·
                แถวที่เหลือตั้งรหัสใหม่ให้ไม่ซ้ำ (เช่น ต่อท้ายเป็น -41, -42) → เปลี่ยนสถานะเป็น «ยืนยัน» → กดดึงงานอีกครั้ง
                <br />
                ถ้าแถวที่เกินคือการกรอกซ้ำจริง (ไม่ได้วิ่งจริง) ให้ลบแถวนั้นทิ้ง แล้วกดดึงงานใหม่ คำเตือนจะหายไปเอง
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
