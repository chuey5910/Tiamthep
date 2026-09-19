/**
 * หน่วยคิดราคาของเส้นทาง — แยกไฟล์ไว้เพราะหน้าฟอร์ม (ฝั่งเบราว์เซอร์) ต้องใช้ด้วย
 *  ต่อเที่ยว   = ราคาคงที่ต่อขา
 *  ต่อตัน      = ราคา × น้ำหนัก (ตัน)
 *  ต่อกิโลกรัม = ราคา × น้ำหนัก × 1000 — ลูกค้าบางรายให้ราคาเป็นบาท/กก. เช่น 0.261
 */
export const PRICE_UNITS = ["ต่อเที่ยว", "ต่อตัน", "ต่อกิโลกรัม"] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

/** ตัวคูณจากน้ำหนัก (ตัน) เป็นจำนวนหน่วยที่ใช้คิดเงิน */
export function priceMultiplier(priceUnit: string, weightTons: number): number {
  if (priceUnit === "ต่อตัน") return weightTons;
  if (priceUnit === "ต่อกิโลกรัม") return weightTons * 1000;
  return 1;
}

export const isWeightPriced = (priceUnit: string) => priceUnit === "ต่อตัน" || priceUnit === "ต่อกิโลกรัม";
