"use client";

/**
 * ให้หน้าที่ "ดูผล" (เช่น วางบิล) รู้เองว่ามีคนแก้ข้อมูลในหน้าอื่น แล้วดึงตัวเลขใหม่
 * โดยไม่โหลดหน้าใหม่ — ตัวกรองและช่องที่ติ๊กไว้จึงไม่หาย
 *
 * ทำงาน 3 ทางซ้อนกัน จะได้ไม่พลาดสักกรณี:
 *  1. หน้าที่บันทึกข้อมูลส่งสัญญาณผ่าน BroadcastChannel → หน้านี้รีเฟรชทันทีที่กดบันทึก
 *  2. หน้าต่างเล็กที่เปิดไปแก้ถูกปิด → รีเฟรช
 *  3. ผู้ใช้กลับมาที่แท็บนี้ (focus) → รีเฟรช (เผื่อเบราว์เซอร์ที่ไม่มี BroadcastChannel หรือแก้ในแท็บอื่น)
 */

import { useEffect, useRef } from "react";

const CHANNEL = "tiamthep-data";
const POPUP_NAME = "tiamthep-fix";

/** เรียกหลังบันทึกสำเร็จ — บอกทุกหน้าที่เปิดอยู่ว่าข้อมูลเปลี่ยนแล้ว (ไม่มีช่องทางก็เงียบ ไม่พัง) */
export function announceDataChanged(): void {
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage({ type: "data-changed", at: Date.now() });
    ch.close();
  } catch {
    /* เบราว์เซอร์เก่า — ยังมีทาง focus รองรับอยู่ */
  }
}

/**
 * เปิดหน้าแก้ไขเป็นหน้าต่างเล็กซ้อนขึ้นมา — ถูกบล็อกก็ถอยไปเปิดแท็บใหม่
 * คืน Window ของหน้าต่างที่เปิด (null = เปิดเป็นแท็บแทน)
 */
export function openFixWindow(href: string): Window | null {
  const w = Math.min(1200, Math.round(window.screen.availWidth * 0.9));
  const h = Math.min(860, Math.round(window.screen.availHeight * 0.9));
  const left = Math.max(0, Math.round((window.screen.availWidth - w) / 2));
  const top = Math.max(0, Math.round((window.screen.availHeight - h) / 2));
  const win = window.open(href, POPUP_NAME, `popup=yes,width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`);
  if (!win) {
    window.open(href, "_blank", "noopener");
    return null;
  }
  win.focus();
  return win;
}

/**
 * ติดตั้งตัวฟังทั้ง 3 ทาง — เรียก refresh เมื่อมีสัญญาณ (กันยิงซ้ำถี่ๆ ด้วยช่วงพัก 1 วินาที)
 * คืนฟังก์ชันสำหรับ "จับตา" หน้าต่างเล็กที่เพิ่งเปิด
 */
export function useAutoRefresh(refresh: () => void): (win: Window | null) => void {
  const lastRef = useRef(0);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const fire = () => {
    const now = Date.now();
    if (now - lastRef.current < 1000) return;
    lastRef.current = now;
    refreshRef.current();
  };

  useEffect(() => {
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel(CHANNEL);
      ch.onmessage = () => fire();
    } catch {
      ch = null;
    }
    const onFocus = () => fire();
    window.addEventListener("focus", onFocus);
    return () => {
      ch?.close();
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (win) => {
    if (!win) return;
    const t = setInterval(() => {
      if (!win.closed) return;
      clearInterval(t);
      fire();
    }, 500);
  };
}
