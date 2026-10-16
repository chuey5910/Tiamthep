"use client";

import { useLayoutEffect, useRef, useState } from "react";

type Month = { revenue: number; cost: number; profit: number } | null;

const fmt = (n: number) => Math.round(n).toLocaleString("th-TH");
const signed = (n: number) => `${n < 0 ? "−" : ""}${fmt(Math.abs(n))}`;

/**
 * ถนนกำไร — รถ 1 คัน = 1 เดือน · ความสูงกระบะ = รายได้ (แดง = ค่าใช้จ่าย · เขียว = กำไร)
 * วาดตามความสูงของกล่องที่ได้จริง — จอสูงกว่า กราฟก็สูงขึ้น ไม่เหลือที่ว่าง
 */
export function RoadChart({ months, names, hrefs, nowIdx, year }: { months: Month[]; names: string[]; hrefs: string[]; nowIdx: number; year: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1552, h: 232 });

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // offsetWidth/Height = ขนาดก่อนย่อ (กล่องอยู่ใน FitScreen ที่ย่อทั้งก้อน)
    const measure = () => setSize({ w: el.offsetWidth, h: Math.max(180, el.offsetHeight) });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w: W, h: VH } = size;
  const roadH = 46;
  const roadY = VH - roadH;
  const slot = W / 12;
  const has = (m: Month): m is NonNullable<Month> => !!m && (m.revenue !== 0 || m.cost !== 0);
  const maxVal = Math.max(1, ...months.filter(has).map((m) => Math.max(m.revenue, m.cost)));
  const H = Math.max(60, roadY - 20 - 36); // เว้นที่ด้านบนให้ป้ายกำไร

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
        <line x1="0" y1={roadY + roadH / 2} x2={W} y2={roadY + roadH / 2} stroke="#ffd43b" strokeWidth="4" strokeDasharray="26 18" />
        {months.map((m, i) => {
          const cx = slot * i + slot / 2;
          const bw = Math.min(80, slot * 0.58);
          const x = cx - bw / 2 - 12;
          const wheelY = roadY - 11;
          if (!has(m)) {
            return (
              <g key={i}>
                <rect x={x} y={roadY - 80} width={bw} height={60} rx="8" fill="none" stroke="#c9c2e6" strokeWidth="2.5" strokeDasharray="7 6" />
                <rect x={x + bw + 2} y={roadY - 50} width="24" height="30" rx="6" fill="none" stroke="#c9c2e6" strokeWidth="2.5" strokeDasharray="6 5" />
                <circle cx={x + 15} cy={wheelY} r="9" fill="#d9d3f0" />
                <circle cx={x + bw + 12} cy={wheelY} r="9" fill="#d9d3f0" />
              </g>
            );
          }
          const h = (Math.max(m.revenue, m.cost) / maxVal) * H;
          const hc = (m.cost / maxVal) * H;
          const hr = (m.revenue / maxVal) * H;
          const y0 = roadY - 20 - h;
          const loss = m.profit < 0;
          return (
            <a key={i} href={hrefs[i]}>
              <title>{`${names[i]} ${year + 543} — รายได้ ${fmt(m.revenue)} · ค่าใช้จ่าย ${fmt(m.cost)} · กำไร ${signed(m.profit)}`}</title>
              {!loss && <rect x={x} y={y0} width={bw} height={h} rx="9" fill="#12b886" />}
              <rect x={x} y={roadY - 20 - hc} width={bw} height={hc} rx={loss ? 9 : 0} fill="#ff5a5f" />
              <rect x={x} y={roadY - 29} width={bw} height="9" rx="3" fill="#ff5a5f" />
              {/* ขาดทุน: เส้นประ = ระดับรายได้ (ค่าใช้จ่ายเกินรายได้) */}
              {loss && <line x1={x - 4} x2={x + bw + 4} y1={roadY - 20 - hr} y2={roadY - 20 - hr} stroke="#1b1440" strokeWidth="2.5" strokeDasharray="6 4" />}
              {m.revenue > 0 && !loss && h - hc > 26 && (
                <text x={x + bw / 2} y={y0 + 20} textAnchor="middle" fontSize="14" fontWeight="800" fill="#fff">
                  {((m.profit / m.revenue) * 100).toFixed(0)}%
                </text>
              )}
              <path d={`M${x + bw + 2} ${roadY - 20} v-34 q0 -8 8 -8 h10 l10 16 v26 z`} fill={i === nowIdx ? "#ff2e93" : "#7b2ff7"} />
              <rect x={x + bw + 8} y={roadY - 56} width="10" height="10" rx="2" fill="#e8e2ff" />
              <circle cx={x + 15} cy={wheelY} r="10" fill="#1b1440" />
              <circle cx={x + 15} cy={wheelY} r="4" fill="#ffd43b" />
              <circle cx={x + bw + 14} cy={wheelY} r="10" fill="#1b1440" />
              <circle cx={x + bw + 14} cy={wheelY} r="4" fill="#ffd43b" />
              <text x={cx - 4} y={y0 - 9} textAnchor="middle" fontSize="16" fontWeight="800" fill={loss ? "#e03131" : "#0c8a63"}>
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
