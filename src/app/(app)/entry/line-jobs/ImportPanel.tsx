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
            {result.imported === 0 && result.failed === 0 && <> — ไม่มีแถวสถานะ «ยืนยัน» ค้างอยู่</>}
          </div>

          {result.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>รหัสงาน</th>
                    <th>ผล</th>
                    <th>รายละเอียด</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.jobId}>
                      <td className="font-mono text-[12px]">{r.jobId}</td>
                      <td>{r.ok ? "✅ สำเร็จ" : "❌ ไม่ผ่าน"}</td>
                      <td className={r.ok ? "text-slate-600" : "text-red-700"}>{r.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
