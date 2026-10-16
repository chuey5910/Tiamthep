"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * ข้อความบรรทัดเดียวที่ห้ามตัดและห้ามล้นกล่อง — วัดความกว้างจริงบนจอ ล้นเมื่อไรค่อยย่อตัวอักษรลงทีละนิดจนพอดี
 * ไม่ล้น = ใช้ขนาดเต็มตาม className (ไม่เดาจากจำนวนตัวอักษร ฟอนต์ไหนก็พอดี)
 */
export function FitText({ className, style, children }: { className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = "";
      let size = parseFloat(getComputedStyle(el).fontSize);
      for (let i = 0; i < 40 && el.scrollWidth > el.clientWidth + 0.5; i++) {
        size *= 0.95;
        el.style.fontSize = `${size}px`;
      }
    };
    fit();
    document.fonts?.ready.then(fit);
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);

  return (
    <div ref={ref} className={className} style={{ whiteSpace: "nowrap", overflow: "hidden", ...style }}>
      {children}
    </div>
  );
}
