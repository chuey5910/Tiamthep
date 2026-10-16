"use client";

import { useLayoutEffect, useRef, useState } from "react";

type Month = { revenue: number; cost: number; profit: number } | null;

const fmt = (n: number) => Math.round(n).toLocaleString("th-TH");
const signed = (n: number) => `${n < 0 ? "−" : ""}${fmt(Math.abs(n))}`;

/**
 * ถนนกำไร — รถ 1 คัน = 1 เดือน · ความสูงกระบะ = รายได้ (แดง = ค่าใช้จ่าย · เขียว = กำไร)
 * วาดตามความสูงของกล่องที่ได้จริง — จอสูงกว่า กราฟก็สูงขึ้น ไม่เหลือที่ว่าง
 */
export function RoadChart({
  months,
  names,
  hrefs,
  nowIdx,
  year,
  weights,
  gap,
}: {
  months: Month[];
  names: string[];
  hrefs: string[];
  nowIdx: number;
  year: number;
  /** ความกว้างของแต่ละเดือน (สัดส่วนเดียวกับกล่องตัวเลขใต้รถ) — รถอยู่ตรงกล่องของเดือนนั้นพอดี */
  weights: number[];
  gap: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 972, h: 160 });

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // offsetWidth/Height = ขนาดก่อนย่อ (กล่องอยู่ใน FitScreen ที่ย่อทั้งก้อน)
    const measure = () => setSize({ w: el.offsetWidth, h: Math.max(110, el.offsetHeight) });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w: W, h: VH } = size;
  const roadH = 30;
  const roadY = VH - roadH;
  // ตำแหน่งแต่ละเดือน = ตำแหน่งกล่องใต้รถ (grid fr + ช่องว่าง)
  const unit = (W - gap * 11) / weights.reduce((a, b) => a + b, 0);
  const left = weights.map((_, i) => weights.slice(0, i).reduce((a, w) => a + w * unit + gap, 0));
  const has = (m: Month): m is NonNullable<Month> => !!m && (m.revenue !== 0 || m.cost !== 0);
  const maxVal = Math.max(1, ...months.filter(has).map((m) => Math.max(m.revenue, m.cost)));
  const H = Math.max(30, roadY - 16 - 28); // เว้นที่ด้านบนให้ป้ายกำไร

  return (
    <div ref={box} style={{ flex: 1, minHeight: 0, marginTop: 6 }}>
      <svg width={W} height={VH} viewBox={`0 0 ${W} ${VH}`} style={{ display: "block" }}>
        <defs>
          <linearGradient id="dashSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff7e6" />
            <stop offset="1" stopColor="#ffe9f3" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={W} height={roadY + 16} rx="16" fill="url(#dashSky)" />
        <rect x="0" y={roadY} width={W} height={roadH} rx="0" fill="#2b2547" />
        <line x1="0" y1={roadY + roadH / 2} x2={W} y2={roadY + roadH / 2} stroke="#ffd43b" strokeWidth="3" strokeDasharray="20 14" />
        {months.map((m, i) => {
          const colW = weights[i] * unit;
          const cx = left[i] + colW / 2;
          // รถทั้งคัน (กระบะ + หัว 20) กว้างไม่เกินช่อง
          const truckW = Math.min(96, colW - 6);
          const bw = truckW - 20;
          const x = cx - truckW / 2;
          const wheelY = roadY - 7;
          if (!has(m)) {
            return (
              <g key={i}>
                <rect x={x} y={roadY - 44} width={bw} height={30} rx="6" fill="none" stroke="#c9c2e6" strokeWidth="2" strokeDasharray="5 4" />
                <rect x={x + bw + 2} y={roadY - 30} width="16" height="16" rx="4" fill="none" stroke="#c9c2e6" strokeWidth="2" strokeDasharray="4 3" />
                <circle cx={x + 8} cy={wheelY} r="6" fill="#d9d3f0" />
                <circle cx={x + bw + 10} cy={wheelY} r="6" fill="#d9d3f0" />
              </g>
            );
          }
          const h = (Math.max(m.revenue, m.cost) / maxVal) * H;
          const hc = (m.cost / maxVal) * H;
          const hr = (m.revenue / maxVal) * H;
          const y0 = roadY - 14 - h;
          const loss = m.profit < 0;
          return (
            <a key={i} href={hrefs[i]}>
              <title>{`${names[i]} ${year + 543} — รายได้ ${fmt(m.revenue)} · ค่าใช้จ่าย ${fmt(m.cost)} · กำไร ${signed(m.profit)}`}</title>
              {!loss && <rect x={x} y={y0} width={bw} height={h} rx="7" fill="#12b886" />}
              <rect x={x} y={roadY - 14 - hc} width={bw} height={hc} rx={loss ? 7 : 0} fill="#ff5a5f" />
              <rect x={x} y={roadY - 20} width={bw} height="6" rx="2" fill="#ff5a5f" />
              {/* ขาดทุน: เส้นประ = ระดับรายได้ (ค่าใช้จ่ายเกินรายได้) */}
              {loss && <line x1={x - 3} x2={x + bw + 3} y1={roadY - 14 - hr} y2={roadY - 14 - hr} stroke="#1b1440" strokeWidth="2" strokeDasharray="5 3" />}
              {m.revenue > 0 && !loss && h - hc > 22 && (
                <text x={x + bw / 2} y={y0 + 17} textAnchor="middle" fontSize="14" fontWeight="800" fill="#fff">
                  {((m.profit / m.revenue) * 100).toFixed(0)}%
                </text>
              )}
              <path d={`M${x + bw + 1} ${roadY - 14} v-22 q0 -6 6 -6 h7 l7 12 v16 z`} fill={i === nowIdx ? "#ff2e93" : "#7b2ff7"} />
              <rect x={x + bw + 5} y={roadY - 38} width="7" height="7" rx="2" fill="#e8e2ff" />
              <circle cx={x + 9} cy={wheelY} r="7" fill="#1b1440" />
              <circle cx={x + 9} cy={wheelY} r="2.8" fill="#ffd43b" />
              <circle cx={x + bw + 10} cy={wheelY} r="7" fill="#1b1440" />
              <circle cx={x + bw + 10} cy={wheelY} r="2.8" fill="#ffd43b" />
              {/* ป้ายกำไรอยู่เหนือกระบะและเหนือหัวรถเสมอ (กระบะเตี้ยกว่าหัวรถ ป้ายจะได้ไม่ทับหัวรถ) */}
              <text x={cx} y={Math.min(y0, roadY - 42) - 7} textAnchor="middle" fontSize="15" fontWeight="800" fill={loss ? "#e03131" : "#0c8a63"}>
                {loss ? "−" : "+"}
                {fmt(Math.abs(m.profit) / 1000)}k
              </text>
            </a>
          );
        })}
      </svg>
    </div>
  );
}
