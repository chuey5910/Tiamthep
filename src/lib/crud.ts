/**
 * นิยามหน้าจัดการข้อมูลแบบตาราง (เพิ่ม / แก้ไข / ลบ)
 *
 * ทุกหน้าฐานข้อมูลใช้โค้ดชุดเดียวกัน ต่างกันแค่ "คำอธิบายฟิลด์" ในไฟล์นี้
 * เพิ่มตารางใหม่ = เพิ่ม config หนึ่งก้อน ไม่ต้องเขียนหน้าใหม่
 */

import { prisma } from "./prisma";

export type FieldType = "text" | "number" | "date" | "select" | "textarea" | "checkbox";

/** แหล่งที่มาของตัวเลือกใน dropdown */
export type OptionSource =
  | { kind: "static"; values: string[] }
  | { kind: "lookup"; lookupKind: string }
  | { kind: "vehicles"; ownerType?: string }
  | { kind: "drivers" }
  | { kind: "partners" }
  | { kind: "customers" }
  | { kind: "fuelBasis" }
  | { kind: "items" }
  | { kind: "locations" };

export type Field = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** ตัวเลือกสำหรับ type: "select" */
  options?: OptionSource;
  /** อนุญาตให้เว้นว่าง (แสดงตัวเลือก "— ไม่ระบุ —") */
  allowEmpty?: boolean;
  help?: string;
  step?: string;
  placeholder?: string;
  /** ซ่อนจากตาราง (ยังแก้ไขได้ในฟอร์ม) */
  hideInTable?: boolean;
  /** ซ่อนจากฟอร์ม (คำนวณอัตโนมัติ) */
  hideInForm?: boolean;
  /** วิธีจัดรูปแบบตอนแสดงในตาราง */
  format?: "money" | "num" | "date" | "text";
  /** ความกว้างในฟอร์ม (จำนวนคอลัมน์จาก 4) */
  span?: 1 | 2 | 3 | 4;
  /** แก้ไขไม่ได้หลังสร้างแล้ว (เช่น primary key) */
  immutable?: boolean;
};

export type Resource = {
  key: string;
  model: string;
  title: string;
  subtitle?: string;
  /** ชื่อฟิลด์ที่เป็น primary key */
  idField: string;
  idType: "string" | "number" | "date";
  fields: Field[];
  orderBy: Record<string, "asc" | "desc"> | Record<string, "asc" | "desc">[];
  /** ฟิลด์ที่ใช้ค้นหา (ข้อความ) */
  searchFields?: string[];
  /** จำนวนแถวต่อหน้า */
  pageSize?: number;
  /** ข้อความช่วยเหลือใต้หัวข้อ */
  notes?: string[];
};

// ─────────────────────────────────────────────────────────────

export const RESOURCES: Record<string, Resource> = {
  vehicles: {
    key: "vehicles",
    model: "vehicle",
    title: "ข้อมูลรถ",
    subtitle: "ลงทะเบียนทั้งหัวลากและหางพ่วง เป็นคนละแถวกัน — ระบบใช้ทะเบียนแม่เป็นตัวคิดต้นทุนและรายได้",
    idField: "plate",
    idType: "string",
    orderBy: { plate: "asc" },
    searchFields: ["plate", "vehicleType"],
    pageSize: 100,
    notes: [
      "อายุรถคำนวณจาก 'วันที่เริ่มใช้รถ' เทียบกับวันนี้",
      "ถ้าเลือกเจ้าของเป็น 'รถร่วม' ต้องระบุชื่อรถร่วมด้วย ระบบจึงจะสรุปยอดจ่ายให้ได้",
    ],
    fields: [
      { name: "plate", label: "ทะเบียนรถ", type: "text", required: true, immutable: true, span: 1 },
      { name: "vehicleType", label: "ประเภทรถ", type: "select", required: true, options: { kind: "lookup", lookupKind: "vehicleType" }, span: 1 },
      { name: "ownerType", label: "เจ้าของ", type: "select", required: true, options: { kind: "static", values: ["รถบริษัท", "รถร่วม"] }, span: 1 },
      { name: "partnerId", label: "ชื่อรถร่วม", type: "select", options: { kind: "partners" }, allowEmpty: true, span: 1, help: "กรอกเฉพาะเมื่อเจ้าของเป็นรถร่วม" },
      { name: "startDate", label: "วันที่เริ่มใช้รถ", type: "date", format: "date", span: 1, help: "ใช้คำนวณอายุรถ" },
      { name: "taxDueDate", label: "วันต่อภาษี", type: "date", format: "date", span: 1 },
      { name: "actDueDate", label: "วัน พ.ร.บ. หมดอายุ", type: "date", format: "date", span: 1 },
      { name: "insuranceDue", label: "วันประกันภัยหมดอายุ", type: "date", format: "date", span: 1 },
      { name: "cargoInsDue", label: "วันประกันสินค้าหมดอายุ", type: "date", format: "date", span: 1 },
      { name: "active", label: "ยังใช้งานอยู่", type: "checkbox", span: 1 },
      { name: "note", label: "หมายเหตุ", type: "textarea", span: 4, hideInTable: true },
    ],
  },

  drivers: {
    key: "drivers",
    model: "driver",
    title: "ข้อมูลพนักงานขับรถ",
    subtitle: "รหัสพนักงานต้องตรงกับรหัสในระบบน้ำมัน (เช่น D001) ระบบจึงจับคู่ค่าน้ำมันกับคนขับได้ถูก",
    idField: "code",
    idType: "string",
    orderBy: { code: "asc" },
    searchFields: ["code", "firstName", "lastName", "nationalId", "licenseNo"],
    pageSize: 100,
    fields: [
      { name: "code", label: "รหัส พขร.", type: "text", required: true, immutable: true, span: 1, placeholder: "D001" },
      { name: "firstName", label: "ชื่อ", type: "text", required: true, span: 1 },
      { name: "lastName", label: "นามสกุล", type: "text", span: 1 },
      { name: "phone", label: "เบอร์โทร", type: "text", span: 1 },
      { name: "nationalId", label: "เลขบัตรประชาชน", type: "text", span: 1 },
      { name: "licenseNo", label: "เลขที่ใบขับขี่", type: "text", span: 1 },
      { name: "licenseType", label: "ประเภทใบขับขี่", type: "text", span: 1 },
      { name: "licenseExpiry", label: "วันใบขับขี่หมดอายุ", type: "date", format: "date", span: 1 },
      { name: "active", label: "ยังทำงานอยู่", type: "checkbox", span: 1 },
    ],
  },

  pairings: {
    key: "pairings",
    model: "vehiclePairing",
    title: "จับคู่รถ + พนักงานขับรถ",
    subtitle:
      "1 แถว = 1 คู่ (ทะเบียนแม่ + หางพ่วง) ที่มีผลตั้งแต่วันที่กำหนด — เปลี่ยนคนขับหรือสลับหางพ่วงเมื่อไหร่ ให้เพิ่มแถวใหม่ อย่าแก้แถวเดิม",
    idField: "id",
    idType: "number",
    orderBy: [{ effectiveDate: "desc" }, { headPlate: "asc" }],
    searchFields: ["headPlate", "trailerPlate", "driverCode"],
    pageSize: 100,
    notes: [
      "ระบบเลือกแถวที่ 'วันที่เริ่มมีผล' ใหม่ที่สุดแต่ไม่เกินวันที่ทำงาน จึงย้อนดูข้อมูลเก่าได้ถูกต้องเสมอ",
      "รถที่ไม่มีหางพ่วง (รถเดี่ยว/รถดั๊ม) ให้เว้นช่องหางพ่วงว่างไว้",
    ],
    fields: [
      { name: "headPlate", label: "ทะเบียนแม่ (หัวลาก/รถเดี่ยว)", type: "select", required: true, options: { kind: "vehicles" }, span: 1 },
      { name: "trailerPlate", label: "หางพ่วง", type: "select", options: { kind: "vehicles" }, allowEmpty: true, span: 1 },
      { name: "driverCode", label: "พนักงานขับรถ", type: "select", options: { kind: "drivers" }, allowEmpty: true, span: 1, help: "เว้นว่างได้ถ้าเป็นรถร่วม" },
      { name: "effectiveDate", label: "วันที่เริ่มมีผล", type: "date", required: true, format: "date", span: 1 },
      { name: "note", label: "หมายเหตุ", type: "text", span: 4, hideInTable: true },
    ],
  },

  customers: {
    key: "customers",
    model: "customer",
    title: "ข้อมูลลูกค้า",
    subtitle: "เกณฑ์ราคาน้ำมันและเกณฑ์น้ำหนักตั้งแยกได้รายลูกค้า — ระบบจะคิดค่าบรรทุกตามเกณฑ์ของแต่ละรายให้เอง",
    idField: "id",
    idType: "number",
    orderBy: { code: "asc" },
    searchFields: ["code", "name", "taxId"],
    pageSize: 100,
    notes: [
      "'เกณฑ์ราคาน้ำมัน' คือสูตรที่ใช้หาราคาน้ำมันอ้างอิงมาเทียบขั้นราคา เพิ่มสูตรใหม่ได้ที่หน้าตั้งค่า",
      "'เกณฑ์น้ำหนักคิดราคา' บอกว่าจะเก็บเงินตามน้ำหนักต้นทางหรือปลายทาง",
      "'วันที่เรียกเก็บเงิน' บอกว่าจะนับงานเข้าเดือนไหน ตามวันขึ้นหรือวันลงสินค้า",
    ],
    fields: [
      { name: "code", label: "รหัส / ชื่อย่อ", type: "text", required: true, span: 1 },
      { name: "name", label: "ชื่อลูกค้า", type: "text", required: true, span: 3 },
      { name: "taxId", label: "เลขประจำตัวผู้เสียภาษี", type: "text", span: 1 },
      { name: "branch", label: "สาขาที่ออกใบวางบิล", type: "text", span: 1, placeholder: "00000" },
      { name: "creditDays", label: "เครดิต (วัน)", type: "number", format: "num", span: 1 },
      { name: "billingDay", label: "วันที่รับวางบิล / ออกเช็ค", type: "text", span: 1, placeholder: "ทุกวันที่ 5 และวันที่ 20" },
      { name: "fuelBasisId", label: "เกณฑ์ราคาน้ำมัน", type: "select", options: { kind: "fuelBasis" }, allowEmpty: true, span: 2 },
      { name: "weightBasis", label: "เกณฑ์น้ำหนักคิดราคา", type: "select", options: { kind: "static", values: ["น้ำหนักปลายทาง", "น้ำหนักต้นทาง"] }, span: 1 },
      { name: "billingDateBasis", label: "วันที่เรียกเก็บเงิน", type: "select", options: { kind: "static", values: ["วันที่ขึ้นสินค้า", "วันที่ลงสินค้า"] }, span: 1 },
      { name: "address", label: "ที่อยู่", type: "textarea", span: 4, hideInTable: true },
      { name: "active", label: "ยังเป็นลูกค้าอยู่", type: "checkbox", span: 1 },
    ],
  },

  partners: {
    key: "partners",
    model: "partner",
    title: "รถร่วม (outsource)",
    subtitle: "ผู้ประกอบการที่บริษัทจ้างมาวิ่งงาน — ผูกกับทะเบียนรถที่หน้าข้อมูลรถ",
    idField: "id",
    idType: "number",
    orderBy: { name: "asc" },
    searchFields: ["name", "taxId"],
    fields: [
      { name: "name", label: "ชื่อรถร่วม", type: "text", required: true, span: 2 },
      { name: "taxId", label: "เลขประจำตัวผู้เสียภาษี", type: "text", span: 1 },
      { name: "phone", label: "เบอร์ติดต่อ", type: "text", span: 1 },
      { name: "address", label: "ที่อยู่", type: "textarea", span: 4, hideInTable: true },
      { name: "note", label: "หมายเหตุ", type: "text", span: 3, hideInTable: true },
      { name: "active", label: "ยังใช้บริการอยู่", type: "checkbox", span: 1 },
    ],
  },

  "fuel-prices": {
    key: "fuel-prices",
    model: "fuelPrice",
    title: "ราคาน้ำมันอ้างอิง",
    subtitle: "บันทึกทุกครั้งที่ราคาประกาศเปลี่ยน — ราคาของวันใดๆ คือประกาศล่าสุดที่ไม่เกินวันนั้น",
    idField: "date",
    idType: "date",
    orderBy: { date: "desc" },
    pageSize: 200,
    notes: [
      "ไม่ต้องกรอกทุกวัน กรอกเฉพาะวันที่ราคาเปลี่ยนก็พอ ระบบเติมวันที่เหลือให้เอง",
      "สูตรเฉลี่ยทั้งหลาย (16-15, 1-31, 20-19) คำนวณจากราคารายวันที่ระบบเติมให้นี้",
    ],
    fields: [
      { name: "date", label: "วันที่มีผล", type: "date", required: true, immutable: true, format: "date", span: 1 },
      { name: "price", label: "ราคา (บาท/ลิตร)", type: "number", required: true, step: "0.01", format: "num", span: 1 },
      { name: "note", label: "หมายเหตุ", type: "text", span: 2 },
    ],
  },

  expenses: {
    key: "expenses",
    model: "expense",
    title: "บันทึกค่าใช้จ่าย",
    subtitle: "ไม่ต้องบันทึกค่าน้ำมันที่นี่ — ระบบดึงจากรายการเติมน้ำมันให้อัตโนมัติ",
    idField: "id",
    idType: "number",
    orderBy: [{ date: "desc" }, { id: "desc" }],
    searchFields: ["detail", "supplier", "category", "plate"],
    pageSize: 100,
    notes: ["ค่าใช้จ่ายส่วนกลาง (เงินเดือนสำนักงาน ค่าบริหาร) ไม่ต้องระบุทะเบียนรถ"],
    fields: [
      { name: "date", label: "วันที่", type: "date", required: true, format: "date", span: 1 },
      { name: "plate", label: "ทะเบียนรถ", type: "select", options: { kind: "vehicles" }, allowEmpty: true, span: 1 },
      { name: "driverCode", label: "พขร.", type: "select", options: { kind: "drivers" }, allowEmpty: true, span: 1 },
      { name: "supplier", label: "ผู้ให้บริการ", type: "select", options: { kind: "lookup", lookupKind: "supplier" }, allowEmpty: true, span: 1 },
      { name: "category", label: "ประเภทค่าใช้จ่าย", type: "select", required: true, options: { kind: "lookup", lookupKind: "expenseCategory" }, span: 1 },
      { name: "detail", label: "รายละเอียด", type: "text", span: 3 },
      { name: "unitPrice", label: "ราคาต่อหน่วย", type: "number", step: "0.01", format: "money", span: 1 },
      { name: "qty", label: "จำนวน", type: "number", step: "0.01", format: "num", span: 1 },
      { name: "unit", label: "หน่วย", type: "select", options: { kind: "lookup", lookupKind: "unit" }, allowEmpty: true, span: 1 },
      { name: "amount", label: "ราคารวม (บาท)", type: "number", step: "0.01", format: "money", span: 1, help: "เว้นว่างเพื่อให้คำนวณจาก ราคาต่อหน่วย × จำนวน" },
      { name: "note", label: "หมายเหตุ", type: "text", span: 4, hideInTable: true },
    ],
  },

  advances: {
    key: "advances",
    model: "travelAdvance",
    title: "เงินเดินทาง / ค่าทางด่วน",
    subtitle: "เงินเดินทางคือเงินที่จ่ายให้ พขร. ก่อนออกงาน (หักออกจากเบี้ยเลี้ยง) ส่วนค่าทางด่วนคือเงินที่ พขร. สำรองจ่าย (บวกคืนให้)",
    idField: "id",
    idType: "number",
    orderBy: [{ date: "desc" }, { id: "desc" }],
    searchFields: ["driverCode", "plate", "note"],
    pageSize: 100,
    fields: [
      { name: "date", label: "วันที่", type: "date", required: true, format: "date", span: 1 },
      { name: "plate", label: "ทะเบียนรถ", type: "select", options: { kind: "vehicles" }, allowEmpty: true, span: 1 },
      { name: "driverCode", label: "พขร.", type: "select", required: true, options: { kind: "drivers" }, span: 1 },
      { name: "advance", label: "เงินเดินทางที่รับไป (บาท)", type: "number", step: "0.01", format: "money", span: 1 },
      { name: "toll", label: "ค่าทางด่วนที่จ่ายจริง (บาท)", type: "number", step: "0.01", format: "money", span: 1 },
      { name: "note", label: "หมายเหตุ", type: "text", span: 3 },
    ],
  },

  items: {
    key: "items",
    model: "inventoryItem",
    title: "รายการสินค้าคงคลัง",
    subtitle: "ยาง / แบตเตอรี่ / น้ำมันเครื่อง / อะไหล่ทั่วไป",
    idField: "code",
    idType: "string",
    orderBy: { code: "asc" },
    searchFields: ["code", "name", "category"],
    notes: [
      "'รายชิ้น' ใช้กับของมูลค่าสูงที่ต้องรู้ serial (ยาง/แบตเตอรี่) — ติดตามได้ว่าเส้นไหนอยู่รถคันไหน",
      "'จำนวน' ใช้กับของสิ้นเปลือง (น้ำมันเครื่อง/ไส้กรอง)",
    ],
    fields: [
      { name: "code", label: "รหัสสินค้า", type: "text", required: true, immutable: true, span: 1 },
      { name: "name", label: "ชื่อสินค้า", type: "text", required: true, span: 2 },
      { name: "category", label: "หมวดหมู่", type: "text", span: 1 },
      { name: "unit", label: "หน่วยนับ", type: "select", options: { kind: "lookup", lookupKind: "unit" }, span: 1 },
      { name: "trackingType", label: "ประเภทการติดตาม", type: "select", options: { kind: "static", values: ["จำนวน", "รายชิ้น"] }, span: 1 },
      { name: "reorderPoint", label: "จุดสั่งซื้อขั้นต่ำ", type: "number", step: "0.01", format: "num", span: 1 },
      { name: "note", label: "หมายเหตุ", type: "text", span: 4, hideInTable: true },
    ],
  },

  "stock-in": {
    key: "stock-in",
    model: "stockIn",
    title: "รับเข้าสต็อก",
    subtitle: "บันทึกทุกครั้งที่ซื้อของเข้าคลัง",
    idField: "id",
    idType: "number",
    orderBy: [{ date: "desc" }, { id: "desc" }],
    searchFields: ["itemCode", "vendor", "billNo"],
    pageSize: 100,
    fields: [
      { name: "date", label: "วันที่รับเข้า", type: "date", required: true, format: "date", span: 1 },
      { name: "itemCode", label: "สินค้า", type: "select", required: true, options: { kind: "items" }, span: 2 },
      { name: "qty", label: "จำนวนที่รับเข้า", type: "number", required: true, step: "0.01", format: "num", span: 1 },
      { name: "unitCost", label: "ราคาต่อหน่วย (บาท)", type: "number", step: "0.01", format: "money", span: 1 },
      { name: "vendor", label: "ผู้ขาย / ร้านค้า", type: "select", options: { kind: "lookup", lookupKind: "supplier" }, allowEmpty: true, span: 1 },
      { name: "billNo", label: "เลขที่บิล / ใบกำกับ", type: "text", span: 1 },
      { name: "note", label: "หมายเหตุ", type: "text", span: 3, hideInTable: true },
    ],
  },

  "stock-out": {
    key: "stock-out",
    model: "stockOut",
    title: "เบิกใช้สต็อก",
    subtitle: "บันทึกเมื่อเบิกของออกไปใช้กับรถ — ระบบตัดสต็อกและคิดเป็นต้นทุนของรถคันนั้นให้เลย",
    idField: "id",
    idType: "number",
    orderBy: [{ date: "desc" }, { id: "desc" }],
    searchFields: ["itemCode", "plate", "workOrder", "vendor"],
    pageSize: 100,
    notes: [
      "'รหัสสั่งซ่อม' อาจซ้ำกันได้คนละอู่ ระบบจึงจับคู่กับใบวางบิลโดยใช้ รหัสสั่งซ่อม + อู่ ร่วมกันเสมอ",
      "มูลค่าที่เบิกคิดจาก 'ราคาต่อหน่วยล่าสุดที่รับเข้า' × จำนวน (กรอกทับเองได้)",
      "ของรายชิ้น (ยาง/แบตเตอรี่): กรอกรหัสอุปกรณ์ใหม่ที่ติดตั้งและรหัสเก่าที่ถอด ระบบจะเดินสถานะในทะเบียนให้เอง",
    ],
    fields: [
      { name: "date", label: "วันที่เบิก", type: "date", required: true, format: "date", span: 1 },
      { name: "itemCode", label: "สินค้า", type: "select", required: true, options: { kind: "items" }, span: 2 },
      { name: "qty", label: "จำนวนที่เบิก", type: "number", required: true, step: "0.01", format: "num", span: 1 },
      { name: "plate", label: "ทะเบียนรถที่ใช้", type: "select", options: { kind: "vehicles" }, allowEmpty: true, span: 1 },
      { name: "position", label: "ตำแหน่ง (เช่น ล้อหน้าซ้าย)", type: "text", span: 1 },
      { name: "vendor", label: "อู่ / ผู้ขาย", type: "select", options: { kind: "lookup", lookupKind: "supplier" }, allowEmpty: true, span: 1 },
      { name: "workOrder", label: "รหัสสั่งซ่อม", type: "text", span: 1 },
      {
        name: "newUnitCode",
        label: "รหัสอุปกรณ์ใหม่ที่ติดตั้ง",
        type: "text",
        span: 1,
        placeholder: "TU00001",
        help: "เฉพาะของรายชิ้น (ยาง/แบตเตอรี่) — ดูรหัสได้ที่หน้าทะเบียนยาง/แบตเตอรี่",
      },
      {
        name: "oldUnitCode",
        label: "รหัสอุปกรณ์เก่าที่ถอด",
        type: "text",
        span: 1,
        placeholder: "TU00007",
        help: "กรอกแล้วชิ้นนี้จะเข้าทะเบียนของเก่ารอขายทันที",
      },
      { name: "issuedBy", label: "ผู้เบิก", type: "text", span: 1, hideInTable: true },
      { name: "cost", label: "มูลค่าที่เบิก (บาท)", type: "number", step: "0.01", format: "money", span: 1, help: "เว้นว่างเพื่อให้คิดจากราคาทุนล่าสุด" },
      { name: "note", label: "หมายเหตุ", type: "text", span: 2, hideInTable: true },
    ],
  },

  bills: {
    key: "bills",
    model: "vendorBill",
    title: "ใบวางบิลอู่ / ผู้ขาย",
    subtitle: "ตรวจว่าอู่เรียกเก็บตรงกับที่เบิกไปจริงหรือไม่",
    idField: "id",
    idType: "number",
    orderBy: [{ date: "desc" }, { id: "desc" }],
    searchFields: ["workOrder", "vendor"],
    pageSize: 100,
    fields: [
      { name: "date", label: "วันที่บิล", type: "date", required: true, format: "date", span: 1 },
      { name: "workOrder", label: "รหัสสั่งซ่อม", type: "text", required: true, span: 1 },
      { name: "vendor", label: "อู่ / ผู้ขาย", type: "select", required: true, options: { kind: "lookup", lookupKind: "supplier" }, span: 1 },
      { name: "billedQty", label: "จำนวนที่บิลเรียกเก็บ", type: "number", step: "0.01", format: "num", span: 1 },
      { name: "amount", label: "จำนวนเงิน (บาท)", type: "number", step: "0.01", format: "money", span: 1 },
      { name: "note", label: "หมายเหตุ", type: "text", span: 3, hideInTable: true },
    ],
  },

  "fuel-basis": {
    key: "fuel-basis",
    model: "fuelPriceBasis",
    title: "เกณฑ์ราคาน้ำมันของลูกค้า",
    subtitle: "สูตรหาราคาน้ำมันอ้างอิงที่ใช้เทียบขั้นราคาค่าบรรทุก — เพิ่มสูตรใหม่ได้ตามที่ลูกค้าแต่ละรายตกลงไว้",
    idField: "id",
    idType: "number",
    orderBy: { id: "asc" },
    notes: [
      "SHIP_DATE = ใช้ราคา ณ วันที่ขนจริง",
      "DAY_OF_MONTH = ใช้ราคาวันที่ N ของเดือน (กรอก 'วันที่ N')",
      "SEMI_MONTHLY = งานวันที่ 1-15 ใช้ราคาวันที่ 1 / วันที่ 16 เป็นต้นไปใช้ราคาวันที่ 16",
      "AVERAGE = เฉลี่ยราคารายวันช่วง 'วันเริ่ม' ถึง 'วันสิ้นสุด' — ถ้าวันเริ่มมากกว่าวันสิ้นสุด (เช่น 16 → 15) แปลว่าคาบข้ามเดือน",
      "'ถอยหลังกี่เดือน' = 1 หมายถึงใช้คาบที่จบในเดือนก่อนหน้า (แบบ 'เฉลี่ยเดือนนี้ ไปใช้เดือนหน้า')",
    ],
    fields: [
      { name: "name", label: "ชื่อเกณฑ์ (ที่จะไปเลือกในหน้าลูกค้า)", type: "text", required: true, span: 2 },
      { name: "kind", label: "ชนิดสูตร", type: "select", required: true, options: { kind: "static", values: ["SHIP_DATE", "DAY_OF_MONTH", "SEMI_MONTHLY", "AVERAGE"] }, span: 1 },
      { name: "monthOffset", label: "ถอยหลังกี่เดือน", type: "number", format: "num", span: 1 },
      { name: "dayOfMonth", label: "วันที่ N (ใช้กับ DAY_OF_MONTH)", type: "number", format: "num", span: 1 },
      { name: "startDay", label: "วันเริ่ม (ใช้กับ AVERAGE)", type: "number", format: "num", span: 1 },
      { name: "endDay", label: "วันสิ้นสุด (ใช้กับ AVERAGE)", type: "number", format: "num", span: 1 },
      { name: "note", label: "คำอธิบาย", type: "textarea", span: 4 },
    ],
  },

  bands: {
    key: "bands",
    model: "priceBand",
    title: "ช่วงราคาน้ำมัน",
    subtitle: "ขั้นราคาที่ใช้แบ่งราคาค่าบรรทุก — ราคาน้ำมันอ้างอิงตกช่วงไหน ก็ใช้ราคาค่าบรรทุกของช่วงนั้น",
    idField: "id",
    idType: "number",
    orderBy: { sort: "asc" },
    notes: [
      "เงื่อนไขคือ ราคาน้ำมัน > 'มากกว่า' และ ≤ 'ถึง' (เช่น ช่วง 30.01-31.00 คือมากกว่า 30.00 ถึง 31.00)",
      "แก้ช่วงแล้วราคาค่าบรรทุกเดิมยังผูกกับช่วงเดิมอยู่ — ตรวจที่หน้าเส้นทางอีกครั้ง",
    ],
    fields: [
      { name: "label", label: "ชื่อช่วง", type: "text", required: true, span: 1, placeholder: "30.01-31.00" },
      { name: "minPrice", label: "มากกว่า (บาท/ลิตร)", type: "number", required: true, step: "0.01", format: "num", span: 1 },
      { name: "maxPrice", label: "ถึง (บาท/ลิตร)", type: "number", required: true, step: "0.01", format: "num", span: 1 },
      { name: "sort", label: "ลำดับ", type: "number", format: "num", span: 1 },
    ],
  },

  lookups: {
    key: "lookups",
    model: "lookup",
    title: "รายการตัวเลือก (dropdown)",
    subtitle: "ประเภทรถ ประเภทค่าใช้จ่าย สถานที่ ผู้ให้บริการ หน่วยนับ ประเภทสินค้า",
    idField: "id",
    idType: "number",
    orderBy: [{ kind: "asc" }, { sort: "asc" }],
    searchFields: ["kind", "value"],
    pageSize: 300,
    fields: [
      {
        name: "kind",
        label: "ประเภทรายการ",
        type: "select",
        required: true,
        options: {
          kind: "static",
          values: ["vehicleType", "expenseCategory", "location", "supplier", "unit", "cargoType"],
        },
        span: 1,
      },
      { name: "value", label: "ค่า", type: "text", required: true, span: 2 },
      { name: "sort", label: "ลำดับ", type: "number", format: "num", span: 1 },
    ],
  },
};

export const LOOKUP_KIND_LABEL: Record<string, string> = {
  vehicleType: "ประเภทรถ",
  expenseCategory: "ประเภทค่าใช้จ่าย",
  location: "สถานที่ (ต้นทาง/ปลายทาง)",
  supplier: "ผู้ให้บริการ / อู่ / ร้านค้า",
  unit: "หน่วยนับ",
  cargoType: "ประเภทสินค้า",
};

// ─────────────────────────────────────────────────────────────

export type Option = { value: string; label: string };

/** โหลดตัวเลือกของทุก dropdown ที่ resource นี้ต้องใช้ ในครั้งเดียว */
export async function loadOptions(resource: Resource): Promise<Record<string, Option[]>> {
  const out: Record<string, Option[]> = {};

  for (const f of resource.fields) {
    if (f.type !== "select" || !f.options) continue;
    const src = f.options;

    switch (src.kind) {
      case "static":
        out[f.name] = src.values.map((v) => ({ value: v, label: v }));
        break;
      case "lookup": {
        const rows = await prisma.lookup.findMany({
          where: { kind: src.lookupKind },
          orderBy: [{ sort: "asc" }, { value: "asc" }],
        });
        out[f.name] = rows.map((r) => ({ value: r.value, label: r.value }));
        break;
      }
      case "vehicles": {
        const rows = await prisma.vehicle.findMany({
          where: { active: true, ...(src.ownerType ? { ownerType: src.ownerType } : {}) },
          orderBy: { plate: "asc" },
        });
        out[f.name] = rows.map((r) => ({ value: r.plate, label: `${r.plate} (${r.vehicleType})` }));
        break;
      }
      case "drivers": {
        const rows = await prisma.driver.findMany({ where: { active: true }, orderBy: { code: "asc" } });
        out[f.name] = rows.map((r) => ({ value: r.code, label: `${r.code} ${r.firstName} ${r.lastName}`.trim() }));
        break;
      }
      case "partners": {
        const rows = await prisma.partner.findMany({ orderBy: { name: "asc" } });
        out[f.name] = rows.map((r) => ({ value: String(r.id), label: r.name }));
        break;
      }
      case "customers": {
        const rows = await prisma.customer.findMany({ where: { active: true }, orderBy: { code: "asc" } });
        out[f.name] = rows.map((r) => ({ value: String(r.id), label: `${r.code} — ${r.name}` }));
        break;
      }
      case "fuelBasis": {
        const rows = await prisma.fuelPriceBasis.findMany({ orderBy: { id: "asc" } });
        out[f.name] = rows.map((r) => ({ value: String(r.id), label: r.name }));
        break;
      }
      case "items": {
        const rows = await prisma.inventoryItem.findMany({ orderBy: { code: "asc" } });
        out[f.name] = rows.map((r) => ({ value: r.code, label: `${r.code} — ${r.name}` }));
        break;
      }
      case "locations": {
        const rows = await prisma.lookup.findMany({ where: { kind: "location" }, orderBy: { sort: "asc" } });
        out[f.name] = rows.map((r) => ({ value: r.value, label: r.value }));
        break;
      }
    }
  }

  return out;
}
