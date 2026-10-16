"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * ย่อ/ขยายเนื้อหาให้พอดีพื้นที่ที่เหลือของหน้าจอ ทั้งแนวตั้งและแนวนอน — หน้านี้ห้ามเลื่อน (เจ้าของสั่ง)
 * เนื้อหากว้างตายตัว (width) · สูงตามสัดส่วนจอ ไม่ต่ำกว่า height ไม่เกิน maxHeight — จอสูงกว่าก็ได้เนื้อหาสูงขึ้น ไม่เหลือที่ว่าง
 * แล้วย่อทั้งก้อนให้พอดีพื้นที่ (เนื้อหาใช้ height: 100% ของกล่องนี้)
 * ปิดการเลื่อนของทั้งหน้าเฉพาะตอนอยู่หน้านี้ ออกจากหน้าแล้วคืนค่าเดิม
 */
export function FitScreen({
  width,
  height,
  maxHeight = height,
  children,
}: {
  width: number;
  height: number;
  maxHeight?: number;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; h: number; inner: number } | null>(null);

  useLayoutEffect(() => {
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = "hidden";
    window.scrollTo(0, 0);
    const measure = () => {
      const el = box.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // เว้นขอบล่างเท่าขอบของหน้า (p-4 / lg:p-6)
      const h = Math.max(200, window.innerHeight - r.top - (window.innerWidth >= 1024 ? 24 : 16));
      const inner = Math.min(maxHeight, Math.max(height, (width * h) / r.width));
      setFit({ scale: Math.min(r.width / width, h / inner), h, inner });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    window.addEventListener("resize", measure);
    return () => {
      html.style.overflow = before;
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [width, height, maxHeight]);

  return (
    <div ref={box} style={{ position: "relative", height: fit?.h ?? height, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: `calc(50% - ${width / 2}px)`,
          width,
          height: fit?.inner ?? height,
          transform: `scale(${fit?.scale ?? 1})`,
          transformOrigin: "top center",
          visibility: fit ? "visible" : "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}
