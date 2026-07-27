"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type TrendPoint = { label: string; revenue: number; cost: number; profit: number };

const fmt = (n: number) => Math.round(n).toLocaleString("th-TH");
const axisFmt = (n: number) => (Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} ล.` : `${Math.round(n / 1000)} พ.`);

/**
 * แนวโน้มรายได้ / ต้นทุน / กำไร ย้อนหลัง 12 เดือน
 * ทั้งสามเส้นเป็นหน่วยบาทเหมือนกัน จึงใช้แกนเดียวได้
 */
export function TrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <div style={{ width: "100%", height: 280 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid stroke="#eef0f3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "#667085" }}
            axisLine={{ stroke: "#e3e6ea" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#667085" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={axisFmt}
            width={56}
          />
          <Tooltip
            formatter={(v: number, name: string) => [`${fmt(v)} บาท`, name]}
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #e3e6ea",
              fontSize: 12,
              boxShadow: "0 4px 12px rgb(16 24 40 / 0.08)",
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Line type="monotone" dataKey="revenue" name="รายได้" stroke="#232326" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="cost" name="ต้นทุน" stroke="#e51c23" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="profit" name="กำไร" stroke="#1baf7a" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
