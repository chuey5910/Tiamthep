/**
 * ต้องสั่งซื้อหรือยัง — ใช้ที่เดียวทุกหน้า (คลังอะไหล่ · สรุปคงเหลือ · หน้าหลัก) ตัวเลขจึงตรงกันเสมอ
 * จุดสั่งซื้อ 0 = ยังไม่ได้ตั้ง → ไม่เตือน (ไม่งั้นสินค้าใหม่ทุกรายการที่ยังไม่มีของขึ้นแดงหมด)
 */
export function needsReorder(balance: number, reorderPoint: number): boolean {
  return reorderPoint > 0 && balance <= reorderPoint;
}
