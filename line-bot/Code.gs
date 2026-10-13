/**
 * ═══════════════════════════════════════════════════════════════
 * ไลน์บอทสั่งงานคนขับ — บริษัท เทียมเทพ ขนส่ง จำกัด
 * ═══════════════════════════════════════════════════════════════
 *
 * ทำงานคู่กับ Google Sheet (ฐานข้อมูลสั่งงาน) และเว็บ TMS บน CHUEY-Server
 *
 * หน้าที่ของสคริปต์นี้
 *  1. สร้างโครงชีตสั่งงาน พร้อม dropdown กันกรอกผิด        → setupSheet()
 *  2. แจ้งงานให้คนขับทาง LINE รายบุคคล ทุกวัน 17:00 น.
 *     และรอบเก็บตก 18:00 น. (ไม่ส่งซ้ำคนที่แจ้งไปแล้ว)      → sendMorningJobs()
 *  3. รับรูปตั๋วจากคนขับ → OCR อ่านข้อความ → กรอกลงชีต     → doPost()
 *
 * หลักความปลอดภัยของข้อมูล (สำคัญ — อย่าแก้ให้ข้ามขั้น)
 *  • ผล OCR "ไม่เขียนลงฐานข้อมูลเว็บโดยตรง" — ลงชีตก่อน (รับของแล้ว/ส่งของเสร็จสิ้น)
 *    พนักงานออฟฟิศตรวจความถูกต้อง แล้วเปลี่ยนสถานะเป็น «ยืนยัน»
 *    จากนั้นเว็บ TMS จะเป็นฝ่ายดึงข้อมูลไปบันทึกเอง (ดูหน้า «งานจากไลน์» ในเว็บ)
 *  • ทุกแถวงานมีรหัสงานไม่ซ้ำ — ฝั่งเว็บใช้กันการนำเข้าซ้ำสองชั้น
 *  • ข้อมูลลับ (token) เก็บใน Script Properties ไม่เก็บในชีต
 *    เพราะชีตแชร์ให้พนักงานหลายคน
 *
 * การติดตั้ง: ดูคู่มือทีละขั้นใน line-bot/README.md ของโปรเจกต์
 */

// ─────────────────────────────────────────────────────────────
// ค่าคงที่ — ชื่อแท็บ คอลัมน์ และสถานะ (ฝั่งเว็บอ้างอิงชุดเดียวกัน อย่าแก้ฝั่งเดียว)
// ─────────────────────────────────────────────────────────────

var SHEET = {
  JOBS: "งาน",
  DRIVERS: "คนขับ",
  TICKETS: "ตั๋ว",
  ALCOHOL: "แอลกอฮอล์",
  MASTER: "ฐานข้อมูล",
  LOG: "LOG",
  SHIP: "ตั๋วเรือ",
};

// คอลัมน์ของแท็บ «งาน» (เลขคอลัมน์เริ่มที่ 1)
var JC = {
  ID: 1,          // รหัสงาน — ระบบตั้งให้อัตโนมัติ เช่น TT260728-01
  DATE: 2,        // วันที่ขึ้นสินค้า
  DRIVER: 3,      // รหัสคนขับ (dropdown)
  DRIVER_NAME: 4, // ชื่อคนขับ — เติมให้อัตโนมัติ
  HEAD: 5,        // ทะเบียนรถ (แม่)
  TRAILER: 6,     // ทะเบียนหาง
  CUSTOMER: 7,    // รหัสลูกค้า (dropdown)
  ORIGIN: 8,      // ต้นทาง
  DEST: 9,        // ปลายทาง
  CARGO: 10,      // ประเภทสินค้า
  NOTE: 11,       // คำสั่งถึงคนขับ / หมายเหตุ
  STATUS: 12,     // สถานะงาน
  NOTIFIED_AT: 13,// เวลาแจ้งไลน์
  // ตั๋ว 2 ใบต่อ 1 งาน: ใบที่ 1 ตอนรับของ (นน.ต้นทาง) · ใบที่ 2 ตอนลงของ (นน.ปลายทาง)
  TICKET_NO_O: 14, // เลขที่ตั๋วต้นทาง (จาก OCR — แก้ได้)
  W_ORIGIN: 15,    // น้ำหนักต้นทาง (ตัน)
  IMG_ORIGIN: 16,  // รูปตั๋วต้นทาง
  TICKET_NO_D: 17, // เลขที่ตั๋วปลายทาง
  W_DEST: 18,      // น้ำหนักปลายทาง (ตัน)
  IMG_DEST: 19,    // รูปตั๋วปลายทาง
  TOLL: 20,        // ค่าทางด่วน (บาท) — ออฟฟิศกรอกตอนจ่ายงาน · เข้าหน้าเงินเดินทางของเว็บ
  ADVANCE: 21,     // เงินรับก่อนเดินทาง (บาท) — ออฟฟิศกรอกตอนจ่ายงาน · เข้าหน้าเงินเดินทางของเว็บ
  IMPORT_RESULT: 22, // ผลนำเข้าเว็บ — ฝั่งเว็บเขียนกลับ
  ACK_AT: 23,      // เวลาคนขับกดปุ่มรับทราบงาน
  ALC_IMG: 24,     // ลิงก์รูปเป่าแอลกอฮอล์ก่อนเริ่มงาน
  POD_IMG: 25,     // รูปสินค้าขึ้นรถ (ถ่ายหลังขึ้นของเสร็จ ไว้ส่งให้ลูกค้า) — มีได้หลายรูป ต่อบรรทัดกัน
};
var JOBS_HEADER = [
  "รหัสงาน", "วันที่", "รหัสคนขับ", "ชื่อคนขับ", "ทะเบียนรถ", "ทะเบียนหาง",
  "รหัสลูกค้า", "ต้นทาง", "ปลายทาง", "ประเภทสินค้า", "คำสั่ง/หมายเหตุ",
  "สถานะ", "เวลาแจ้งไลน์",
  "เลขตั๋วต้นทาง", "นน.ต้นทาง (ตัน)", "รูปตั๋วต้นทาง",
  "เลขตั๋วปลายทาง", "นน.ปลายทาง (ตัน)", "รูปตั๋วปลายทาง",
  "ค่าทางด่วน (บาท)", "เงินรับก่อนเดินทาง (บาท)",
  "ผลนำเข้าเว็บ", "รับทราบเมื่อ", "รูปเป่าแอลกอฮอล์", "รูปสินค้าขึ้นรถ (ส่งลูกค้า)",
];

// คอลัมน์ของแท็บ «คนขับ»
var DC = { CODE: 1, NAME: 2, LINE_ID: 3, REGISTERED_AT: 4 };
var DRIVERS_HEADER = ["รหัสคนขับ", "ชื่อ-นามสกุล", "LINE User ID", "ลงทะเบียนเมื่อ"];

// คอลัมน์ของแท็บ «ตั๋ว» — บันทึกทุกภาพที่ส่งเข้ามา (ไว้ตรวจย้อนหลัง)
var TC = { AT: 1, DRIVER: 2, JOB_ID: 3, LEG: 4, MSG_ID: 5, IMG: 6, OCR_TEXT: 7, PARSED: 8 };
var TICKETS_HEADER = ["เวลา", "รหัสคนขับ", "รหัสงาน", "ขา", "LINE Message ID", "รูป", "ข้อความจาก OCR", "ค่าที่อ่านได้"];

// สถานะของงาน — เดินหน้าอย่างเดียว:
// สั่งงาน → แจ้งแล้ว → รับของแล้ว (ตั๋วใบ 1) → ส่งของเสร็จสิ้น (ตั๋วใบ 2) → ยืนยัน → นำเข้าแล้ว
var ST = {
  NEW: "สั่งงาน",
  NOTIFIED: "แจ้งแล้ว",
  LOADED: "รับของแล้ว",        // ได้ตั๋วต้นทาง (นน.ต้นทาง) แล้ว
  DELIVERED: "ส่งของเสร็จสิ้น",  // ได้ตั๋วปลายทาง (นน.ปลายทาง) แล้ว — รอออฟฟิศตรวจ
  CONFIRMED: "ยืนยัน",       // พนักงานตรวจแล้ว — รอเว็บดึงไปบันทึก
  IMPORTED: "ปิดงาน",         // เว็บดึงเข้าฐานข้อมูลสำเร็จ — งานจบสมบูรณ์ ห้ามแก้ไขในชีตอีก
  IMPORT_FAILED: "นำเข้าไม่ผ่าน", // ฝั่งเว็บเขียนกลับ พร้อมเหตุผลในคอลัมน์ผลนำเข้า
  CANCELLED: "ยกเลิก",
};
var ALL_STATUSES = [ST.NEW, ST.NOTIFIED, ST.LOADED, ST.DELIVERED, ST.CONFIRMED, ST.IMPORTED, ST.IMPORT_FAILED, ST.CANCELLED];

var TZ = "Asia/Bangkok";

// ─────────────────────────────────────────────────────────────
// Script Properties — ตั้งครั้งเดียวตอนติดตั้ง (ดู README)
//   LINE_CHANNEL_ACCESS_TOKEN  token จาก LINE Developers Console
//   WEBHOOK_TOKEN              รหัสลับใน URL webhook กันคนนอกยิงเข้ามา
//   DRIVE_FOLDER_ID            โฟลเดอร์ Drive เก็บรูปตั๋ว
//   ADMIN_USER_ID              LINE userId ของผู้ดูแล — รับแจ้งเตือนเมื่อระบบมีปัญหา (เว้นได้)
// ─────────────────────────────────────────────────────────────

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || "";
}

/**
 * สวิตช์ระบบรับรูปจากคนขับ (ตั๋ว/เป่าแอลกอฮอล์/รูปสินค้า)
 * ปิด = เหลือแค่แจ้งงาน + ปุ่มรับทราบงาน · สลับได้จากเมนู 🚚 ไลน์บอท ไม่ต้องแก้โค้ด
 */
function photosEnabled_() {
  return prop_("PHOTOS_ENABLED") !== "0";
}

function togglePhotoSystem() {
  var props = PropertiesService.getScriptProperties();
  var next = photosEnabled_() ? "0" : "1";
  props.setProperty("PHOTOS_ENABLED", next);
  SpreadsheetApp.getUi().alert(
    next === "0"
      ? "ปิดระบบรับรูปแล้ว 📵\nไลน์บอทเหลือ: แจ้งงาน + ปุ่มรับทราบงาน\nคนขับที่ส่งรูปมาจะได้รับข้อความแจ้งว่ายังไม่เปิดใช้"
      : "เปิดระบบรับรูปแล้ว ✅\nรับรูปตั๋ว / เป่าแอลกอฮอล์ / รูปสินค้าขึ้นรถ ตามปกติ"
  );
}

// ═════════════════════════════════════════════════════════════
// 1) ติดตั้งครั้งแรก
// ═════════════════════════════════════════════════════════════

/** เมนูบนชีต — เครื่องมือทั้งหมดอยู่ที่นี่ ไม่ต้องเข้ามารันในหน้าสคริปต์ */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🚚 ไลน์บอท")
    .addItem("① สร้างโครงชีต (ครั้งแรกครั้งเดียว)", "setupSheet")
    .addItem("② ติดตั้งตัวตั้งเวลาแจ้งงาน 17:00 / 18:00", "installTriggers")
    .addSeparator()
    .addItem("ส่งแจ้งงานที่ค้างเดี๋ยวนี้ (วันนี้+พรุ่งนี้)", "sendMorningJobs")
    .addItem("ทดสอบส่งข้อความหาผู้ดูแล", "testNotifyAdmin")
    .addSeparator()
    .addItem("③ ตั้งค่าอ่านตั๋วเรือ (ครั้งแรกครั้งเดียว)", "setupShipTickets")
    .addItem("อ่านรูปตั๋วเรือใหม่เดี๋ยวนี้", "scanShipTickets")
    .addSeparator()
    .addItem("④ ตั้งค่าใบสั่งงานร้าน (ครั้งแรกครั้งเดียว)", "setupShopOrders")
    .addSeparator()
    .addItem("สลับระบบรับรูปจากคนขับ (ตอนนี้: " + (photosEnabled_() ? "เปิด ✅" : "ปิด 📵") + ")", "togglePhotoSystem")
    .addToUi();
}

/** สร้างแท็บ + หัวตาราง + dropdown + ล็อกคอลัมน์ที่ระบบเป็นคนกรอก */
function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);

  var jobs = ensureSheet_(ss, SHEET.JOBS, JOBS_HEADER);
  ensureSheet_(ss, SHEET.DRIVERS, DRIVERS_HEADER);
  ensureSheet_(ss, SHEET.TICKETS, TICKETS_HEADER);
  ensureSheet_(ss, SHEET.ALCOHOL, ["เวลา", "รหัสคนขับ", "ชื่อคนขับ", "รูปเป่าแอลกอฮอล์"]);
  ensureSheet_(ss, SHEET.LOG, ["เวลา", "ระดับ", "ข้อความ"]);

  // แท็บฐานข้อมูล — เว็บ TMS ส่งข้อมูลจริงมาเติมให้ทุกครั้งที่กด «ดึงงานเข้าเว็บ»
  // A ทะเบียนรถ · B ทะเบียนหาง · C รหัสลูกค้า · D สถานที่ · E ประเภทสินค้า
  // F รหัสคนขับ · G รถประจำ · H หางประจำ (จากหน้า จับคู่รถ+พขร. ในเว็บ — ใช้เติมทะเบียนอัตโนมัติ)
  ensureSheet_(ss, SHEET.MASTER, [
    "ทะเบียนรถ", "ทะเบียนหาง", "รหัสลูกค้า", "สถานที่", "ประเภทสินค้า",
    "รหัสคนขับ", "รถประจำ", "หางประจำ",
  ]);

  // dropdown ของแท็บงาน อ้างช่วงจากแท็บอื่น — ข้อมูลเปลี่ยนแล้ว dropdown เปลี่ยนตามเอง
  var maxRow = 2000;
  setListValidation_(jobs, JC.DRIVER, maxRow, rangeRef_(SHEET.DRIVERS, "A2:A"));
  setListValidation_(jobs, JC.HEAD, maxRow, rangeRef_(SHEET.MASTER, "A2:A"));
  setListValidation_(jobs, JC.TRAILER, maxRow, rangeRef_(SHEET.MASTER, "B2:B"));
  setListValidation_(jobs, JC.CUSTOMER, maxRow, rangeRef_(SHEET.MASTER, "C2:C"));
  setListValidation_(jobs, JC.ORIGIN, maxRow, rangeRef_(SHEET.MASTER, "D2:D"));
  setListValidation_(jobs, JC.DEST, maxRow, rangeRef_(SHEET.MASTER, "D2:D"));
  setListValidation_(jobs, JC.CARGO, maxRow, rangeRef_(SHEET.MASTER, "E2:E"));

  // สถานะจำกัดค่าตายตัว
  var statusRule = SpreadsheetApp.newDataValidation().requireValueInList(ALL_STATUSES, true).setAllowInvalid(false).build();
  jobs.getRange(2, JC.STATUS, maxRow, 1).setDataValidation(statusRule);

  // วันที่บังคับรูปแบบวันที่
  jobs.getRange(2, JC.DATE, maxRow, 1).setNumberFormat("dd/mm/yyyy");
  // น้ำหนักหน่วยตัน แสดงทศนิยม 3 หลักเสมอ เช่น 30.540
  jobs.getRange(2, JC.W_ORIGIN, maxRow, 1).setNumberFormat("0.000");
  jobs.getRange(2, JC.W_DEST, maxRow, 1).setNumberFormat("0.000");
  // เงินบาท ทศนิยม 2 หลัก
  jobs.getRange(2, JC.TOLL, maxRow, 1).setNumberFormat("#,##0.00");
  jobs.getRange(2, JC.ADVANCE, maxRow, 1).setNumberFormat("#,##0.00");

  jobs.setFrozenRows(1);
  SpreadsheetApp.getUi().alert(
    "สร้างโครงชีตเรียบร้อย\n\nขั้นต่อไป: กดเมนู «② ติดตั้งตัวตั้งเวลาแจ้งงาน 17:00 / 18:00»\n" +
    "แล้วไปที่เว็บ TMS หน้า «งานจากไลน์» กดปุ่มดึงข้อมูล 1 ครั้ง เพื่อส่งรายชื่อรถ/ลูกค้า/คนขับมาเติม dropdown"
  );
}

// เวลาส่งแจ้งงาน — รอบหลักและรอบเก็บตก (นาฬิกา 24 ชม. เวลาไทย)
// รอบเก็บตกส่งเฉพาะแถวที่ยังเป็น «สั่งงาน» จึงไม่มีทางส่งซ้ำคนที่ได้รับรอบแรกไปแล้ว
var SEND_TIMES = ["17:00", "18:00"];
var ARM_HOUR = 15; // ชั่วโมงที่ตัวตั้งนัดทำงาน — ต้องมาก่อนรอบแรกอย่างน้อย 1 ชั่วโมง

/**
 * ติดตั้งตัวตั้งเวลา — ใช้ 2 ชั้นเพื่อความเสถียร
 *  ชั้นที่ 1: ทริกเกอร์รายวันช่วง 15:00-16:00 ทำหน้าที่ "ตั้งนาฬิกาปลุก" เวลา 17:00 และ 18:00 ตรงของวันนั้น
 *            (ทริกเกอร์รายวันของ Google เองบอกได้แค่ช่วงชั่วโมง จึงต้องตั้งนัดแบบเจาะเวลาอีกที)
 *  ชั้นที่ 2: ทริกเกอร์รายวันช่วง 17:00-18:00 และ 18:00-19:00 เรียกส่งซ้ำ — ถ้าชั้นแรกส่งไปแล้วจะไม่มีอะไรให้ส่ง
 *            (การส่งทำเครื่องหมาย «แจ้งแล้ว» รายแถว จึงเรียกซ้ำกี่ครั้งก็ไม่ส่งซ้ำคนเดิม)
 */
function installTriggers() {
  // ลบของเก่าก่อน กันติดตั้งซ้ำซ้อน
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === "armMorningSend" || fn === "sendMorningJobs") ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger("armMorningSend").timeBased().atHour(ARM_HOUR).everyDays(1).inTimezone(TZ).create();
  SEND_TIMES.forEach(function (t) {
    var hour = Number(t.split(":")[0]);
    ScriptApp.newTrigger("sendMorningJobs").timeBased().atHour(hour).everyDays(1).inTimezone(TZ).create();
  });

  SpreadsheetApp.getUi().alert(
    "ติดตั้งตัวตั้งเวลาเรียบร้อย — ระบบจะแจ้งงานคนขับทุกวัน\n" +
    "รอบหลัก 17:00 น. และรอบเก็บตก 18:00 น. (ไม่ส่งซ้ำคนที่แจ้งแล้ว)"
  );
}

/** ตั้งนัดยิง sendMorningJobs ตรงเวลาของทุกรอบในวันนี้ (ทำงานโดยทริกเกอร์ช่วง 15:00) */
function armMorningSend() {
  cleanupOneShotTriggers_(); // ลบนัดเก่าที่ยิงไปแล้ว กันทริกเกอร์สะสมจนชนโควตา
  var now = new Date();
  var entries = [];
  SEND_TIMES.forEach(function (t) {
    var at = new Date(Utilities.formatDate(now, TZ, "yyyy/MM/dd") + " " + t + ":00 GMT+07:00");
    if (at.getTime() <= now.getTime()) return; // เลยเวลารอบนี้แล้ว — ปล่อยให้ทริกเกอร์ชั้นที่ 2 จัดการ
    var trigger = ScriptApp.newTrigger("sendMorningJobs").timeBased().at(at).create();
    entries.push({ id: trigger.getUniqueId(), at: at.getTime() });
  });
  // จำรหัส+เวลาของนัดไว้ เพื่อลบทิ้งหลังยิงเสร็จ (แยกจากทริกเกอร์รายวันได้ด้วยรหัส)
  if (entries.length) {
    PropertiesService.getScriptProperties().setProperty("ONESHOT_TRIGGERS", JSON.stringify(entries));
  }
}

// ═════════════════════════════════════════════════════════════
// 2) แจ้งงานตอนเช้า — แยกรายคนขับ
// ═════════════════════════════════════════════════════════════

/**
 * แจ้งงานล่วงหน้า: ส่งงานของ "วันพรุ่งนี้" ให้คนขับแต่ละคนทาง LINE เพื่อเตรียมตัว
 * (และพ่วงงานของ "วันนี้" ที่ยังไม่เคยถูกแจ้ง เผื่อมีสั่งงานด่วนเพิ่มระหว่างวัน)
 *
 * เรียกซ้ำได้เสมอ: ส่งเฉพาะแถวสถานะ «สั่งงาน» แล้วเปลี่ยนเป็น «แจ้งแล้ว» ทันทีที่ส่งสำเร็จ
 * รอบเก็บตก 18:00 จึงส่งเฉพาะแถวที่รอบ 17:00 ยังไม่ได้ส่ง — ไม่ซ้ำคนเดิมแน่นอน
 * แถวที่ส่งไม่สำเร็จ (เช่น คนขับยังไม่ลงทะเบียนไลน์) จะคงสถานะเดิมและแจ้งผู้ดูแล
 */
function sendMorningJobs() {
  // ทริกเกอร์แบบเจาะเวลา (จาก armMorningSend) ใช้ครั้งเดียวทิ้ง — เก็บกวาดของที่ยิงไปแล้ว
  cleanupOneShotTriggers_();

  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // กันทริกเกอร์ 2 ชั้นทำงานชนกัน
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var jobs = ss.getSheetByName(SHEET.JOBS);
    if (!jobs || jobs.getLastRow() < 2) return;

    var today = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");
    var tomorrow = Utilities.formatDate(new Date(Date.now() + 86400000), TZ, "yyyy-MM-dd");
    var data = jobs.getRange(2, 1, jobs.getLastRow() - 1, JOBS_HEADER.length).getValues();
    var driverMap = driverLineIds_(); // รหัสคนขับ → {userId, name}

    // จัดกลุ่มงานพรุ่งนี้ (และงานวันนี้ที่ตกค้าง) สถานะ «สั่งงาน» แยกรายคนขับ
    // แถวที่ตกเงื่อนไขให้นับเหตุผลไว้ด้วย — จะได้บอกออฟฟิศได้ว่าทำไมไม่มีอะไรถูกส่ง
    var byDriver = {}; // code → [{row, values}]
    var skip = { past: 0, future: 0, badDate: 0, noDriver: 0, pastSample: "", futureSample: "" };
    data.forEach(function (v, i) {
      if (String(v[JC.STATUS - 1]) !== ST.NEW) return;
      var ds = dateStr_(v[JC.DATE - 1]);
      if (ds !== tomorrow && ds !== today) {
        if (!ds) skip.badDate++;
        else if (ds < today) {
          skip.past++;
          if (!skip.pastSample) skip.pastSample = thaiDateOfYmd_(ds);
        } else {
          skip.future++;
          if (!skip.futureSample) skip.futureSample = thaiDateOfYmd_(ds);
        }
        return;
      }
      // แปลงเป็นตัวใหญ่เสมอ — ทะเบียนคนขับเก็บแบบตัวใหญ่ พิมพ์ d001/D001/admin ก็ต้องเจอ
      var code = String(v[JC.DRIVER - 1]).trim().toUpperCase();
      if (!code) {
        skip.noDriver++;
        return;
      }
      (byDriver[code] = byDriver[code] || []).push({ row: i + 2, v: v });
    });

    var problems = [];
    Object.keys(byDriver).forEach(function (code) {
      var items = byDriver[code];
      var d = driverMap[code];
      if (!d || !d.userId) {
        problems.push("• " + code + " ยังไม่ได้ลงทะเบียนไลน์ (" + items.length + " งาน)");
        return;
      }
      try {
        var jobIds = items.map(function (it) { return String(it.v[JC.ID - 1]); });
        linePush_(d.userId, jobsMessage_("🚚 แจ้งงานล่วงหน้า", d.name || code, code, items), jobQuickReply_(jobIds));
        var now = Utilities.formatDate(new Date(), TZ, "dd/MM/yyyy HH:mm");
        items.forEach(function (it) {
          jobs.getRange(it.row, JC.STATUS).setValue(ST.NOTIFIED);
          jobs.getRange(it.row, JC.NOTIFIED_AT).setValue(now);
        });
      } catch (err) {
        problems.push("• ส่งหา " + code + " ไม่สำเร็จ: " + err);
        log_("ERROR", "ส่งแจ้งงานหา " + code + " ไม่สำเร็จ: " + err);
      }
    });

    if (problems.length) {
      notifyAdmin_("⚠ แจ้งงานรอบนี้มีปัญหา:\n" + problems.join("\n") + "\n\nแก้แล้วกดเมนู «ส่งแจ้งงานที่ค้างเดี๋ยวนี้» เพื่อส่งซ้ำได้ (ไม่ส่งซ้ำคนที่ได้รับแล้ว)");
    }

    // สรุปเหตุผลของแถวที่ไม่ถูกส่ง — ปัญหาที่เจอบ่อยสุดคือลงวันที่ผิด แล้วระบบเงียบจนคิดว่าพัง
    var skipped = [];
    if (skip.past) skipped.push("• " + skip.past + " แถว วันที่เป็นอดีต (เช่น " + skip.pastSample + ") — ระบบแจ้งเฉพาะงานวันนี้/พรุ่งนี้");
    if (skip.future) skipped.push("• " + skip.future + " แถว วันที่ไกลเกินพรุ่งนี้ (เช่น " + skip.futureSample + ") — จะถูกแจ้งเองในเย็นวันก่อนหน้างาน");
    if (skip.badDate) skipped.push("• " + skip.badDate + " แถว อ่านวันที่ไม่ออก — พิมพ์ใหม่เป็น 01/09/2569 (ต้องมี / ครบ 2 ตัว)");
    if (skip.noDriver) skipped.push("• " + skip.noDriver + " แถว ยังไม่ได้เลือกรหัสคนขับ");

    var sentDrivers = Object.keys(byDriver).length - problems.length;
    log_("INFO", "แจ้งงานล่วงหน้า: คนขับ " + Object.keys(byDriver).length + " คน ปัญหา " + problems.length +
      " รายการ" + (skipped.length ? " · ข้าม: อดีต " + skip.past + " / อนาคต " + skip.future +
      " / วันที่ผิด " + skip.badDate + " / ไม่มีคนขับ " + skip.noDriver : ""));

    // กดจากเมนู = มีหน้าจอให้ตอบกลับ (ทริกเกอร์ตามเวลาไม่มี UI จึงต้องครอบ try)
    try {
      var msg = sentDrivers > 0
        ? "✅ ส่งแจ้งงานแล้ว " + sentDrivers + " คน"
        : "ไม่มีงานที่ต้องแจ้งในรอบนี้";
      if (problems.length) msg += "\n\n⚠ ส่งไม่สำเร็จ:\n" + problems.join("\n");
      if (skipped.length) msg += "\n\nแถวสถานะ «สั่งงาน» ที่ไม่เข้าเงื่อนไข:\n" + skipped.join("\n");
      if (sentDrivers === 0 && !problems.length && !skipped.length) {
        msg += "\n(ไม่พบแถวสถานะ «สั่งงาน» ที่ค้างอยู่ — งานอาจถูกแจ้งไปแล้วทั้งหมด)";
      }
      SpreadsheetApp.getUi().alert(msg);
    } catch (e) {
      // เรียกจากตัวตั้งเวลา ไม่มีหน้าจอ — ข้ามไป (ผลอยู่ในแท็บ LOG แล้ว)
    }
  } finally {
    lock.releaseLock();
  }
}

/** ข้อความแจ้งงานของคนขับหนึ่งคน — ระบุวันที่กำกับทุกงาน กันสับสนวันนี้/พรุ่งนี้ */
function jobsMessage_(title, name, code, items) {
  var lines = [
    title,
    "คุณ" + name + " (" + code + ")",
    "",
  ];
  items.forEach(function (it, idx) {
    var v = it.v;
    lines.push("งานที่ " + (idx + 1) + "  [" + v[JC.ID - 1] + "]");
    lines.push("• วันที่งาน: " + thaiDateOfYmd_(dateStr_(v[JC.DATE - 1])));
    // ช่องหางเป็น «รถเดี่ยว» = ไม่มีหาง ไม่ต้องบอกคนขับ
    var trailer = String(v[JC.TRAILER - 1] || "").trim();
    lines.push("• รถ: " + v[JC.HEAD - 1] + (trailer && trailer !== "รถเดี่ยว" ? " / หาง " + trailer : ""));
    lines.push("• ลูกค้า: " + v[JC.CUSTOMER - 1]);
    lines.push("• เส้นทาง: " + v[JC.ORIGIN - 1] + " → " + v[JC.DEST - 1]);
    if (v[JC.CARGO - 1]) lines.push("• สินค้า: " + v[JC.CARGO - 1]);
    // แจ้งเงินให้คนขับรู้ล่วงหน้า — บางสายต้องรับเงินก่อนออกเดินทาง
    if (Number(v[JC.ADVANCE - 1]) > 0) lines.push("• 💵 เงินรับก่อนเดินทาง: " + Number(v[JC.ADVANCE - 1]).toLocaleString() + " บาท (ติดต่อรับที่ออฟฟิศ)");
    if (Number(v[JC.TOLL - 1]) > 0) lines.push("• 🛣 ค่าทางด่วน: " + Number(v[JC.TOLL - 1]).toLocaleString() + " บาท");
    if (v[JC.NOTE - 1]) lines.push("• หมายเหตุ: " + v[JC.NOTE - 1]);
    lines.push("");
  });
  lines.push("👇 กดปุ่ม «✅ รับทราบงาน» ด้านล่างเพื่อตอบรับงาน");
  if (photosEnabled_()) {
    lines.push("🍺 ก่อนเริ่มงาน กดปุ่ม «ส่งรูปเป่าแอลกอฮอล์» แล้วส่งรูปผลเป่า");
    lines.push("📸 รับของเสร็จ ส่งรูปตั๋วใบที่ 1 (นน.ต้นทาง) · ลงของเสร็จ ส่งรูปตั๋วใบที่ 2 (นน.ปลายทาง)");
  }
  return lines.join("\n");
}

// ═════════════════════════════════════════════════════════════
// 3) Webhook — รับข้อความ/รูปจากคนขับ
// ═════════════════════════════════════════════════════════════

/**
 * จุดรับ webhook จาก LINE
 * ความปลอดภัย: Apps Script ไม่ให้อ่าน header จึงตรวจลายเซ็น LINE ไม่ได้ —
 * ใช้รหัสลับใน URL แทน (?token=...) ต้องตรงกับ WEBHOOK_TOKEN เท่านั้นจึงประมวลผล
 * และ webhook นี้ "เขียนได้แค่ในชีต" ไม่มีทางแตะฐานข้อมูลเว็บโดยตรง
 */
function doPost(e) {
  try {
    var expected = prop_("WEBHOOK_TOKEN");
    if (!expected || !e || !e.parameter || e.parameter.token !== expected) {
      return ContentService.createTextOutput("forbidden");
    }
    var body = JSON.parse(e.postData.contents);
    (body.events || []).forEach(function (ev) {
      try {
        handleEvent_(ev);
      } catch (err) {
        log_("ERROR", "handleEvent: " + err + " | " + JSON.stringify(ev).slice(0, 300));
      }
    });
  } catch (err) {
    log_("ERROR", "doPost: " + err);
  }
  // ตอบ 200 เสมอ — ถ้าตอบ error LINE จะยิงซ้ำวนไปเรื่อยๆ
  return ContentService.createTextOutput("ok");
}

function handleEvent_(ev) {
  // LINE ยิงซ้ำได้ถ้าตอบช้า — เคยเห็น event นี้แล้วให้ข้ามทันที
  if (ev.deliveryContext && ev.deliveryContext.isRedelivery) return;
  var cache = CacheService.getScriptCache();
  var evKey = "ev_" + (ev.webhookEventId || (ev.message && ev.message.id) || "");
  if (evKey !== "ev_" && cache.get(evKey)) return;
  cache.put(evKey, "1", 3600);

  var userId = ev.source && ev.source.userId;
  if (!userId) return;

  if (ev.type === "follow") {
    lineReply_(ev.replyToken,
      "สวัสดีครับ 🚚 ไลน์บริษัท เทียมเทพ ขนส่ง\n\n" +
      "ขั้นแรก พิมพ์ลงทะเบียนด้วยรหัสที่ได้จากออฟฟิศ เช่น\n\nลงทะเบียน D001");
    return;
  }
  if (ev.type === "postback") {
    handlePostback_(ev, userId, String(ev.postback && ev.postback.data || ""));
    return;
  }
  if (ev.type !== "message") return;

  if (ev.message.type === "text") {
    handleText_(ev, userId, String(ev.message.text || "").trim());
  } else if (ev.message.type === "image") {
    handleImage_(ev, userId);
  }
}

/** คนขับกดปุ่มใต้ข้อความ: รับทราบงาน หรือ ขอส่งรูปเป่าแอลกอฮอล์ */
function handlePostback_(ev, userId, data) {
  // ปุ่มบนการ์ดใบสั่งงานร้าน — ร้านไม่ใช่คนขับ ต้องแยกก่อนเช็คทะเบียนคนขับ
  if (data.indexOf("po|") === 0) {
    handlePoPostback_(ev, userId, data);
    return;
  }
  var code = driverCodeOf_(userId);
  if (!code) {
    lineReply_(ev.replyToken, "ยังไม่ได้ลงทะเบียน — พิมพ์ «ลงทะเบียน <รหัสพนักงาน>» ก่อนครับ");
    return;
  }

  // ปุ่มเกี่ยวกับรูปทั้งหมด (เป่า/ส่งใหม่/รูปสินค้า) ใช้ได้เฉพาะตอนเปิดระบบรับรูป
  if (data.indexOf("ack|") !== 0 && !photosEnabled_()) {
    lineReply_(ev.replyToken, "📵 ช่วงนี้ระบบยังไม่เปิดรับรูปทางไลน์\nข้อมูลตั๋ว/เอกสาร ส่งกับออฟฟิศตามปกติครับ");
    return;
  }

  // «รับทราบงาน» — ประทับเวลาลงทุกแถวงานที่อยู่ในข้อความนั้น
  if (data.indexOf("ack|") === 0) {
    var ids = data.slice(4).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    var count = ackJobs_(code, ids);
    if (count > 0) {
      var thanks = "✅ รับทราบงานเรียบร้อย (" + count + " งาน) ขอบคุณครับ";
      if (photosEnabled_()) {
        thanks += "\n\n🍺 ก่อนเริ่มงาน อย่าลืมกดปุ่มด้านล่างแล้วส่งรูปผลเป่าแอลกอฮอล์";
      }
      lineReply_(ev.replyToken, thanks, jobQuickReply_(null));
    } else {
      lineReply_(ev.replyToken, "งานชุดนี้ถูกบันทึกรับทราบไว้แล้วครับ ✅");
    }
    return;
  }

  // «ขอส่งรูปเป่าแอลกอฮอล์» — เปิดโหมดรอรูป 15 นาที รูปถัดไปจะบันทึกเป็นรูปเป่า ไม่ใช่ตั๋ว
  if (data === "alc") {
    CacheService.getScriptCache().put("mode_" + userId, "alcohol", 900);
    lineReply_(ev.replyToken, "🍺 ส่งรูปผลเป่าแอลกอฮอล์เข้ามาได้เลยครับ (ภายใน 15 นาที)\nรูปที่ส่งหลังจากนี้ 1 รูปจะถูกบันทึกเป็นผลเป่าแอลกอฮอล์ของวันนี้");
    return;
  }

  // «รูปไม่ชัด ส่งใบนี้ใหม่» — รูปถัดไปจะ "แทนที่" ตั๋วใบเดิมของงานเดิม ไม่ถูกนับเป็นใบถัดไป
  if (data.indexOf("redo|") === 0) {
    CacheService.getScriptCache().put("mode_" + userId, data, 900);
    var legName = data.split("|")[2] || "";
    lineReply_(ev.replyToken, "🔄 ส่งรูปตั๋ว" + legName + "ใบใหม่เข้ามาได้เลยครับ (ภายใน 15 นาที)\nรูปใหม่จะแทนที่ใบเดิม เคล็ดลับ: ถ่ายในที่สว่าง ให้ตัวหนังสือเต็มเฟรม ไม่เอียง");
    return;
  }

  // «ส่งรูปสินค้าขึ้นรถ» — รูปถัดไปบันทึกเป็นรูปสินค้าบนรถ ออฟฟิศใช้ส่งให้ลูกค้า
  if (data.indexOf("pod|") === 0 || data === "pod") {
    CacheService.getScriptCache().put("mode_" + userId, data === "pod" ? "pod|" : data, 900);
    lineReply_(ev.replyToken, "📷 ส่งรูปสินค้าที่ขึ้นรถเสร็จแล้วเข้ามาได้เลยครับ (ภายใน 15 นาที)\nส่งได้หลายรูป — ส่งเสร็จแต่ละรูปกดปุ่มเดิมเพื่อส่งรูปถัดไป");
    return;
  }
}

/** ประทับเวลารับทราบงานลงแถวตามรหัสงาน — เฉพาะแถวของคนขับคนนั้นและยังไม่เคยรับทราบ */
function ackJobs_(code, ids) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var jobs = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.JOBS);
    if (!jobs || jobs.getLastRow() < 2) return 0;
    var data = jobs.getRange(2, 1, jobs.getLastRow() - 1, JOBS_HEADER.length).getValues();
    var now = Utilities.formatDate(new Date(), TZ, "dd/MM/yyyy HH:mm");
    var count = 0;
    data.forEach(function (v, i) {
      if (ids.indexOf(String(v[JC.ID - 1]).trim()) < 0) return;
      if (String(v[JC.DRIVER - 1]).trim().toUpperCase() !== code) return;
      if (String(v[JC.ACK_AT - 1]).trim() !== "") return; // รับทราบไปแล้ว — กดซ้ำไม่ทับเวลาเดิม
      jobs.getRange(i + 2, JC.ACK_AT).setValue(now);
      count++;
    });
    return count;
  } finally {
    lock.releaseLock();
  }
}

/** ข้อความตัวอักษร: ลงทะเบียน / ขอดูงานวันนี้ / อื่นๆ */
function handleText_(ev, userId, text) {
  // «ลงทะเบียน D001»
  var m = text.match(/^ลงทะเบียน\s*([A-Za-z0-9\-]+)$/);
  if (m) {
    handleRegister_(ev.replyToken, userId, m[1].toUpperCase()); // คนขับ / พนักงานสั่งของ / ร้าน
    return;
  }
  // ใบสั่งงานร้าน (#สั่ง #สถานะ #ยกเลิก · เมนูร้าน · ราคาที่ร้านพิมพ์)
  if (handlePoText_(ev, userId, text)) return;
  // พนักงานสั่งของที่ไม่ใช่คนขับ — ไม่ต้องเห็นคำสั่งของคนขับ
  if (!driverCodeOf_(userId) && partyOf_(SHEET.STAFF, userId)) {
    lineReply_(ev.replyToken, "คำสั่งที่ใช้ได้\n• #สั่ง — สั่งงานร้าน (พิมพ์ #สั่ง เพื่อดูตัวอย่าง)\n• #สถานะ PO-… — ดูสถานะใบสั่ง\n• #สถานะ — 5 ใบล่าสุดของคุณ\n• #ยกเลิก PO-… — ยกเลิกใบที่ร้านยังไม่ตอบ");
    return;
  }
  if (text === "งานวันนี้") {
    resendJobs_(ev.replyToken, userId, 0);
    return;
  }
  if (text === "งานพรุ่งนี้") {
    resendJobs_(ev.replyToken, userId, 1);
    return;
  }
  if (text === "เป่า" || text === "แอลกอฮอล์" || text === "เป่าแอลกอฮอล์") {
    handlePostback_(ev, userId, "alc"); // พิมพ์คำสั่งได้ผลเดียวกับกดปุ่ม
    return;
  }
  var help =
    "คำสั่งที่ใช้ได้\n" +
    "• พิมพ์ «งานวันนี้» — ดูงานของท่านวันนี้\n" +
    "• พิมพ์ «งานพรุ่งนี้» — ดูงานล่วงหน้าของพรุ่งนี้\n";
  if (photosEnabled_()) {
    help +=
      "• พิมพ์ «เป่า» แล้วส่งรูป — บันทึกผลเป่าแอลกอฮอล์\n" +
      "• ส่งรูปตั๋ว — ระบบจะบันทึกให้อัตโนมัติ\n";
  }
  help += "• «ลงทะเบียน <รหัสพนักงาน>» — ผูกไลน์กับรหัสของท่าน";
  lineReply_(ev.replyToken, help);
}

/**
 * ผูก LINE userId เข้ากับรหัสคนขับ
 * รัดกุม: รหัสต้องมีอยู่ในแท็บคนขับ (เว็บส่งรายชื่อจริงมาให้) และ 1 รหัสผูกได้ 1 ไลน์
 * ถ้าจะย้ายเครื่อง/เปลี่ยนไลน์ ให้ออฟฟิศลบค่าในคอลัมน์ LINE User ID ก่อน
 */
function registerDriver_(replyToken, userId, code) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.DRIVERS);
    var last = sh.getLastRow();
    var rows = last > 1 ? sh.getRange(2, 1, last - 1, 4).getValues() : [];
    for (var i = 0; i < rows.length; i++) {
      var rowCode = String(rows[i][DC.CODE - 1]).trim().toUpperCase();
      var bound = String(rows[i][DC.LINE_ID - 1]).trim();
      if (bound === userId && rowCode !== code) {
        lineReply_(replyToken, "ไลน์ของท่านผูกกับรหัส " + rowCode + " อยู่แล้ว หากต้องการเปลี่ยน กรุณาติดต่อออฟฟิศ");
        return;
      }
    }
    for (var j = 0; j < rows.length; j++) {
      if (String(rows[j][DC.CODE - 1]).trim().toUpperCase() !== code) continue;
      var existing = String(rows[j][DC.LINE_ID - 1]).trim();
      if (existing && existing !== userId) {
        lineReply_(replyToken, "รหัส " + code + " ถูกผูกกับไลน์เครื่องอื่นอยู่แล้ว กรุณาติดต่อออฟฟิศเพื่อปลดล็อก");
        notifyAdmin_("⚠ มีผู้พยายามลงทะเบียนรหัส " + code + " ซ้ำจากไลน์เครื่องใหม่ — ตรวจสอบด้วย");
        return;
      }
      sh.getRange(j + 2, DC.LINE_ID).setValue(userId);
      sh.getRange(j + 2, DC.REGISTERED_AT).setValue(Utilities.formatDate(new Date(), TZ, "dd/MM/yyyy HH:mm"));
      var name = String(rows[j][DC.NAME - 1]).trim();
      lineReply_(replyToken, "✅ ลงทะเบียนสำเร็จ\nคุณ" + (name || code) + " (" + code + ")\n\nระบบจะแจ้งงานล่วงหน้าให้ทุกเย็น เวลา 17:00 น. (รอบเก็บตก 18:00 น.)");
      log_("INFO", "ลงทะเบียนคนขับ " + code);
      return;
    }
    lineReply_(replyToken, "ไม่พบรหัส " + code + " ในระบบ (คนขับ / พนักงานสั่งของ / ร้านค้า) กรุณาตรวจรหัส หรือติดต่อออฟฟิศ");
  } finally {
    lock.releaseLock();
  }
}

/** คนขับพิมพ์ «งานวันนี้» หรือ «งานพรุ่งนี้» — ส่งรายการงานของวันนั้นซ้ำอีกรอบ */
function resendJobs_(replyToken, userId, dayOffset) {
  var code = driverCodeOf_(userId);
  if (!code) {
    lineReply_(replyToken, "ยังไม่ได้ลงทะเบียน — พิมพ์ «ลงทะเบียน <รหัสพนักงาน>» ก่อนครับ");
    return;
  }
  var label = dayOffset === 0 ? "วันนี้" : "พรุ่งนี้";
  var ymd = Utilities.formatDate(new Date(Date.now() + dayOffset * 86400000), TZ, "yyyy-MM-dd");
  var items = jobsOnDateOf_(code, ymd, null);
  if (!items.length) {
    lineReply_(replyToken, label + "ยังไม่มีงานของท่านในระบบครับ");
    return;
  }
  var d = driverLineIds_()[code];
  var jobIds = items.map(function (it) { return String(it.v[JC.ID - 1]); });
  lineReply_(replyToken, jobsMessage_("🚚 งาน" + label, (d && d.name) || code, code, items), jobQuickReply_(jobIds));
}

// ─────────────────────────────────────────────────────────────
// รับรูปตั๋ว → OCR → กรอกลงชีต
// ─────────────────────────────────────────────────────────────

function handleImage_(ev, userId) {
  // รูปบิลจากร้าน — แยกก่อนเช็คทะเบียนคนขับ
  if (handlePoImage_(ev, userId)) return;
  var code = driverCodeOf_(userId);
  if (!code) {
    lineReply_(ev.replyToken, "ยังไม่ได้ลงทะเบียน — พิมพ์ «ลงทะเบียน <รหัสพนักงาน>» ก่อน แล้วส่งรูปใหม่อีกครั้งครับ");
    return;
  }

  // สวิตช์ปิดระบบรับรูปอยู่ — แจ้งคนขับสุภาพๆ ไม่บันทึกอะไร
  if (!photosEnabled_()) {
    lineReply_(ev.replyToken, "📵 ช่วงนี้ระบบยังไม่เปิดรับรูปทางไลน์\nข้อมูลตั๋ว/เอกสาร ส่งกับออฟฟิศตามปกติครับ");
    return;
  }

  // คนขับกดปุ่มเลือกโหมดไว้ก่อนส่งรูป — รูปนี้อาจไม่ใช่ตั๋วใบถัดไป
  var cache = CacheService.getScriptCache();
  var mode = cache.get("mode_" + userId) || "";
  if (mode) cache.remove("mode_" + userId); // ใช้ครั้งเดียว — รูปถัดไปกลับเป็นตั๋วตามปกติ
  if (mode === "alcohol") {
    handleAlcoholImage_(ev, code);
    return;
  }
  if (mode.indexOf("redo|") === 0) {
    handleRedoImage_(ev, code, mode.split("|")[1] || "", mode.split("|")[2] || "");
    return;
  }
  if (mode.indexOf("pod|") === 0) {
    handlePodImage_(ev, code, mode.split("|")[1] || "");
    return;
  }

  // ดึงไฟล์ภาพจาก LINE แล้วเก็บเข้า Drive ทันที (ได้รูปไว้ก่อน OCR จะสำเร็จหรือไม่ก็ตาม)
  var blob = lineGetContent_(ev.message.id);
  var stamp = Utilities.formatDate(new Date(), TZ, "yyyyMMdd-HHmmss");
  blob.setName(stamp + "_" + code + "_" + ev.message.id + ".jpg");
  var file = imageFolder_("รูปตั๋ว").createFile(blob);
  var imgUrl = file.getUrl();

  // OCR — พังก็ไม่เป็นไร รูปยังอยู่ ให้ออฟฟิศอ่านเอง
  var ocrText = "";
  try {
    ocrText = ocrImage_(blob);
  } catch (err) {
    log_("ERROR", "OCR ไม่สำเร็จ: " + err);
  }
  var parsed = parseTicket_(ocrText);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // จับคู่กับงาน "วันนี้" ของคนขับ แล้วดูว่าเป็นตั๋วใบไหน (เรียงตามลำดับแถวในชีต):
    //   งานที่ยังไม่มีรูปตั๋วต้นทาง → รูปนี้คือ ตั๋วต้นทาง (รับของแล้ว)
    //   งานที่มีตั๋วต้นทางแล้ว แต่ยังไม่มีตั๋วปลายทาง → รูปนี้คือ ตั๋วปลายทาง (ส่งของเสร็จสิ้น)
    var today = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");
    var candidates = jobsOnDateOf_(code, today, null);
    var openStatuses = [ST.NEW, ST.NOTIFIED, ST.LOADED];
    var target = null;
    var leg = ""; // "ต้นทาง" | "ปลายทาง"
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (openStatuses.indexOf(String(c.v[JC.STATUS - 1])) < 0) continue;
      if (String(c.v[JC.IMG_ORIGIN - 1]).trim() === "") {
        target = c; leg = "ต้นทาง"; break;
      }
      if (String(c.v[JC.IMG_DEST - 1]).trim() === "") {
        target = c; leg = "ปลายทาง"; break;
      }
    }

    var jobs = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.JOBS);
    var jobId = "";

    // กติกา: ต้องส่งรูปเป่าแอลกอฮอล์ก่อนตั๋วต้นทางเสมอ
    if (target && leg === "ต้นทาง" && String(target.v[JC.ALC_IMG - 1]).trim() === "") {
      file.setTrashed(true); // รูปที่ตีกลับ ไม่เก็บ — เดี๋ยวคนขับส่งใหม่ตามลำดับที่ถูก
      log_("INFO", code + " ส่งตั๋วต้นทางก่อนเป่าแอลกอฮอล์ — ตีกลับ [" + String(target.v[JC.ID - 1]) + "]");
      lineReply_(ev.replyToken,
        "⛔ ยังไม่ได้ส่งรูปเป่าแอลกอฮอล์ของวันนี้\n\n" +
        "ลำดับที่ถูกต้อง:\n1. กดปุ่ม 🍺 ด้านล่าง แล้วส่งรูปผลเป่า\n2. จากนั้นถ่ายรูปตั๋วต้นทางส่งมาใหม่อีกครั้ง",
        jobQuickReply_(null));
      return;
    }

    if (target) {
      jobId = String(target.v[JC.ID - 1]);
      // ย้ายรูปเข้าโฟลเดอร์ตามใบที่จับคู่ได้ (ลิงก์เดิมใช้ได้ต่อ ไม่เปลี่ยน)
      file.moveTo(imageFolder_(leg === "ต้นทาง" ? "รูปตั๋วต้นทาง" : "รูปตั๋วปลายทาง"));

      // เติมเฉพาะช่องที่ยังว่าง — ไม่ทับข้อมูลที่ออฟฟิศกรอกไว้แล้ว
      if (leg === "ต้นทาง") {
        fillIfEmpty_(jobs, target.row, JC.TICKET_NO_O, parsed.ticketNo);
        fillIfEmpty_(jobs, target.row, JC.W_ORIGIN, parsed.netTons);
        jobs.getRange(target.row, JC.IMG_ORIGIN).setValue(imgUrl);
        jobs.getRange(target.row, JC.STATUS).setValue(ST.LOADED);
      } else {
        fillIfEmpty_(jobs, target.row, JC.TICKET_NO_D, parsed.ticketNo);
        fillIfEmpty_(jobs, target.row, JC.W_DEST, parsed.netTons);
        jobs.getRange(target.row, JC.IMG_DEST).setValue(imgUrl);
        jobs.getRange(target.row, JC.STATUS).setValue(ST.DELIVERED);
      }
    }

    // ลงบันทึกแท็บตั๋วทุกครั้ง — ตรวจย้อนหลังได้เสมอ แม้จับคู่งานไม่ได้
    var tickets = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.TICKETS);
    tickets.appendRow([
      Utilities.formatDate(new Date(), TZ, "dd/MM/yyyy HH:mm:ss"),
      code, jobId || "(จับคู่ไม่ได้)", leg || "-", ev.message.id, imgUrl,
      ocrText.slice(0, 5000), JSON.stringify(parsed),
    ]);

    if (target) {
      var summary = [];
      if (leg === "ต้นทาง") {
        summary.push("📦 บันทึกตั๋วต้นทางแล้ว [" + jobId + "]");
        if (parsed.ticketNo) summary.push("เลขที่ตั๋ว: " + parsed.ticketNo);
        if (parsed.netTons) summary.push("นน.ต้นทาง: " + parsed.netTons + " ตัน");
        summary.push("สถานะ: รับของแล้ว ✅");
        summary.push("\n📷 กดปุ่มด้านล่างเพื่อส่งรูปสินค้าบนรถ (ออฟฟิศส่งให้ลูกค้า)");
        summary.push("เมื่อลงของเสร็จ ถ่ายรูปตั๋วปลายทางส่งมาอีกครั้งนะครับ");
      } else {
        summary.push("🏁 บันทึกตั๋วปลายทางแล้ว [" + jobId + "]");
        if (parsed.ticketNo) summary.push("เลขที่ตั๋ว: " + parsed.ticketNo);
        if (parsed.netTons) summary.push("นน.ปลายทาง: " + parsed.netTons + " ตัน");
        summary.push("สถานะ: ส่งของเสร็จสิ้น ✅ งานเสร็จสมบูรณ์");
        summary.push("\nขอบคุณครับ 🙏 ออฟฟิศจะตรวจและยืนยันอีกครั้ง");
      }
      if (!parsed.ticketNo && !parsed.netTons) {
        summary.push("(ระบบอ่านตัวเลขจากรูปไม่ได้ ออฟฟิศจะอ่านจากรูปแทน)");
      }
      // ปุ่มใต้ข้อความ: ส่งใบนี้ใหม่ถ้ารูปไม่ชัด · หลังตั๋วต้นทาง (ขึ้นของเสร็จ) เพิ่มปุ่มส่งรูปสินค้าขึ้นรถ
      lineReply_(ev.replyToken, summary.join("\n"), ticketQuickReply_(jobId, leg, leg === "ต้นทาง"));
    } else {
      lineReply_(ev.replyToken, "รับรูปไว้แล้ว แต่ไม่พบงานของท่านที่ยังรอตั๋วในวันนี้ ออฟฟิศจะตรวจสอบให้ครับ");
      notifyAdmin_("⚠ คนขับ " + code + " ส่งรูปตั๋วมา แต่ไม่พบงานที่ยังรอตั๋วของเขาวันนี้ — ดูที่แท็บ «ตั๋ว»");
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * บันทึกรูปเป่าแอลกอฮอล์: เก็บเข้า Drive (ชื่อไฟล์ขึ้นต้น ALC) + ลงแท็บ «แอลกอฮอล์»
 * + เติมลิงก์ลงคอลัมน์ รูปเป่าแอลกอฮอล์ ของทุกงาน "วันนี้" ของคนขับคนนั้น
 * (เป่าครั้งเดียวต่อวัน ครอบคลุมทุกงานในวันนั้น)
 */
function handleAlcoholImage_(ev, code) {
  // กติกา: รูปเป่าแอลกอฮอล์ส่งได้เฉพาะ "วันทำงาน" เท่านั้น
  // รับแจ้งงานเย็นนี้ (งานของพรุ่งนี้) แล้วส่งรูปเป่าคืนนี้เลยไม่ได้ — ต้องเป่าเช้าวันงานก่อนเริ่มงานจริง
  var today = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");
  var items = jobsOnDateOf_(code, today, null);
  if (!items.length) {
    var tomorrow = Utilities.formatDate(new Date(Date.now() + 86400000), TZ, "yyyy-MM-dd");
    var hasTomorrow = jobsOnDateOf_(code, tomorrow, null).length > 0;
    lineReply_(ev.replyToken, hasTomorrow
      ? "🗓 งานของท่านเป็นของวันพรุ่งนี้\nรูปเป่าแอลกอฮอล์ต้องส่ง «เช้าวันทำงาน ก่อนเริ่มงาน» — พรุ่งนี้เช้ากดปุ่ม 🍺 แล้วส่งรูปใหม่อีกครั้งนะครับ"
      : "วันนี้ยังไม่มีงานของท่านในระบบ — รูปเป่าแอลกอฮอล์ส่งได้เฉพาะวันที่มีงานครับ");
    return;
  }

  var blob = lineGetContent_(ev.message.id);
  var stamp = Utilities.formatDate(new Date(), TZ, "yyyyMMdd-HHmmss");
  blob.setName(stamp + "_" + code + "_" + ev.message.id + ".jpg");
  var imgUrl = imageFolder_("เป่าแอลกอฮอล์").createFile(blob).getUrl();

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var driverMap = driverLineIds_();
    var name = (driverMap[code] && driverMap[code].name) || "";

    // ลงบันทึกกลางไว้ตรวจย้อนหลังเสมอ
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.ALCOHOL).appendRow([
      Utilities.formatDate(new Date(), TZ, "dd/MM/yyyy HH:mm:ss"), code, name, imgUrl,
    ]);

    // เติมลิงก์ลงทุกงานวันนี้ของคนขับ (เฉพาะช่องที่ยังว่าง)
    var jobs = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.JOBS);
    items.forEach(function (it) {
      fillIfEmpty_(jobs, it.row, JC.ALC_IMG, imgUrl);
    });

    lineReply_(ev.replyToken,
      "🍺✅ บันทึกรูปเป่าแอลกอฮอล์เรียบร้อย\n" +
      "ผูกกับงานวันนี้ " + items.length + " งานแล้ว ขับขี่ปลอดภัยนะครับ 🙏\n\n" +
      "เมื่อรับของได้ตั๋วแล้ว ถ่ายรูปตั๋วต้นทางส่งมาได้เลย");
  } finally {
    lock.releaseLock();
  }
}

/**
 * รูปตั๋วส่งใหม่ (ใบเดิมไม่ชัด) — แทนที่รูป/ค่าของ "ตั๋วใบเดิม งานเดิม" เท่านั้น
 * จึงไม่มีทางถูกนับเป็นตั๋วใบถัดไปโดยพลาด
 */
function handleRedoImage_(ev, code, jobId, leg) {
  var target = findRowByJobId_(code, jobId);
  if (!target) {
    lineReply_(ev.replyToken, "ไม่พบงาน [" + jobId + "] ของท่านครับ กรุณาติดต่อออฟฟิศ");
    return;
  }
  var status = String(target.v[JC.STATUS - 1]);
  if (status === ST.CONFIRMED || status === ST.IMPORTED || status === ST.CANCELLED) {
    lineReply_(ev.replyToken, "งาน [" + jobId + "] ถูกตรวจ/ปิดงานไปแล้ว แก้ไขไม่ได้ กรุณาติดต่อออฟฟิศครับ");
    return;
  }

  var blob = lineGetContent_(ev.message.id);
  var stamp = Utilities.formatDate(new Date(), TZ, "yyyyMMdd-HHmmss");
  blob.setName(stamp + "_" + code + "_" + ev.message.id + ".jpg");
  // รู้อยู่แล้วว่าเป็นใบไหน — เก็บเข้าโฟลเดอร์ของใบนั้นได้เลย
  var imgUrl = imageFolder_(leg === "ต้นทาง" ? "รูปตั๋วต้นทาง" : "รูปตั๋วปลายทาง").createFile(blob).getUrl();

  var ocrText = "";
  try {
    ocrText = ocrImage_(blob);
  } catch (err) {
    log_("ERROR", "OCR (ส่งใหม่) ไม่สำเร็จ: " + err);
  }
  var parsed = parseTicket_(ocrText);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var jobs = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.JOBS);
    var isOrigin = leg === "ต้นทาง";
    // รูปใหม่แทนที่รูปเดิมเสมอ · เลข/น้ำหนักทับเฉพาะเมื่ออ่านค่าใหม่ได้ (อ่านไม่ได้ = คงของเดิมให้ออฟฟิศตรวจ)
    jobs.getRange(target.row, isOrigin ? JC.IMG_ORIGIN : JC.IMG_DEST).setValue(imgUrl);
    if (parsed.ticketNo) jobs.getRange(target.row, isOrigin ? JC.TICKET_NO_O : JC.TICKET_NO_D).setValue(parsed.ticketNo);
    if (parsed.netTons) jobs.getRange(target.row, isOrigin ? JC.W_ORIGIN : JC.W_DEST).setValue(parsed.netTons);
    jobs.getRange(target.row, JC.STATUS).setValue(isOrigin && String(target.v[JC.IMG_DEST - 1]).trim() === "" ? ST.LOADED : (isOrigin ? status : ST.DELIVERED));

    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.TICKETS).appendRow([
      Utilities.formatDate(new Date(), TZ, "dd/MM/yyyy HH:mm:ss"),
      code, jobId, leg + " (ส่งใหม่)", ev.message.id, imgUrl,
      ocrText.slice(0, 5000), JSON.stringify(parsed),
    ]);

    var summary = ["🔄 แทนที่ตั๋ว" + leg + "แล้ว [" + jobId + "]"];
    if (parsed.ticketNo) summary.push("เลขที่ตั๋ว: " + parsed.ticketNo);
    if (parsed.netTons) summary.push("นน." + leg + ": " + parsed.netTons + " ตัน");
    if (!parsed.ticketNo && !parsed.netTons) summary.push("(ยังอ่านตัวเลขไม่ได้ ออฟฟิศจะอ่านจากรูปแทน)");
    lineReply_(ev.replyToken, summary.join("\n"), ticketQuickReply_(jobId, leg, leg === "ต้นทาง"));
  } finally {
    lock.releaseLock();
  }
}

/**
 * รูปสินค้าขึ้นรถ (ถ่ายหลังขึ้นของเสร็จ ก่อนตั๋วปลายทาง) — เก็บเข้าโฟลเดอร์ «รูปสินค้าขึ้นรถ»
 * แล้วต่อท้ายในคอลัมน์รูปสินค้าขึ้นรถของแถวงาน ส่งได้หลายรูป ออฟฟิศใช้ส่งต่อให้ลูกค้า
 */
function handlePodImage_(ev, code, jobId) {
  var blob = lineGetContent_(ev.message.id);
  var stamp = Utilities.formatDate(new Date(), TZ, "yyyyMMdd-HHmmss");
  blob.setName(stamp + "_" + code + "_" + ev.message.id + ".jpg");
  var imgUrl = imageFolder_("รูปสินค้าขึ้นรถ").createFile(blob).getUrl();

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // หาแถวงาน: ใช้รหัสงานจากปุ่มถ้ามี ไม่มีก็ใช้งานวันนี้ที่ «รับของแล้ว» แถวแรก
    // (ยังไม่ได้ตั๋วปลายทาง = สินค้าเพิ่งขึ้นรถ ตรงกับจังหวะถ่ายรูปนี้พอดี)
    var target = jobId ? findRowByJobId_(code, jobId) : null;
    if (!target) {
      var today = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");
      target = jobsOnDateOf_(code, today, ST.LOADED)[0] || jobsOnDateOf_(code, today, ST.DELIVERED)[0] || null;
      if (target) jobId = String(target.v[JC.ID - 1]);
    }

    if (target) {
      var jobs = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.JOBS);
      var cell = jobs.getRange(target.row, JC.POD_IMG);
      var existing = String(cell.getValue()).trim();
      cell.setValue(existing ? existing + "\n" + imgUrl : imgUrl);
    }

    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.TICKETS).appendRow([
      Utilities.formatDate(new Date(), TZ, "dd/MM/yyyy HH:mm:ss"),
      code, jobId || "(จับคู่ไม่ได้)", "รูปสินค้าขึ้นรถ", ev.message.id, imgUrl, "", "",
    ]);

    lineReply_(ev.replyToken,
      "📷✅ บันทึกรูปสินค้าขึ้นรถแล้ว" + (jobId ? " [" + jobId + "]" : "") +
      "\nออฟฟิศจะส่งให้ลูกค้าต่อไป — เดินทางปลอดภัยครับ 🙏\nเมื่อลงของเสร็จ ถ่ายรูปตั๋วปลายทางส่งมาได้เลย",
      [{
        type: "action",
        action: { type: "postback", label: "📷 ส่งรูปสินค้าเพิ่ม", data: "pod|" + (jobId || ""), displayText: "ขอส่งรูปสินค้าเพิ่ม" },
      }]);
  } finally {
    lock.releaseLock();
  }
}

/** หาแถวงานจากรหัสงาน — ต้องเป็นงานของคนขับคนนั้นเท่านั้น */
function findRowByJobId_(code, jobId) {
  var jobs = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.JOBS);
  if (!jobs || jobs.getLastRow() < 2 || !jobId) return null;
  var data = jobs.getRange(2, 1, jobs.getLastRow() - 1, JOBS_HEADER.length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][JC.ID - 1]).trim() !== jobId) continue;
    if (String(data[i][JC.DRIVER - 1]).trim().toUpperCase() !== code) return null;
    return { row: i + 2, v: data[i] };
  }
  return null;
}

/**
 * OCR ด้วย Google Drive: อัปโหลดภาพเป็น Google Doc พร้อมสั่งแปลงข้อความ (ภาษาไทย)
 * ต้องเปิด Advanced Drive Service (v2) ในหน้า Apps Script ก่อน — ดู README
 */
function ocrImage_(blob) {
  // ห้ามระบุ mimeType เป็น Google Doc เอง — ใส่ธง ocr แล้ว Google จะแปลงรูปเป็นเอกสารให้
  // (ถ้าระบุเอง API จะปฏิเสธ: "OCR is not supported for files of type google-apps.document")
  var resource = { title: "ocr_tmp_" + Date.now() };
  var docFile = Drive.Files.insert(resource, blob, { ocr: true, ocrLanguage: "th" });
  try {
    var text = DocumentApp.openById(docFile.id).getBody().getText();
    return text || "";
  } finally {
    // ไฟล์ชั่วคราวของ OCR — ลบทิ้งเสมอ
    Drive.Files.trash(docFile.id);
  }
}

/**
 * ดึงค่าจากข้อความ OCR แบบ "พยายามเต็มที่ แต่ไม่เดามั่ว"
 * อ่านไม่ได้ = ปล่อยว่างให้คนตรวจ ดีกว่ากรอกเลขผิดลงระบบ
 *
 * สิ่งที่ต้องการจากตั๋ว: เลขที่ตั๋ว + น้ำหนักสุทธิ (แปลงเป็น "ตัน" เสมอ)
 * ส่วนเป็นตั๋วต้นทางหรือปลายทาง ระบบดูจากลำดับการส่งของงานนั้น ไม่ได้ดูจากตั๋ว
 */
function parseTicket_(text) {
  var out = { ticketNo: "", netTons: "", date: "" };
  if (!text) return out;
  // ปรับข้อความ OCR ให้เทียบง่าย: แก้สระ ำ ที่ OCR ชอบแยกร่าง + ตัดอักขระล่องหน
  var t = text.replace(/[，،]/g, ",").replace(/นํ้า|นำ้/g, "น้ำ").replace(/​/g, "");

  // ── เลขที่ตั๋ว — ไล่จากคำเฉพาะเจาะจงของตั๋วแต่ละเจ้า ไปหาคำกว้างทีหลัง ──
  // อ้างอิงตั๋วจริง: ทัศนา/บุญศิลารัตน์ (เลขที่ใบชั่ง) · ใบชั่งโรงงาน (เลขที่ใบส่งของ)
  // TNC (เอกสารหมายเลข) · Rayong Fertilizer (Doc.No) · BGC (เลขที่ :)
  var noPatterns = [
    /เลขที่\s*ใบชั่ง\s*[:：]?\s*([A-Za-z0-9\/\-]{4,25})/,        // ทัศนา/บุญศิลารัตน์/แพรคติคัม
    /เลขที่\s*ใบส่งของ\s*[:：]?\s*([A-Za-z0-9\/\-]{4,25})/,      // ใบชั่งโรงงาน/Chememan
    /เอกสาร\s*หมายเลข\s*[:：]?\s*([A-Za-z0-9\/\-]{4,25})/,       // TNC FLO.007
    /document\s*no\.?\s*[:：#]?\s*([A-Za-z0-9\-]{4,25})/i,       // TNC Sales Shipment (SH26-1332)
    /invoice\s*no\.?\s*[:：.…]*\s*([A-Za-z0-9\-]{4,25})/i,       // TPP/TPI (TPR658105)
    /doc\.?\s*no\.?\s*[:：#]?\s*([A-Za-z0-9\/\-]{4,25})/i,       // Rayong Fertilizer
    /เลขที่\s*(?:ตั๋ว|บิล|เอกสาร)?\s*[:：#]?\s*([A-Za-z0-9\/\-]{4,25})/, // BGC/PMC/SD-SB
    /ticket\s*no\.?\s*[:：#]?\s*([A-Za-z0-9\/\-]{4,25})/i,
    /\b([OI]\d{9,12})\b/,                                        // Ratchaburi/BGC เลขใบชั่งขึ้นต้น O ไม่มีคำนำหน้า
  ];
  for (var i = 0; i < noPatterns.length; i++) {
    var m = t.match(noPatterns[i]);
    if (m) { out.ticketNo = m[1]; break; }
  }

  // วันที่บนตั๋ว (ไว้ให้ออฟฟิศเทียบ ไม่ได้ใช้อัตโนมัติ)
  var dm = t.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
  if (dm) out.date = dm[1];

  // ── น้ำหนักสุทธิ → "ตัน" ทศนิยม 3 หลักเสมอ ──
  // NUM ต้องไม่ตามด้วย / หรือ - กันจับเลขวันที่/ทะเบียนโดยพลาด
  var NUM = "([\\d,]+(?:\\.\\d+)?)(?![\\/\\-])";
  var wPatterns = [
    // "จำนวนตัน 13.80" (ทัศนา/บุญศิลารัตน์) — หน่วยตันแน่นอน
    { re: new RegExp("จำนวน\\s*ตัน\\s*[:：]?\\s*" + NUM), unit: "ตัน" },
    // "น้ำหนักชั่งสุทธิ (ตัน) 31.660" / "น้ำหนักสินค้าสุทธิ (ตัน)"
    { re: new RegExp("(?:รวม\\s*)?น้ำหนัก\\s*(?:ชั่ง|สินค้า)?\\s*สุทธิ\\s*\\(\\s*ตัน\\s*\\)\\s*[:：=]?\\s*" + NUM), unit: "ตัน" },
    // "รวมน้ำหนักสุทธิ 30,350.00 กก." / "น้ำหนักสุทธิ = 30,350.00" (BGC)
    { re: new RegExp("(?:รวม\\s*)?น้ำหนัก\\s*(?:ชั่ง|สินค้า)?\\s*สุทธิ\\s*(?:\\(\\s*(?:กก|kg)\\.?\\s*\\))?\\s*[:：=]?\\s*" + NUM), unit: "" },
    { re: new RegExp("นน\\.?\\s*สุทธิ\\s*[:：=]?\\s*" + NUM), unit: "" },
    // ตารางแนวนอนแบบ Rayong: หัวคอลัมน์ Car/Gross/Net weight แล้วค่าตามมา 3 ตัว — เอาตัวที่ 3
    { re: new RegExp("car\\s*weight[\\s\\S]{0,120}?net\\s*weight[^\\d]{0,60}[\\d,]+(?:\\.\\d+)?[^\\d]+[\\d,]+(?:\\.\\d+)?[^\\d]+" + NUM, "i"), unit: "" },
    // "Net weight (kg.) 28,990" / "Net.Weight 30270 กก." (TPI Polene)
    { re: new RegExp("net\\s*\\.?\\s*(?:weight|wt)?\\.?\\s*(?:\\(\\s*kg\\.?\\s*\\))?\\s*[:：=]?\\s*" + NUM, "i"), unit: "" },
    // "จำนวน 20 ตัน" (TNC FLO.007)
    { re: new RegExp("จำนวน\\s*" + NUM + "\\s*ตัน"), unit: "ตัน" },
    // "20,000 KGS" (TNC Sales Shipment)
    { re: new RegExp(NUM + "\\s*kgs\\b", "i"), unit: "กก" },
    // ตาข่ายสุดท้าย: "สุทธิ <เลข>"
    { re: new RegExp("สุทธิ\\s*[=:：]?\\s*" + NUM), unit: "" },
  ];
  for (var j = 0; j < wPatterns.length; j++) {
    var mm = t.match(wPatterns[j].re);
    if (!mm) continue;
    var num = Number(mm[1].replace(/,/g, ""));
    if (!(num > 0)) continue;
    var tons;
    if (wPatterns[j].unit === "ตัน") tons = num;        // ตั๋วระบุหน่วยตันชัดเจน
    else if (wPatterns[j].unit === "กก") tons = num / 1000; // ตั๋วระบุหน่วยกิโลกรัมชัดเจน
    else if (num > 500) tons = num / 1000;              // เลขใหญ่ = กิโลกรัม แปลงเป็นตัน
    else tons = num;                                    // เลขเล็ก = ตันอยู่แล้ว
    out.netTons = Math.round(tons * 1000) / 1000;
    break;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// ตัวช่วยอ่านชีต
// ─────────────────────────────────────────────────────────────

/** รหัสคนขับ → {userId, name} จากแท็บคนขับ */
function driverLineIds_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.DRIVERS);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) {
    var code = String(r[DC.CODE - 1]).trim().toUpperCase();
    if (!code) return;
    out[code] = { name: String(r[DC.NAME - 1]).trim(), userId: String(r[DC.LINE_ID - 1]).trim() };
  });
  return out;
}

/** LINE userId → รหัสคนขับ */
function driverCodeOf_(userId) {
  var map = driverLineIds_();
  var codes = Object.keys(map);
  for (var i = 0; i < codes.length; i++) {
    if (map[codes[i]].userId === userId) return codes[i];
  }
  return null;
}

/**
 * งานของคนขับคนหนึ่ง ณ วันที่กำหนด (ymd = "yyyy-MM-dd") คืน [{row, v}]
 * statusFilter = null คือเอาทุกสถานะที่ยังไม่จบ (ไม่รวม ยกเลิก/นำเข้าแล้ว)
 */
function jobsOnDateOf_(code, ymd, statusFilter) {
  var jobs = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.JOBS);
  if (!jobs || jobs.getLastRow() < 2) return [];
  var data = jobs.getRange(2, 1, jobs.getLastRow() - 1, JOBS_HEADER.length).getValues();
  var out = [];
  data.forEach(function (v, i) {
    if (String(v[JC.DRIVER - 1]).trim().toUpperCase() !== code) return;
    if (dateStr_(v[JC.DATE - 1]) !== ymd) return;
    var st = String(v[JC.STATUS - 1]);
    if (statusFilter ? st !== statusFilter : (st === ST.CANCELLED || st === ST.IMPORTED)) return;
    out.push({ row: i + 2, v: v });
  });
  return out;
}

function fillIfEmpty_(sheet, row, col, value) {
  if (value === "" || value == null) return;
  var cell = sheet.getRange(row, col);
  if (String(cell.getValue()).trim() === "") cell.setValue(value);
}

// ─────────────────────────────────────────────────────────────
// LINE Messaging API
// ─────────────────────────────────────────────────────────────

function lineHeaders_() {
  var token = prop_("LINE_CHANNEL_ACCESS_TOKEN");
  if (!token) throw new Error("ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN ใน Script Properties");
  return { Authorization: "Bearer " + token };
}

/**
 * สร้างก้อนข้อความ — ถ้ามีปุ่ม ใช้ Flex Message:
 * ปุ่มใหญ่เต็มความกว้าง เรียงแนวตั้งใต้ข้อความ กดง่าย และอยู่ในแชทถาวร
 * (ต่างจาก quick reply ที่เป็นเม็ดเล็กและหายไปเมื่อมีข้อความใหม่)
 */
function textMessage_(text, quickItems) {
  if (!quickItems || !quickItems.length) return { type: "text", text: text.slice(0, 4900) };

  var buttons = quickItems.map(function (it) {
    return {
      type: "button",
      style: "primary",
      color: "#1e3a5f", // สีน้ำเงินเข้มตาม CI
      height: "md",
      margin: "sm",
      action: it.action,
    };
  });
  return {
    type: "flex",
    altText: text.slice(0, 300), // ข้อความที่โชว์ในแถบแจ้งเตือนมือถือ
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        // ตัวใหญ่ + หนา อ่านง่ายสำหรับคนขับ · lineSpacing เว้นบรรทัดให้โปร่งตา
        contents: [{ type: "text", text: text.slice(0, 4900), wrap: true, size: "lg", weight: "bold", lineSpacing: "6px" }],
      },
      footer: { type: "box", layout: "vertical", spacing: "sm", contents: buttons },
    },
  };
}

function linePush_(userId, text, quickItems) {
  var res = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
    method: "post",
    contentType: "application/json",
    headers: lineHeaders_(),
    payload: JSON.stringify({ to: userId, messages: [textMessage_(text, quickItems)] }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error("LINE push " + res.getResponseCode() + ": " + res.getContentText());
}

function lineReply_(replyToken, text, quickItems) {
  var res = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/reply", {
    method: "post",
    contentType: "application/json",
    headers: lineHeaders_(),
    payload: JSON.stringify({ replyToken: replyToken, messages: [textMessage_(text, quickItems)] }),
    muteHttpExceptions: true,
  });
  // replyToken หมดอายุ (ตอบช้าเกิน 1 นาที) — ไม่ throw เพราะงานหลักสำเร็จแล้ว
  if (res.getResponseCode() >= 300) log_("WARN", "LINE reply " + res.getResponseCode() + ": " + res.getContentText());
}

/** ปุ่มใต้ข้อความแจ้งงาน: รับทราบงาน + ส่งรูปเป่าแอลกอฮอล์ */
function jobQuickReply_(jobIds) {
  var items = [];
  if (jobIds && jobIds.length) {
    items.push({
      type: "action",
      action: {
        type: "postback",
        label: "✅ รับทราบงาน",
        data: "ack|" + jobIds.join(",").slice(0, 290),
        displayText: "รับทราบงาน",
      },
    });
  }
  if (photosEnabled_()) {
    items.push({
      type: "action",
      action: {
        type: "postback",
        label: "🍺 ส่งรูปเป่าแอลกอฮอล์",
        data: "alc",
        displayText: "ขอส่งรูปเป่าแอลกอฮอล์",
      },
    });
  }
  return items;
}

/**
 * ปุ่มใต้ข้อความยืนยันตั๋ว: ส่งรูปใบเดิมใหม่ (กรณีไม่ชัด)
 * และหลัง "ตั๋วต้นทาง" (ขึ้นของเสร็จ) เพิ่มปุ่มส่งรูปสินค้าขึ้นรถ — ออฟฟิศใช้ส่งให้ลูกค้า
 */
function ticketQuickReply_(jobId, leg, withPod) {
  var items = [{
    type: "action",
    action: {
      type: "postback",
      label: "🔄 รูปไม่ชัด ส่งใบนี้ใหม่",
      data: "redo|" + jobId + "|" + leg,
      displayText: "ขอส่งรูปตั๋ว" + leg + "ใหม่",
    },
  }];
  if (withPod) {
    items.push({
      type: "action",
      action: {
        type: "postback",
        label: "📷 ส่งรูปสินค้าขึ้นรถ",
        data: "pod|" + jobId,
        displayText: "ขอส่งรูปสินค้าขึ้นรถ",
      },
    });
  }
  return items;
}

/**
 * โฟลเดอร์ปลายทางของรูป — แยกตามประเภทแล้วแยกรายเดือน สร้างให้เองถ้ายังไม่มี
 * เช่น <โฟลเดอร์หลัก>/รูปตั๋ว/2026-07/
 */
function imageFolder_(kind) {
  // กันสองรูปมาพร้อมกันแล้วสร้างโฟลเดอร์ซ้ำ
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { /* ไม่ได้ล็อกก็สร้างได้ แค่เสี่ยงโฟลเดอร์ซ้ำเล็กน้อย */ }
  try {
    var main = DriveApp.getFolderById(prop_("DRIVE_FOLDER_ID"));
    var month = Utilities.formatDate(new Date(), TZ, "yyyy-MM");
    return childFolder_(childFolder_(main, kind), month);
  } finally {
    try { lock.releaseLock(); } catch (e) { /* ไม่ได้ถือล็อกอยู่ */ }
  }
}

function childFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** ดาวน์โหลดไฟล์แนบ (รูป) ของข้อความจาก LINE */
function lineGetContent_(messageId) {
  var res = UrlFetchApp.fetch("https://api-data.line.me/v2/bot/message/" + messageId + "/content", {
    headers: lineHeaders_(),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error("LINE content " + res.getResponseCode());
  return res.getBlob();
}

/** รายชื่อผู้ดูแล — ใส่ได้หลายคน คั่นด้วยจุลภาค เช่น "Uaaa...,Ubbb...,Uccc..." */
function adminIds_() {
  return prop_("ADMIN_USER_ID").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
}

function notifyAdmin_(text) {
  adminIds_().forEach(function (admin) {
    try {
      linePush_(admin, text);
    } catch (err) {
      log_("ERROR", "แจ้งผู้ดูแล " + admin.slice(0, 8) + "… ไม่สำเร็จ: " + err);
    }
  });
}

function testNotifyAdmin() {
  var admins = adminIds_();
  if (!admins.length) {
    SpreadsheetApp.getUi().alert("ยังไม่ได้ตั้ง ADMIN_USER_ID ใน Script Properties");
    return;
  }
  admins.forEach(function (admin) {
    linePush_(admin, "✅ ทดสอบจากระบบสั่งงานคนขับ — การเชื่อมต่อ LINE ใช้งานได้");
  });
  SpreadsheetApp.getUi().alert("ส่งข้อความทดสอบไปยังผู้ดูแล " + admins.length + " คนแล้ว — ตรวจดูในไลน์");
}

// ─────────────────────────────────────────────────────────────
// ตัวช่วยทั่วไป
// ─────────────────────────────────────────────────────────────

/** ตั้งรหัสงานอัตโนมัติเมื่อพนักงานกรอกวันที่ (simple trigger — ทำงานเองเมื่อมีการแก้ชีต) */
function onEdit(e) {
  try {
    var sh = e.range.getSheet();
    if (sh.getName() !== SHEET.JOBS) return;
    var row = e.range.getRow();
    if (row < 2) return;

    // ── กันแก้ไขแถวที่ «ปิดงาน» แล้ว — ดีดค่ากลับทันที ─────────────
    // (ข้อมูลจริงถูกดึงเข้าเว็บไปแล้ว ต้องไปแก้ในเว็บซึ่งมีระบบสิทธิ์คุมเท่านั้น)
    if (e.range.getNumRows() === 1 && e.range.getNumColumns() === 1) {
      var wasClosed = e.range.getColumn() === JC.STATUS
        ? String(e.oldValue || "") === ST.IMPORTED
        : String(sh.getRange(row, JC.STATUS).getValue()) === ST.IMPORTED;
      if (wasClosed) {
        if (e.oldValue !== undefined) e.range.setValue(e.oldValue);
        else e.range.clearContent();
        SpreadsheetApp.getActiveSpreadsheet().toast(
          "แถวนี้ «ปิดงาน» แล้ว แก้ไขในชีตไม่ได้ — ต้องแก้ในเว็บ (หน้า บันทึกงานขนส่ง) เท่านั้น",
          "🔒 ป้องกันข้อมูล", 6);
        return;
      }
    }

    // ── เติมรหัสงาน + สถานะเริ่มต้น (รองรับการวางหลายแถวพร้อมกัน) ──
    // สำคัญ: ถ้าออฟฟิศ "ก๊อปแถวเดิมมาวาง" รหัสงานจะติดมาด้วย กลายเป็นรหัสซ้ำ
    // เว็บรับรหัสละ 1 ขา แถวที่เกินจึงเข้าเว็บไม่ได้และหายจากใบวางบิล
    // จึงต้องตรวจรหัสซ้ำแล้วตั้งรหัสใหม่ให้ตรงนี้ ก่อนที่ข้อมูลจะไหลต่อ
    var renamed = [];
    for (var r = row; r < row + e.range.getNumRows(); r++) {
      if (r < 2) continue;
      var dateVal = sh.getRange(r, JC.DATE).getValue();
      if (!dateVal) continue;
      var idCell = sh.getRange(r, JC.ID);
      var curId = String(idCell.getValue()).trim();
      if (!curId) {
        idCell.setValue(nextJobId_(sh, dateVal));
      } else if (jobIdRowCount_(sh, curId) > 1) {
        var fresh = nextJobId_(sh, dateVal);
        idCell.setValue(fresh);
        renamed.push(curId + " → " + fresh);
      }
      if (!sh.getRange(r, JC.STATUS).getValue()) sh.getRange(r, JC.STATUS).setValue(ST.NEW);
    }
    if (renamed.length) {
      SpreadsheetApp.getActiveSpreadsheet().toast(
        "แถวที่วางมามีรหัสงานซ้ำกับแถวเดิม ระบบตั้งรหัสใหม่ให้แล้ว:\n" + renamed.join("\n"),
        "🔢 ตั้งรหัสงานใหม่", 8);
    }
    // ── กันกรอกซ้ำตั้งแต่ตอนวาง ──
    // ก๊อปแถวเดิมมาวางแล้วลืมแก้ = งานซ้ำที่ข้อมูลเหมือนกันหมด รหัสใหม่ไม่ช่วยอะไร
    // ขึ้นเตือนทันทีในคอลัมน์ «ผลนำเข้าเว็บ» ให้คนรู้ตัวตอนนี้ ไม่ใช่ไปรู้ตอนวางบิล
    if (e.range.getNumRows() > 1 || e.range.getNumColumns() > 1) {
      var sameRows = [];
      for (var r2 = row; r2 < row + e.range.getNumRows(); r2++) {
        if (r2 < 2) continue;
        var twin = sameJobRow_(sh, r2);
        if (twin) {
          sh.getRange(r2, JC.IMPORT_RESULT).setValue("ℹ️ ข้อมูลเหมือนแถว " + twin + " (วันที่/คนขับ/รถ/ลูกค้า/เส้นทาง) — ถ้าวิ่งจริงอีกเที่ยว ปล่อยไว้ได้เลย · ถ้าวางซ้ำโดยไม่ตั้งใจ ให้ลบแถวนี้");
          sameRows.push(r2 + " = " + twin);
        }
      }
      if (sameRows.length) {
        SpreadsheetApp.getActiveSpreadsheet().toast(
          "แถวที่วางมามีข้อมูลเหมือนแถวเดิม:\n" + sameRows.join("\n") + "\nวิ่งจริงอีกเที่ยว = ปล่อยไว้ · วางซ้ำโดยไม่ตั้งใจ = ลบแถวนั้น",
          "ℹ️ ข้อมูลเหมือนแถวเดิม", 10);
      }
    }
    // เติมชื่อคนขับ + ทะเบียนรถประจำตัวเขา จากรหัสที่เลือก
    if (e.range.getColumn() === JC.DRIVER) {
      var code = String(e.range.getValue()).trim().toUpperCase();
      var d = code ? driverLineIds_()[code] : null;
      sh.getRange(row, JC.DRIVER_NAME).setValue(d ? d.name : "");

      // รถประจำจากแท็บฐานข้อมูล (เว็บส่งมาจากหน้า จับคู่รถ+พขร.)
      // เติมเฉพาะช่องที่ยังว่าง — วันไหนสลับรถ ออฟฟิศเลือกทะเบียนเองทับได้
      var pair = code ? vehicleOfDriver_(code) : null;
      if (pair) {
        fillIfEmpty_(sh, row, JC.HEAD, pair.head);
        fillIfEmpty_(sh, row, JC.TRAILER, pair.trailer);
      }
    }
  } catch (err) {
    // simple trigger ห้าม throw — แค่ไม่เติมค่าอัตโนมัติ พนักงานกรอกเองได้
  }
}

/** รถประจำของคนขับ จากแท็บฐานข้อมูล คอลัมน์ F-H — คืน {head, trailer} หรือ null */
function vehicleOfDriver_(code) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.MASTER);
  if (!sh || sh.getLastRow() < 2) return null;
  var rows = sh.getRange(2, 6, sh.getLastRow() - 1, 3).getValues(); // F:H
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toUpperCase() === code) {
      return { head: String(rows[i][1]).trim(), trailer: String(rows[i][2]).trim() };
    }
  }
  return null;
}

/** มีกี่แถวในชีตที่ใช้รหัสงานนี้ — ใช้ตรวจรหัสซ้ำตอนก๊อปแถวมาวาง */
/**
 * หาแถวอื่นที่ข้อมูลงานเหมือนแถวนี้ทุกช่อง (วันที่ คนขับ รถ หาง ลูกค้า ต้นทาง ปลายทาง)
 * คืนเลขแถวที่เจอแถวแรก หรือ null — ใช้เตือนตอนวางแถวซ้ำ
 */
function sameJobRow_(sheet, rowNo) {
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var cols = [JC.DATE, JC.DRIVER, JC.HEAD, JC.TRAILER, JC.CUSTOMER, JC.ORIGIN, JC.DEST];
  var me = sheet.getRange(rowNo, 1, 1, JC.DEST).getValues()[0];
  var key = cols.map(function (c) { return c === JC.DATE ? dateStr_(me[c - 1]) : String(me[c - 1]).trim(); }).join("|");
  if (!String(me[JC.DATE - 1]).trim() || !String(me[JC.HEAD - 1]).trim()) return null;
  var all = sheet.getRange(2, 1, last - 1, JC.DEST).getValues();
  for (var i = 0; i < all.length; i++) {
    var r = i + 2;
    if (r === rowNo) continue;
    var k = cols.map(function (c) { return c === JC.DATE ? dateStr_(all[i][c - 1]) : String(all[i][c - 1]).trim(); }).join("|");
    if (k === key) return r;
  }
  return null;
}

function jobIdRowCount_(sheet, jobId) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var n = 0;
  sheet.getRange(2, JC.ID, last - 1, 1).getValues().forEach(function (r) {
    if (String(r[0]).trim() === jobId) n++;
  });
  return n;
}

/** รหัสงานรูปแบบ TTยymmdd-ลำดับ เช่น TT260728-03 */
function nextJobId_(sheet, dateVal) {
  var d = dateVal instanceof Date ? dateVal : new Date();
  var prefix = "TT" + Utilities.formatDate(d, TZ, "yyMMdd") + "-";
  var last = sheet.getLastRow();
  var max = 0;
  if (last > 1) {
    sheet.getRange(2, JC.ID, last - 1, 1).getValues().forEach(function (r) {
      var s = String(r[0]);
      if (s.indexOf(prefix) === 0) {
        var n = Number(s.slice(prefix.length));
        if (n > max) max = n;
      }
    });
  }
  var next = String(max + 1);
  return prefix + (next.length < 2 ? "0" + next : next);
}

/** แปลงค่าวันที่ในเซลล์ (Date หรือข้อความ) เป็น "yyyy-MM-dd" เพื่อเทียบวัน */
function dateStr_(v) {
  if (v instanceof Date) {
    var yy = Number(Utilities.formatDate(v, TZ, "yyyy"));
    // พนักงานพิมพ์ปี พ.ศ. (เช่น 29/07/2569) Sheets จะเก็บเป็นปีค.ศ. 2569 จริงๆ — แปลงกลับให้
    if (yy > 2400) yy -= 543;
    return yy + "-" + Utilities.formatDate(v, TZ, "MM-dd");
  }
  var s = String(v || "").trim();
  var m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) {
    var y = Number(m[3]);
    if (y > 2400) y -= 543; // ปี พ.ศ.
    return y + "-" + pad2_(m[2]) + "-" + pad2_(m[1]);
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  return "";
}

function pad2_(n) {
  n = String(Number(n));
  return n.length < 2 ? "0" + n : n;
}

var TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** "2026-07-29" → "29 ก.ค. 2569" */
function thaiDateOfYmd_(ymd) {
  var m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(ymd);
  return Number(m[3]) + " " + TH_MONTHS[Number(m[2]) - 1] + " " + (Number(m[1]) + 543);
}

/**
 * ลบทริกเกอร์แบบเจาะเวลา (one-shot) ที่ armMorningSend สร้างไว้ เฉพาะนัดที่ "ผ่านเวลาไปแล้ว"
 * นัดที่ยังมาไม่ถึง (เช่น ตอน 17:00 นัดของ 18:00) จะถูกเก็บไว้ตามเดิม
 */
function cleanupOneShotTriggers_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty("ONESHOT_TRIGGERS") || "";
  props.deleteProperty("ONESHOT_TRIGGER_ID"); // ค่าเก่าจากเวอร์ชันก่อน — เลิกใช้แล้ว
  if (!raw) return;

  var entries; // [{id: "...", at: epochMs}]
  try {
    entries = JSON.parse(raw);
  } catch (e) {
    entries = [];
  }
  var now = Date.now();
  var passedIds = {};
  var remain = [];
  entries.forEach(function (en) {
    if (en.at <= now + 60000) passedIds[en.id] = true;
    else remain.push(en);
  });

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (passedIds[t.getUniqueId()]) ScriptApp.deleteTrigger(t);
  });

  if (remain.length) props.setProperty("ONESHOT_TRIGGERS", JSON.stringify(remain));
  else props.deleteProperty("ONESHOT_TRIGGERS");
}

// ═════════════════════════════════════════════════════════════
// ตั๋วเรือ — อ่านรูปตั๋วจากโฟลเดอร์ Drive แล้วส่งข้อความให้เว็บตรวจ (ทุกเส้นทาง)
// ═════════════════════════════════════════════════════════════
//
// โฟลเดอร์ใน Google Drive ของเจ้าของ:
//   ตั๋วเรือ /
//     ท่าเรือศรีราชาฮาร์เบอร์ - โกดัง ท่าเรือศรีราชาฮาร์เบอร์ /   ← โฟลเดอร์เส้นทาง «ต้นทาง - ปลายทาง»
//       70-1853 /  รูป1.jpg  รูป2.jpg …                       ← ชื่อโฟลเดอร์ย่อย = ทะเบียนรถ (ต้องตรงกับในเว็บ)
//       70-1931 /  …
//     <เส้นทางใหม่> /  <ทะเบียน> / …                          ← เพิ่มเส้นทางใหม่ได้เลย ไม่ต้องแก้โค้ด
// ลูกค้า/แบบตั๋วของแต่ละเส้นทาง ตั้งในเว็บ (ตั้งค่า › ตั๋วเรือ) · 1 รูปมีตั๋วได้หลายใบ — เว็บเป็นคนแยกใบ
//
// ทุก 5 นาที อ่านเฉพาะรูปใหม่ (ดูจาก fileId ในคอลัมน์ C) ด้วย OCR ของ Google แล้วต่อแถวลงแท็บ «ตั๋วเรือ»
// คอลัมน์ต้องตรงกับ src/lib/ship-ticket.ts (COL): เวลา · ทะเบียน · fileId · ชื่อไฟล์ · ลิงก์รูป · ข้อความ OCR · เส้นทาง
// ที่นี่ไม่ตัดสินอะไร — คนตรวจและกดยืนยันที่หน้า «ตั๋วเรือรอตรวจ» ในเว็บ

var SHIP_ROOT_NAME = "ตั๋วเรือ";
var SHIP_HEADER = ["เวลา", "ทะเบียน (ชื่อโฟลเดอร์)", "fileId", "ชื่อไฟล์", "ลิงก์รูป", "ข้อความ OCR", "เส้นทาง (ชื่อโฟลเดอร์)"];
/**
 * อ่านต่อเนื่องได้รอบละกี่วินาที — Apps Script ให้รันได้ครั้งละไม่เกิน 6 นาที จึงหยุดที่ 4.5 นาที
 * (ตัวตั้งเวลาเรียกทุก 5 นาที รูปค้างเยอะก็อ่านต่อเนื่องเกือบตลอด)
 * ถ้า Google ตอบ "User rate limit exceeded for OCR" จะหยุดรอบนั้นทันที แล้วอ่านต่อรอบหน้า
 */
var SHIP_MAX_SECONDS = 270;

/**
 * หาโฟลเดอร์แม่ «ตั๋วเรือ»: ใช้ SHIP_ROOT_ID ถ้าตั้งไว้
 * ไม่งั้น ถ้าเคยตั้งค่าแบบเดิม (SHIP_FOLDER_ID = โฟลเดอร์เส้นทางเดียว) ใช้โฟลเดอร์แม่ของมัน — ไม่ต้องกดตั้งค่าใหม่
 * ไม่งั้นหาจากชื่อ (ต้องมีชื่อนี้โฟลเดอร์เดียว)
 */
function shipRoot_() {
  var id = prop_("SHIP_ROOT_ID");
  if (id) return DriveApp.getFolderById(id);
  var old = prop_("SHIP_FOLDER_ID");
  if (old) {
    var parents = DriveApp.getFolderById(old).getParents();
    var parent = parents.hasNext() ? parents.next() : null;
    if (parent && parent.getName().trim() === SHIP_ROOT_NAME) {
      PropertiesService.getScriptProperties().setProperty("SHIP_ROOT_ID", parent.getId());
      return parent;
    }
  }
  var it = DriveApp.getFoldersByName(SHIP_ROOT_NAME);
  if (!it.hasNext()) throw new Error("ไม่พบโฟลเดอร์ «" + SHIP_ROOT_NAME + "» ใน Google Drive — สร้างก่อน แล้วกดตั้งค่าใหม่");
  var folder = it.next();
  if (it.hasNext()) throw new Error("มีโฟลเดอร์ชื่อ «" + SHIP_ROOT_NAME + "» มากกว่า 1 อัน — ลบ/เปลี่ยนชื่ออันที่ไม่ใช้ หรือใส่ SHIP_ROOT_ID ใน Script Properties");
  return folder;
}

/** แท็บ «ตั๋วเรือ» — แท็บเดิมที่ยังไม่มีหัวคอลัมน์ใหม่ (เส้นทาง) เติมหัวให้ */
function shipSheet_(ss) {
  var sh = ss.getSheetByName(SHEET.SHIP);
  if (!sh) return ensureSheet_(ss, SHEET.SHIP, SHIP_HEADER);
  if (sh.getRange(1, SHIP_HEADER.length).getValue() !== SHIP_HEADER[SHIP_HEADER.length - 1]) ensureSheet_(ss, SHEET.SHIP, SHIP_HEADER);
  return sh;
}

/** ตั้งค่าครั้งแรก: สร้างแท็บ «ตั๋วเรือ» + จำโฟลเดอร์ + ตั้งเวลาอ่านทุก 5 นาที */
function setupShipTickets() {
  var ui = SpreadsheetApp.getUi();
  try {
    var folder = shipRoot_();
    PropertiesService.getScriptProperties().setProperty("SHIP_ROOT_ID", folder.getId());
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ensureSheet_(ss, SHEET.SHIP, SHIP_HEADER);
    sh.setColumnWidth(6, 400);
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === "scanShipTickets") ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger("scanShipTickets").timeBased().everyMinutes(5).create();
    ui.alert("ตั้งค่าอ่านตั๋วเรือเรียบร้อย ✅\n\nโฟลเดอร์: " + folder.getName() +
      "\nระบบจะอ่านรูปใหม่ทุก 5 นาที แล้วขึ้นที่เว็บหน้า บันทึกประจำวัน › ตั๋วเรือรอตรวจ" +
      "\n\nเก็บรูปใน ตั๋วเรือ / <ต้นทาง - ปลายทาง> / <ทะเบียนรถ> เช่น 70-1853" +
      "\nเส้นทางใหม่: สร้างโฟลเดอร์ใหม่ได้เลย แล้วเลือกลูกค้าที่เว็บ ตั้งค่า › ตั๋วเรือ");
  } catch (err) {
    ui.alert("ตั้งค่าไม่สำเร็จ ❌\n\n" + err.message);
  }
}

/** อ่านรูปตั๋วเรือใหม่ (ตัวตั้งเวลาเรียกทุก 5 นาที · กดจากเมนูได้) — กดซ้ำได้ ไม่เกิดแถวซ้ำ */
function scanShipTickets() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return; // รอบก่อนยังอ่านไม่เสร็จ
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = shipSheet_(ss);
    var last = sh.getLastRow();
    var done = {};
    if (last >= 2) {
      sh.getRange(2, 3, last - 1, 1).getValues().forEach(function (r) {
        if (r[0]) done[String(r[0])] = true;
      });
    }

    var root = shipRoot_();
    var count = 0;
    var started = Date.now();
    var timeUp = function () { return (Date.now() - started) / 1000 > SHIP_MAX_SECONDS; };
    var limited = false;
    // ตั๋วเรือ / <เส้นทาง> / <ทะเบียน> / รูป
    var routes = root.getFolders();
    while (routes.hasNext() && !timeUp() && !limited) {
      var routeFolder = routes.next();
      var route = routeFolder.getName().trim();
      var subs = routeFolder.getFolders();
      while (subs.hasNext() && !timeUp() && !limited) {
        var sub = subs.next();
        var plate = sub.getName().trim();
        var files = sub.getFiles();
        while (files.hasNext() && !timeUp() && !limited) {
          var f = files.next();
          if (done[f.getId()]) continue;
          var mime = f.getMimeType();
          if (mime.indexOf("image/") !== 0 && mime !== "application/pdf") continue;
          var text = "";
          try {
            text = ocrImage_(f.getBlob());
          } catch (err) {
            // อ่านไม่ได้ก็ยังต้องส่งแถวไป — เว็บจะขึ้นแถวตัวแดงพร้อมลิงก์รูปให้คนกรอกเอง ไม่ให้รูปหายเงียบ
            log_("ERROR", "OCR ตั๋วเรือไม่สำเร็จ " + route + "/" + plate + "/" + f.getName() + ": " + err);
            if (String(err).indexOf("rate limit") >= 0) { limited = true; break; } // โดนจำกัดความถี่ — ไว้รอบหน้า
          }
          sh.appendRow([
            Utilities.formatDate(new Date(), TZ, "dd/MM/yyyy HH:mm:ss"),
            plate, f.getId(), f.getName(), f.getUrl(), text.slice(0, 45000), route,
          ]);
          done[f.getId()] = true;
          count++;
          Utilities.sleep(1000);
        }
      }
    }
    if (count > 0) log_("INFO", "อ่านรูปตั๋วเรือใหม่ " + count + " รูป");
  } catch (err) {
    log_("ERROR", "อ่านตั๋วเรือไม่สำเร็จ: " + err);
  } finally {
    lock.releaseLock();
  }
}

function ensureSheet_(ss, name, header) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var range = sh.getRange(1, 1, 1, header.length);
  range.setValues([header]);
  range.setFontWeight("bold").setBackground("#1e3a5f").setFontColor("#ffffff");
  sh.setFrozenRows(1);
  return sh;
}

function setListValidation_(sheet, col, maxRow, rangeRef) {
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(rangeRef, true)
    .setAllowInvalid(true) // เผื่อกรณีข้อมูลใหม่ยังไม่อยู่ในฐาน — แค่เตือน ไม่บล็อก
    .build();
  sheet.getRange(2, col, maxRow, 1).setDataValidation(rule);
}

function rangeRef_(sheetName, a1) {
  return SpreadsheetApp.getActiveSpreadsheet().getRange("'" + sheetName + "'!" + a1);
}

function log_(level, msg) {
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.LOG);
    if (!sh) return;
    sh.appendRow([Utilities.formatDate(new Date(), TZ, "dd/MM/yyyy HH:mm:ss"), level, String(msg).slice(0, 1000)]);
    // เก็บ log ไม่เกิน 2,000 แถว — เกินแล้วตัดหัวทิ้ง กันชีตบวม
    var last = sh.getLastRow();
    if (last > 2100) sh.deleteRows(2, last - 2000);
  } catch (e) {
    // เขียน log ไม่ได้ ไม่ต้องทำอะไรต่อ
  }
}

// ═════════════════════════════════════════════════════════════
// ใบสั่งงานร้านค้า (PO) — ซ่อมบำรุง/อะไหล่ ไม่เกี่ยวกับงานขนส่งของคนขับ
// ═════════════════════════════════════════════════════════════
//
// ทำไมต้องมี: ร้านจะทำงาน/จ่ายของ "เฉพาะใบที่มีเลข PO จากบริษัท" — กันพนักงานไปเอาของเอง
//
// ขั้นตอน (ทุกข้อความเป็นการ "ตอบกลับ" ไม่ใช่ส่งเอง → ไม่กินโควตาข้อความของไลน์)
//   1. พนักงานพิมพ์ #สั่ง ในไลน์บริษัท → บอทออกเลข PO ลงแท็บ «ใบสั่งงานร้าน»
//   2. แอดมินพิมพ์บอกร้านในแชท OA ว่ามีออเดอร์ใหม่
//   3. ร้านกดเมนู «📋 ออเดอร์ของร้าน» → บอทตอบเป็นการ์ด → ร้านกด รับออเดอร์ / มีของไม่ครบ / ไม่มีของ
//   4. ทำเสร็จ ร้านกดเมนู «🧾 แจ้งราคา / ปิดงาน» → บอทถามราคาทีละรายการ → ร้านยืนยัน → ส่งรูปบิลได้
//   5. เว็บดึงแท็บนี้ไปแสดง แอดมินตรวจแล้วกดลงบัญชี (ค่าใช้จ่ายรถ / รับเข้าคลัง) — เว็บเขียนผลกลับคอลัมน์ R
//
// บอทไม่ส่งข้อความหาใครเอง พนักงานดูสถานะด้วย «#สถานะ PO-…» หรือดูในเว็บ
//
// คอลัมน์ต้องตรงกับ src/lib/shop-orders.ts ฝั่งเว็บ (แก้ที่หนึ่งต้องแก้อีกที่หนึ่ง)

SHEET.PO = "ใบสั่งงานร้าน";
SHEET.SHOPS = "ร้านค้า";
SHEET.STAFF = "พนักงานสั่งของ";

// แท็บ «ใบสั่งงานร้าน» — 1 แถว = 1 รายการ (ใบหนึ่งมีหลายแถว ใช้เลข PO เดียวกัน)
var PC = {
  ID: 1, SEQ: 2, AT: 3, STAFF: 4, STAFF_NAME: 5, SHOP: 6, SHOP_NAME: 7,
  TARGET: 8,      // ทะเบียนรถ หรือ «คลัง»
  ITEM: 9, QTY: 10, UNIT: 11,
  STATUS: 12,     // สถานะทั้งใบ (เหมือนกันทุกแถวของใบ)
  ANSWER: 13,     // ร้านตอบรายการนี้: ทำได้ / ไม่มีของ
  PRICE: 14,      // ราคารวมของรายการนี้ที่ร้านแจ้ง (บาท)
  ANSWERED_AT: 15, PRICED_AT: 16,
  BILL: 17,       // ลิงก์รูปบิลที่ร้านส่ง (หลายรูปคั่นบรรทัด)
  RESULT: 18,     // ผลลงบัญชี — เว็บเขียนกลับ
  RAW: 19,        // ข้อความที่พนักงานพิมพ์ (แถวแรกของใบ)
};
var PO_HEADER = [
  "เลขใบสั่ง", "ลำดับ", "สั่งเมื่อ", "รหัสผู้สั่ง", "ชื่อผู้สั่ง", "รหัสร้าน", "ชื่อร้าน",
  "ลงที่ (ทะเบียน/คลัง)", "รายการ", "จำนวน", "หน่วย", "สถานะใบ", "ร้านตอบ", "ราคา (บาท)",
  "ร้านตอบเมื่อ", "แจ้งราคาเมื่อ", "รูปบิล", "ผลลงบัญชี (เว็บ)", "ข้อความที่สั่ง",
];
var POS = {
  WAIT: "รอร้านตอบ",
  ACCEPTED: "ร้านรับแล้ว",
  NONE: "ร้านไม่มีของ",
  PRICED: "แจ้งราคาแล้ว",
  POSTED: "ลงบัญชีแล้ว",   // เว็บเขียน
  CANCELLED: "ยกเลิก",
};
var ANS = { OK: "ทำได้", NO: "ไม่มีของ" };
var PO_STOCK = "คลัง";

// แท็บ «ร้านค้า» / «พนักงานสั่งของ» — แอดมินกรอกรหัส+ชื่อ แล้วให้รหัสไปพิมพ์ «ลงทะเบียน <รหัส>»
var PTC = { CODE: 1, NAME: 2, LINE_ID: 3, REGISTERED_AT: 4 };
var SHOPS_HEADER = ["รหัสร้าน", "ชื่อร้าน", "LINE User ID", "ลงทะเบียนเมื่อ"];
var STAFF_HEADER = ["รหัสพนักงาน", "ชื่อ-นามสกุล", "LINE User ID", "ลงทะเบียนเมื่อ"];

// ข้อความจากเมนูร้าน (rich menu) — ต้องตรงกับ SHOP_MENU ใน src/lib/line-richmenu.ts
var MENU_ORDERS = "📋 ออเดอร์ของร้าน";
var MENU_PRICE = "🧾 แจ้งราคา / ปิดงาน";
var MENU_CONTACT = "📞 ติดต่อบริษัท";
var SHOP_RICHMENU_NAME = "tiamthep-shop";

var PO_EXAMPLE =
  "ตัวอย่าง\n" +
  "#สั่ง ร้านตัวอย่างยางยนต์\n" +
  "รถ 70-1938\n" +
  "- เปลี่ยนยาง 11R22.5 2 เส้น\n" +
  "- สลับยาง 2 เส้น\n\n" +
  "สั่งเข้าคลัง: เปลี่ยนบรรทัด «รถ …» เป็น «เข้าคลัง»";

/** เมนู ④ — สร้างแท็บของระบบใบสั่งงานร้าน (กดซ้ำได้ ไม่ลบข้อมูลเดิม) */
function setupShopOrders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  poSheet_();
  ensureSheet_(ss, SHEET.SHOPS, SHOPS_HEADER);
  ensureSheet_(ss, SHEET.STAFF, STAFF_HEADER);
  SpreadsheetApp.getUi().alert(
    "สร้างแท็บ «ใบสั่งงานร้าน» «ร้านค้า» «พนักงานสั่งของ» เรียบร้อย\n\n" +
    "1. กรอกรหัส+ชื่อ ในแท็บ «ร้านค้า» (เช่น S01) และ «พนักงานสั่งของ» (เช่น M01)\n" +
    "2. ให้แต่ละคนพิมพ์ «ลงทะเบียน <รหัส>» ในไลน์บริษัท\n" +
    "3. ติดตั้งเมนูร้านในไลน์: เว็บ › ใบสั่งงานร้านค้า › ปุ่ม «ติดตั้งเมนูร้านในไลน์» (ครั้งเดียว)"
  );
}

function poSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET.PO);
  if (sh) return sh;
  sh = ensureSheet_(ss, SHEET.PO, PO_HEADER);
  sh.getRange(2, PC.PRICE, 5000, 1).setNumberFormat("#,##0.00");
  return sh;
}

// ── ทะเบียนร้าน / พนักงาน ───────────────────────────────────

/** แถวทั้งหมดของแท็บ ร้านค้า / พนักงานสั่งของ → [{row, code, name, userId}] */
function partyRows_(tab) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tab);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().map(function (r, i) {
    return {
      row: i + 2,
      code: String(r[PTC.CODE - 1]).trim().toUpperCase(),
      name: String(r[PTC.NAME - 1]).trim(),
      userId: String(r[PTC.LINE_ID - 1]).trim(),
    };
  }).filter(function (p) { return p.code; });
}

function partyOf_(tab, userId) {
  var rows = partyRows_(tab);
  for (var i = 0; i < rows.length; i++) if (rows[i].userId === userId) return rows[i];
  return null;
}

function partyByCode_(tab, code) {
  var rows = partyRows_(tab);
  for (var i = 0; i < rows.length; i++) if (rows[i].code === code) return rows[i];
  return null;
}

/**
 * «ลงทะเบียน <รหัส>» คำสั่งเดียวใช้ได้ทั้ง คนขับ / พนักงานสั่งของ / ร้านค้า — ไม่ต้องจำหลายคำสั่ง
 * รหัสเดียวอยู่หลายแท็บ = ไม่รู้ว่าเป็นใคร → ไม่เดา ให้ออฟฟิศแก้รหัส
 */
function handleRegister_(replyToken, userId, code) {
  var inDrivers = !!driverLineIds_()[code];
  var staff = partyByCode_(SHEET.STAFF, code);
  var shop = partyByCode_(SHEET.SHOPS, code);
  var hits = (inDrivers ? 1 : 0) + (staff ? 1 : 0) + (shop ? 1 : 0);
  if (hits > 1) {
    lineReply_(replyToken, "❌ รหัส " + code + " ซ้ำกันหลายแท็บ (คนขับ / พนักงานสั่งของ / ร้านค้า) — แจ้งออฟฟิศให้แก้รหัสไม่ให้ซ้ำ แล้วลงทะเบียนใหม่");
    return;
  }
  if (shop) return registerParty_(replyToken, userId, code, SHEET.SHOPS);
  if (staff) return registerParty_(replyToken, userId, code, SHEET.STAFF);
  registerDriver_(replyToken, userId, code);
}

/** ผูกไลน์กับรหัสร้าน/พนักงาน — 1 รหัส 1 ไลน์ · 1 ไลน์ 1 รหัสต่อแท็บ (กติกาเดียวกับคนขับ) */
function registerParty_(replyToken, userId, code, tab) {
  var isShop = tab === SHEET.SHOPS;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var rows = partyRows_(tab);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].userId === userId && rows[i].code !== code) {
        lineReply_(replyToken, "ไลน์นี้ผูกกับรหัส " + rows[i].code + " อยู่แล้ว หากต้องการเปลี่ยน กรุณาติดต่อออฟฟิศ");
        return;
      }
    }
    var p = partyByCode_(tab, code);
    if (p.userId && p.userId !== userId) {
      lineReply_(replyToken, "รหัส " + code + " ถูกผูกกับไลน์เครื่องอื่นอยู่แล้ว กรุณาติดต่อออฟฟิศเพื่อปลดล็อก");
      return;
    }
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tab);
    sh.getRange(p.row, PTC.LINE_ID).setValue(userId);
    sh.getRange(p.row, PTC.REGISTERED_AT).setValue(Utilities.formatDate(new Date(), TZ, "dd/MM/yyyy HH:mm"));
    log_("INFO", "ลงทะเบียน" + (isShop ? "ร้าน " : "พนักงานสั่งของ ") + code);
  } finally {
    lock.releaseLock();
  }

  if (isShop) {
    var menu = linkShopMenu_(userId);
    lineReply_(replyToken,
      "✅ ลงทะเบียนร้านสำเร็จ\n" + (p.name || code) + " (" + code + ")\n\n" +
      (menu ? "กดเมนูด้านล่าง\n" : "พิมพ์คำสั่ง\n") +
      "• «" + MENU_ORDERS + "» — ดูออเดอร์จากบริษัท กดรับ/แจ้งของไม่ครบ\n" +
      "• «" + MENU_PRICE + "» — ทำเสร็จแล้ว แจ้งราคา + ส่งรูปบิล\n\n" +
      "⚠️ ทำงาน/จ่ายของเฉพาะใบที่มีเลข PO จากบริษัทเท่านั้น");
  } else {
    lineReply_(replyToken,
      "✅ ลงทะเบียนพนักงานสั่งของสำเร็จ\nคุณ" + (p.name || code) + " (" + code + ")\n\n" +
      "สั่งงานร้านด้วยคำสั่ง #สั่ง\n\n" + PO_EXAMPLE + "\n\nดูสถานะ: #สถานะ PO-…");
  }
}

/**
 * ผูกเมนูร้าน (rich menu) ให้ไลน์ของร้านคนเดียว — คนขับ/พนักงานไม่เห็นเมนูนี้
 * เมนูสร้างครั้งเดียวจากเว็บ (มีรูปเมนูอยู่ในเว็บ) ที่นี่แค่หาเลขเมนูจากชื่อแล้วผูก
 * การผูกเมนูไม่ใช่การส่งข้อความ จึงไม่กินโควตา · ยังไม่ได้ติดตั้งเมนู = คืน false (ร้านพิมพ์คำสั่งแทนได้)
 */
function linkShopMenu_(userId) {
  try {
    var id = shopRichMenuId_();
    if (!id) return false;
    var res = UrlFetchApp.fetch("https://api.line.me/v2/bot/user/" + userId + "/richmenu/" + id, {
      method: "post", headers: lineHeaders_(), muteHttpExceptions: true,
    });
    if (res.getResponseCode() >= 300) {
      log_("WARN", "ผูกเมนูร้านไม่สำเร็จ " + res.getResponseCode() + ": " + res.getContentText().slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    log_("WARN", "ผูกเมนูร้าน: " + err);
    return false;
  }
}

function shopRichMenuId_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get("shop_richmenu");
  if (hit) return hit === "-" ? "" : hit;
  var res = UrlFetchApp.fetch("https://api.line.me/v2/bot/richmenu/list", { headers: lineHeaders_(), muteHttpExceptions: true });
  var id = "";
  if (res.getResponseCode() < 300) {
    (JSON.parse(res.getContentText()).richmenus || []).forEach(function (m) {
      if (m.name === SHOP_RICHMENU_NAME) id = m.richMenuId;
    });
  }
  cache.put("shop_richmenu", id || "-", id ? 600 : 120); // สั้นไว้ — ติดตั้งเมนูใหม่จากเว็บแล้วเลขเปลี่ยน
  return id;
}

// ── อ่าน/เขียนใบสั่ง ─────────────────────────────────────────

/** ใบสั่งทั้งหมด → { id: {id, at, staffCode, ..., items:[{row, seq, item, qty, unit, answer, price}]} } */
function poAll_() {
  var sh = poSheet_();
  var out = {};
  if (sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, PO_HEADER.length).getValues().forEach(function (v, i) {
    var id = String(v[PC.ID - 1]).trim();
    if (!id) return;
    var o = out[id];
    if (!o) {
      o = out[id] = {
        id: id,
        at: String(v[PC.AT - 1]),
        staffCode: String(v[PC.STAFF - 1]).trim().toUpperCase(),
        staffName: String(v[PC.STAFF_NAME - 1]).trim(),
        shopCode: String(v[PC.SHOP - 1]).trim().toUpperCase(),
        shopName: String(v[PC.SHOP_NAME - 1]).trim(),
        target: String(v[PC.TARGET - 1]).trim(),
        status: String(v[PC.STATUS - 1]).trim(),
        bill: String(v[PC.BILL - 1]).trim(),
        items: [],
      };
    }
    var price = v[PC.PRICE - 1];
    o.items.push({
      row: i + 2,
      seq: Number(v[PC.SEQ - 1]) || o.items.length + 1,
      item: String(v[PC.ITEM - 1]).trim(),
      qty: v[PC.QTY - 1],
      unit: String(v[PC.UNIT - 1]).trim(),
      answer: String(v[PC.ANSWER - 1]).trim(),
      price: price === "" || price == null ? null : Number(price),
    });
  });
  return out;
}

function poGet_(id) {
  return poAll_()[String(id || "").trim().toUpperCase()] || null;
}

/** เขียนค่าเดียวกันลงทุกแถวของใบ (เช่น สถานะ) */
function poSetAll_(o, col, value) {
  var sh = poSheet_();
  o.items.forEach(function (it) { sh.getRange(it.row, col).setValue(value); });
}

function nowText_() {
  // ขึ้นต้นด้วย ' = เก็บเป็นข้อความ ชีตจะไม่แปลงเป็นวันที่ตามภาษาเครื่อง (เว็บอ่านรูปแบบเดียวเสมอ)
  return "'" + Utilities.formatDate(new Date(), TZ, "dd/MM/yyyy HH:mm");
}

/** เลขใบสั่งถัดไป PO-ปีเดือน(พ.ศ.)-ลำดับ เช่น PO-6910-001 — นับต่อจากเลขสูงสุดของเดือนนั้น */
function nextPoId_(sh) {
  var d = new Date();
  var y = (Number(Utilities.formatDate(d, TZ, "yyyy")) + 543) % 100;
  var prefix = "PO-" + pad2_(y) + Utilities.formatDate(d, TZ, "MM") + "-";
  var max = 0;
  if (sh.getLastRow() >= 2) {
    sh.getRange(2, PC.ID, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
      var s = String(r[0]).trim();
      if (s.indexOf(prefix) !== 0) return;
      var n = Number(s.slice(prefix.length));
      if (n > max) max = n;
    });
  }
  var next = String(max + 1);
  while (next.length < 3) next = "0" + next;
  return prefix + next;
}

function normKey_(s) {
  return String(s || "").replace(/\s+/g, "").toLowerCase();
}

function fmtQty_(it) {
  var q = it.qty === "" || it.qty == null ? "" : String(it.qty);
  return q ? " · " + q + (it.unit ? " " + it.unit : "") : "";
}

function fmtBaht_(n) {
  return Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ── ข้อความ: พนักงาน ────────────────────────────────────────

/**
 * จัดการข้อความที่เกี่ยวกับใบสั่งงานร้าน — คืน true ถ้าจัดการแล้ว
 * เรียกก่อนคำสั่งของคนขับ ร้านกับพนักงานจะได้ไม่เจอข้อความช่วยเหลือของคนขับ
 */
function handlePoText_(ev, userId, text) {
  var cache = CacheService.getScriptCache();
  var flat = text.replace(/\s+/g, "");

  if (/^#\s*สั่ง/.test(text)) { poCreate_(ev, userId, text); return true; }
  if (/^#\s*สถานะ/.test(text)) { poStatus_(ev, userId, text); return true; }
  if (/^#\s*ยกเลิก/.test(text)) { poCancel_(ev, userId, text); return true; }

  var shop = partyOf_(SHEET.SHOPS, userId);
  if (!shop) return false;

  if (text === MENU_ORDERS || flat === "ออเดอร์" || flat === "ออเดอร์ของร้าน") {
    cache.remove("po_price_" + userId);
    poShopList_(ev, shop);
    return true;
  }
  if (text === MENU_PRICE || flat === "แจ้งราคา" || flat === "ปิดงาน" || flat === "แจ้งราคา/ปิดงาน") {
    cache.remove("po_price_" + userId);
    poPriceMenu_(ev, shop);
    return true;
  }
  if (text === MENU_CONTACT) {
    lineReply_(ev.replyToken, "📞 พิมพ์ข้อความทิ้งไว้ในแชทนี้ได้เลยครับ แอดมินจะตอบกลับในแชทนี้");
    return true;
  }
  // กำลังแจ้งราคาอยู่ — ข้อความถัดไปคือราคาของรายการที่ถาม
  var state = cache.get("po_price_" + userId);
  if (state) {
    poPriceInput_(ev, userId, shop, state, text);
    return true;
  }
  // ร้านคุยกับแอดมินในแชท — บอทเงียบ ไม่แทรกข้อความช่วยเหลือ
  return true;
}

/** แยกข้อความ #สั่ง → {shopText, plates[], stock, items[]} หรือ {error} */
function parsePoText_(text) {
  var lines = text.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  var shopText = lines.shift().replace(/^#\s*สั่ง(งาน)?\s*/, "").trim();
  var plates = [];
  var stock = false;
  var items = [];
  lines.forEach(function (l) {
    var m;
    var flat = l.replace(/\s+/g, "");
    if ((m = l.match(/^(?:รถ|ทะเบียน(?:รถ)?)\s*[:：]?\s*(.+)$/))) { plates.push(m[1].replace(/\s+/g, "")); return; }
    if (/^(?:เข้า|ลง)?(?:คลัง|สต[๊็]?อ[กค])(?:บริษัท)?$/.test(flat)) { stock = true; return; }
    if ((m = l.match(/^(?:[-•*·]|\d+\s*[.)])\s*(.+)$/))) { items.push(parsePoItem_(m[1])); return; }
    if (!shopText) { shopText = l; return; }
    items.push(parsePoItem_(l));
  });
  if (!shopText) return { error: "ไม่ได้ระบุร้าน" };
  if (plates.length > 1) return { error: "ใบสั่ง 1 ใบ ใช้กับรถ 1 คัน — ถ้าหลายคันให้ส่ง #สั่ง แยกใบ" };
  if (plates.length && stock) return { error: "ใบเดียวเลือกได้อย่างเดียว: «รถ <ทะเบียน>» หรือ «เข้าคลัง»" };
  if (!plates.length && !stock) return { error: "ยังไม่ได้บอกว่าลงที่ไหน — ใส่บรรทัด «รถ <ทะเบียน>» หรือ «เข้าคลัง»" };
  if (!items.length) return { error: "ยังไม่มีรายการ — ใส่รายการบรรทัดละ 1 อย่าง ขึ้นต้นด้วย -" };
  if (items.length > 20) return { error: "รายการเกิน 20 อย่าง — แบ่งส่งเป็น 2 ใบ" };
  return { shopText: shopText, plate: plates[0] || "", stock: stock, items: items };
}

/** «เปลี่ยนยาง 11R22.5 2 เส้น» → {item:"เปลี่ยนยาง 11R22.5", qty:2, unit:"เส้น"} · ไม่มีจำนวน = 1 */
function parsePoItem_(s) {
  var m = s.match(/^(.*\S)\s+[xX×]\s*(\d+(?:\.\d+)?)\s*([^\d\s]{1,12})?$/) ||
          s.match(/^(.*\S)\s+(\d+(?:\.\d+)?)\s*([^\d\s]{1,12})?$/);
  if (m) return { item: m[1].trim(), qty: Number(m[2]), unit: (m[3] || "").trim() };
  return { item: s.trim(), qty: 1, unit: "" };
}

/** หาร้านจากข้อความ: รหัสตรง · ชื่อตรง · ชื่อที่มีคำนั้นอยู่ (ต้องเจอร้านเดียว ไม่งั้นถามกลับ ไม่เดา) */
function matchShop_(text) {
  var shops = partyRows_(SHEET.SHOPS);
  var k = normKey_(text);
  var bare = function (s) { return normKey_(s).replace(/^ร้าน/, ""); };
  var exact = shops.filter(function (s) { return normKey_(s.code) === k || normKey_(s.name) === k || bare(s.name) === bare(text); });
  if (exact.length === 1) return { shop: exact[0] };
  var part = bare(text).length >= 2 ? shops.filter(function (s) { return bare(s.name).indexOf(bare(text)) >= 0; }) : [];
  if (part.length === 1) return { shop: part[0] };
  var list = (part.length > 1 ? part : shops).slice(0, 15).map(function (s) { return "• " + s.name + " (" + s.code + ")"; }).join("\n");
  if (part.length > 1) return { error: "ชื่อร้าน «" + text + "» ตรงหลายร้าน — พิมพ์ชื่อเต็มหรือรหัสร้าน\n" + list };
  return { error: "ไม่พบร้าน «" + text + "» ในแท็บร้านค้า" + (list ? "\nร้านที่มี:\n" + list : " — ให้แอดมินเพิ่มร้านก่อน") };
}

/** ทะเบียนต้องมีในแท็บฐานข้อมูล (เว็บส่งมาให้) — แท็บว่าง (ยังไม่เคยดึง) ปล่อยผ่าน เว็บตรวจซ้ำตอนลงบัญชี */
function plateKnown_(plate) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.MASTER);
  if (!sh || sh.getLastRow() < 2) return true;
  var k = normKey_(plate);
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (normKey_(vals[i][0]) === k || normKey_(vals[i][1]) === k) return true;
  }
  return false;
}

function poCreate_(ev, userId, text) {
  var staff = partyOf_(SHEET.STAFF, userId);
  if (!staff) {
    lineReply_(ev.replyToken, "ยังไม่ได้ลงทะเบียนเป็นพนักงานสั่งของ — พิมพ์ «ลงทะเบียน <รหัสพนักงาน>» (ขอรหัสจากออฟฟิศ)");
    return;
  }
  if (text.replace(/\s+/g, "").replace(/^#สั่ง(งาน)?/, "") === "") {
    lineReply_(ev.replyToken, "สั่งงานร้านแบบนี้ครับ 👇\n\n" + PO_EXAMPLE);
    return;
  }
  var p = parsePoText_(text);
  if (p.error) { lineReply_(ev.replyToken, "❌ " + p.error + "\n\n" + PO_EXAMPLE); return; }
  var found = matchShop_(p.shopText);
  if (found.error) { lineReply_(ev.replyToken, "❌ " + found.error); return; }
  var shop = found.shop;
  if (p.plate && !plateKnown_(p.plate)) {
    lineReply_(ev.replyToken, "❌ ไม่พบทะเบียน " + p.plate + " ในระบบ — ตรวจตัวเลขแล้วส่งใหม่ (พิมพ์แบบ 70-1938)");
    return;
  }
  var target = p.stock ? PO_STOCK : p.plate;

  var id;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = poSheet_();
    id = nextPoId_(sh);
    var at = nowText_();
    var rows = p.items.map(function (it, i) {
      return [id, i + 1, at, staff.code, staff.name, shop.code, shop.name, target, it.item, it.qty, it.unit,
        POS.WAIT, "", "", "", "", "", "", i === 0 ? text.slice(0, 2000) : ""];
    });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, PO_HEADER.length).setValues(rows);
  } finally {
    lock.releaseLock();
  }
  log_("INFO", "ใบสั่งงานร้าน " + id + " โดย " + staff.code + " → " + shop.code);

  var lines = p.items.map(function (it, i) { return (i + 1) + ". " + it.item + fmtQty_(it); });
  lineReply_(ev.replyToken,
    "✅ บันทึกใบสั่งงาน " + id + " แล้ว\n" +
    "– ร้าน: " + shop.name + "\n" +
    "– ลงที่: " + (p.stock ? "เข้าคลังบริษัท" : "รถ " + p.plate) + "\n" +
    "– รายการ:\n" + lines.join("\n") + "\n" +
    "– รอร้านกดรับในแชทของร้าน" +
    (shop.userId ? "" : "\n⚠️ ร้านนี้ยังไม่ได้ลงทะเบียนไลน์ — ร้านจะยังไม่เห็นใบนี้ (ให้ร้านพิมพ์ «ลงทะเบียน " + shop.code + "»)") +
    "\n\nดูสถานะ: #สถานะ " + id);
}

var PO_ICON = {};
PO_ICON[POS.WAIT] = "⏳";
PO_ICON[POS.ACCEPTED] = "🔧";
PO_ICON[POS.NONE] = "❌";
PO_ICON[POS.PRICED] = "✅";
PO_ICON[POS.POSTED] = "📗";
PO_ICON[POS.CANCELLED] = "🚫";

function poSummary_(o) {
  var total = 0;
  var lines = o.items.map(function (it) {
    var mark = it.answer === ANS.OK ? "✅" : it.answer === ANS.NO ? "❌" : "•";
    if (it.price != null && it.answer !== ANS.NO) total += it.price;
    return mark + " " + it.item + fmtQty_(it) +
      (it.answer === ANS.NO ? " — ร้านไม่มีของ" : it.price != null ? " — " + fmtBaht_(it.price) + " บาท" : "");
  });
  return (PO_ICON[o.status] || "•") + " " + o.id + " · " + (o.status || "-") + "\n" +
    "ร้าน " + o.shopName + " · " + (o.target === PO_STOCK ? "เข้าคลัง" : "รถ " + o.target) + "\n" +
    "สั่งเมื่อ " + o.at.replace(/^'/, "") + " โดย " + (o.staffName || o.staffCode) + "\n" +
    lines.join("\n") +
    (o.status === POS.PRICED || o.status === POS.POSTED ? "\nรวม " + fmtBaht_(total) + " บาท" : "");
}

/** #สถานะ PO-… = ใบเดียว · #สถานะ เฉยๆ = 5 ใบล่าสุดของคนพิมพ์ */
function poStatus_(ev, userId, text) {
  var staff = partyOf_(SHEET.STAFF, userId);
  if (!staff) {
    lineReply_(ev.replyToken, "คำสั่งนี้สำหรับพนักงานสั่งของที่ลงทะเบียนแล้ว");
    return;
  }
  var m = text.match(/PO-?\s*(\d{4})\s*-?\s*(\d{1,4})/i);
  if (m) {
    var id = "PO-" + m[1] + "-" + ("000" + m[2]).slice(-Math.max(3, m[2].length));
    var o = poGet_(id);
    lineReply_(ev.replyToken, o ? poSummary_(o) : "ไม่พบใบสั่งงาน " + id);
    return;
  }
  var all = poAll_();
  var mine = Object.keys(all).map(function (k) { return all[k]; })
    .filter(function (o) { return o.staffCode === staff.code; })
    .slice(-5).reverse();
  lineReply_(ev.replyToken, mine.length
    ? mine.map(poSummary_).join("\n\n")
    : "ยังไม่มีใบสั่งงานของคุณ — สั่งด้วย #สั่ง (พิมพ์ #สั่ง เพื่อดูตัวอย่าง)");
}

/** #ยกเลิก PO-… — คนสั่งยกเลิกเองได้เฉพาะตอนร้านยังไม่ตอบ (ร้านรับแล้วต้องให้แอดมินยกเลิกในเว็บ) */
function poCancel_(ev, userId, text) {
  var staff = partyOf_(SHEET.STAFF, userId);
  var m = text.match(/PO-?\s*(\d{4})\s*-?\s*(\d{1,4})/i);
  if (!staff || !m) {
    lineReply_(ev.replyToken, staff ? "พิมพ์ #ยกเลิก ตามด้วยเลขใบ เช่น #ยกเลิก PO-6910-001" : "คำสั่งนี้สำหรับพนักงานสั่งของที่ลงทะเบียนแล้ว");
    return;
  }
  var id = "PO-" + m[1] + "-" + ("000" + m[2]).slice(-Math.max(3, m[2].length));
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var o = poGet_(id);
    if (!o) { lineReply_(ev.replyToken, "ไม่พบใบสั่งงาน " + id); return; }
    if (o.staffCode !== staff.code) { lineReply_(ev.replyToken, "❌ " + id + " ไม่ใช่ใบที่คุณสั่ง — ให้คนสั่งหรือแอดมินยกเลิก"); return; }
    if (o.status !== POS.WAIT) { lineReply_(ev.replyToken, "❌ " + id + " สถานะ «" + o.status + "» แล้ว ยกเลิกเองไม่ได้ — ติดต่อแอดมิน"); return; }
    poSetAll_(o, PC.STATUS, POS.CANCELLED);
  } finally {
    lock.releaseLock();
  }
  lineReply_(ev.replyToken, "🚫 ยกเลิกใบสั่งงาน " + id + " แล้ว — แจ้งร้านด้วยว่าไม่ต้องทำ");
}

// ── ข้อความ/ปุ่ม: ร้าน ──────────────────────────────────────

/** ตอบกลับหลายก้อน (สูงสุด 5) — ใช้ส่งการ์ด */
function lineReplyMessages_(replyToken, messages) {
  var res = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/reply", {
    method: "post",
    contentType: "application/json",
    headers: lineHeaders_(),
    payload: JSON.stringify({ replyToken: replyToken, messages: messages.slice(0, 5) }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) log_("WARN", "LINE reply " + res.getResponseCode() + ": " + res.getContentText().slice(0, 300));
}

function flexText_(text, opt) {
  var t = { type: "text", text: String(text || " ").slice(0, 2000), wrap: true };
  Object.keys(opt || {}).forEach(function (k) { t[k] = opt[k]; });
  return t;
}

function flexButton_(label, data, color, display) {
  return {
    type: "button", style: "primary", color: color, height: "sm", margin: "sm",
    action: { type: "postback", label: label.slice(0, 40), data: data, displayText: display || label },
  };
}

/** การ์ดใบสั่งงานที่ร้านเห็น — ปุ่มเปลี่ยนตามสถานะ */
function poCard_(o) {
  var rows = [
    { type: "box", layout: "horizontal", contents: [
      flexText_(o.target === PO_STOCK ? "ลงที่" : "ทะเบียนรถ", { size: "sm", color: "#555555", flex: 2 }),
      flexText_(o.target === PO_STOCK ? "เข้าคลังบริษัท" : o.target, { size: "sm", weight: "bold", align: "end", flex: 3 }),
    ] },
    { type: "box", layout: "horizontal", contents: [
      flexText_("ผู้สั่ง", { size: "sm", color: "#555555", flex: 2 }),
      flexText_(o.staffName || o.staffCode, { size: "sm", weight: "bold", align: "end", flex: 3 }),
    ] },
    { type: "separator", margin: "md" },
    flexText_("รายการ", { weight: "bold", margin: "md" }),
  ];
  o.items.forEach(function (it, i) {
    var mark = it.answer === ANS.OK ? "✅ " : it.answer === ANS.NO ? "❌ " : (i + 1) + ". ";
    rows.push(flexText_(mark + it.item + fmtQty_(it) + (it.answer === ANS.NO ? " — ไม่มีของ" : ""), { size: "sm", margin: "sm" }));
  });
  rows.push(flexText_("ไม่มีเลขใบสั่งงานนี้ = บริษัทไม่ได้สั่ง กรุณาอย่าทำ/จ่ายของ", { size: "xxs", color: "#888888", margin: "lg" }));

  var buttons = [];
  if (o.status === POS.WAIT) {
    buttons.push(flexButton_("✅ รับออเดอร์", "po|acc|" + o.id, "#06C755", "รับออเดอร์ " + o.id));
    buttons.push(flexButton_("⚠️ มีของไม่ครบ", "po|part|" + o.id, "#d97706", "มีของไม่ครบ " + o.id));
    buttons.push(flexButton_("❌ ไม่มีของ", "po|none|" + o.id, "#dc2626", "ไม่มีของ " + o.id));
  } else if (o.status === POS.ACCEPTED) {
    buttons.push(flexButton_("🧾 แจ้งราคา / ปิดงาน", "po|price|" + o.id, "#1e3a5f", "แจ้งราคา " + o.id));
    if (!o.items.some(function (it) { return it.price != null; })) {
      buttons.push(flexButton_("✏️ แก้รายการที่ทำได้", "po|part|" + o.id, "#d97706", "แก้รายการ " + o.id));
    }
  }
  var bubble = {
    type: "bubble",
    header: { type: "box", layout: "vertical", backgroundColor: "#c8102e", paddingAll: "14px", contents: [
      flexText_("ใบสั่งงาน " + o.id, { color: "#ffffff", weight: "bold", size: "lg" }),
      flexText_("บริษัท เทียมเทพ ขนส่ง จำกัด · " + o.at.replace(/^'/, ""), { color: "#ffe4e6", size: "xs" }),
      flexText_((PO_ICON[o.status] || "") + " " + o.status, { color: "#ffffff", size: "sm", weight: "bold", margin: "sm" }),
    ] },
    body: { type: "box", layout: "vertical", spacing: "xs", contents: rows },
  };
  if (buttons.length) bubble.footer = { type: "box", layout: "vertical", spacing: "sm", contents: buttons };
  return bubble;
}

function carousel_(alt, bubbles) {
  return { type: "flex", altText: alt.slice(0, 300), contents: bubbles.length === 1 ? bubbles[0] : { type: "carousel", contents: bubbles.slice(0, 12) } };
}

function shopOpenOrders_(shop, statuses) {
  var all = poAll_();
  return Object.keys(all).map(function (k) { return all[k]; })
    .filter(function (o) { return o.shopCode === shop.code && statuses.indexOf(o.status) >= 0; });
}

/** เมนู «📋 ออเดอร์ของร้าน» — การ์ดของใบที่รอตอบ + ใบที่รับแล้วยังไม่แจ้งราคา */
function poShopList_(ev, shop) {
  var list = shopOpenOrders_(shop, [POS.WAIT, POS.ACCEPTED]);
  if (!list.length) {
    lineReply_(ev.replyToken, "ยังไม่มีออเดอร์ค้างอยู่ครับ ✅");
    return;
  }
  // ใบที่รอตอบขึ้นก่อน (เก่าก่อน) — ร้านเห็นงานที่ต้องกดก่อน
  list.sort(function (a, b) { return (a.status === POS.WAIT ? 0 : 1) - (b.status === POS.WAIT ? 0 : 1) || (a.id < b.id ? -1 : 1); });
  var wait = list.filter(function (o) { return o.status === POS.WAIT; }).length;
  var head = "📋 ออเดอร์ของร้าน " + list.length + " ใบ" + (wait ? " · รอกดรับ " + wait + " ใบ" : "") +
    (list.length > 12 ? "\n(แสดง 12 ใบแรก — ตอบใบเหล่านี้แล้วกดเมนูอีกครั้ง)" : "");
  lineReplyMessages_(ev.replyToken, [{ type: "text", text: head }, carousel_(head, list.slice(0, 12).map(poCard_))]);
}

/** การ์ดเลือกทีละรายการ (มีของไม่ครบ) */
function poPickCard_(o) {
  var rows = [flexText_("กดทีละรายการว่าทำได้ / ไม่มีของ", { weight: "bold", size: "sm" })];
  o.items.forEach(function (it) {
    var state = it.answer === ANS.OK ? "✅ ทำได้" : it.answer === ANS.NO ? "❌ ไม่มีของ" : "ยังไม่เลือก";
    rows.push({ type: "separator", margin: "md" });
    rows.push(flexText_(it.seq + ". " + it.item + fmtQty_(it), { size: "sm", margin: "md", weight: "bold" }));
    rows.push(flexText_("ตอนนี้: " + state, { size: "xs", color: it.answer ? "#333333" : "#d97706" }));
    rows.push({ type: "box", layout: "horizontal", spacing: "sm", margin: "sm", contents: [
      flexButton_("✅ ทำได้", "po|it|" + o.id + "|" + it.seq + "|ok", "#06C755", it.seq + ". ทำได้"),
      flexButton_("❌ ไม่มีของ", "po|it|" + o.id + "|" + it.seq + "|no", "#dc2626", it.seq + ". ไม่มีของ"),
    ] });
  });
  return {
    type: "bubble",
    header: { type: "box", layout: "vertical", backgroundColor: "#d97706", paddingAll: "12px", contents: [
      flexText_("⚠️ มีของไม่ครบ · " + o.id, { color: "#ffffff", weight: "bold" }),
    ] },
    body: { type: "box", layout: "vertical", contents: rows },
  };
}

function handlePoPostback_(ev, userId, data) {
  var p = data.split("|");
  var act = p[1];
  var id = p[2] || "";
  var shop = partyOf_(SHEET.SHOPS, userId);
  if (!shop) { lineReply_(ev.replyToken, "ปุ่มนี้สำหรับร้านที่ลงทะเบียนแล้ว"); return; }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var reply = null;
  try {
    var o = poGet_(id);
    if (!o || o.shopCode !== shop.code) { lineReply_(ev.replyToken, "ไม่พบใบสั่งงาน " + id + " ของร้านนี้"); return; }
    var sh = poSheet_();
    var priced = o.items.some(function (it) { return it.price != null; });

    if (act === "acc") {
      if (o.status !== POS.WAIT) { reply = { text: "ใบ " + id + " ตอบไปแล้ว: " + o.status }; }
      else {
        o.items.forEach(function (it) { sh.getRange(it.row, PC.ANSWER).setValue(ANS.OK); sh.getRange(it.row, PC.ANSWERED_AT).setValue(nowText_()); });
        poSetAll_(o, PC.STATUS, POS.ACCEPTED);
        reply = { text: "✅ รับออเดอร์ " + id + " แล้ว ขอบคุณครับ\nทำเสร็จแล้วกดเมนู «" + MENU_PRICE + "»" };
      }
    } else if (act === "none") {
      if (o.status !== POS.WAIT) { reply = { text: "ใบ " + id + " ตอบไปแล้ว: " + o.status }; }
      else {
        reply = { text: "ยืนยันว่าไม่มีของ «ทั้งใบ» " + id + " ?\n(ถ้ามีบางรายการ กด «⚠️ มีของไม่ครบ» แทน)", buttons: [
          { type: "action", action: { type: "postback", label: "❌ ยืนยัน ไม่มีของ", data: "po|none!|" + id, displayText: "ยืนยัน ไม่มีของ " + id } },
        ] };
      }
    } else if (act === "none!") {
      if (o.status !== POS.WAIT) { reply = { text: "ใบ " + id + " ตอบไปแล้ว: " + o.status }; }
      else {
        o.items.forEach(function (it) { sh.getRange(it.row, PC.ANSWER).setValue(ANS.NO); sh.getRange(it.row, PC.ANSWERED_AT).setValue(nowText_()); });
        poSetAll_(o, PC.STATUS, POS.NONE);
        reply = { text: "รับทราบครับ ❌ ร้านไม่มีของ — ปิดใบ " + id + " แล้ว" };
      }
    } else if (act === "part") {
      if (!(o.status === POS.WAIT || (o.status === POS.ACCEPTED && !priced))) { reply = { text: "ใบ " + id + " สถานะ «" + o.status + "» แก้รายการไม่ได้แล้ว — ติดต่อแอดมิน" }; }
      else reply = { flex: poPickCard_(o) };
    } else if (act === "it") {
      if (!(o.status === POS.WAIT || (o.status === POS.ACCEPTED && !priced))) { reply = { text: "ใบ " + id + " สถานะ «" + o.status + "» แก้รายการไม่ได้แล้ว — ติดต่อแอดมิน" }; }
      else {
        var seq = Number(p[3]);
        var ans = p[4] === "ok" ? ANS.OK : ANS.NO;
        o.items.forEach(function (it) {
          if (it.seq !== seq) return;
          it.answer = ans;
          sh.getRange(it.row, PC.ANSWER).setValue(ans);
          sh.getRange(it.row, PC.ANSWERED_AT).setValue(nowText_());
        });
        var left = o.items.filter(function (it) { return !it.answer; }).length;
        if (left > 0) reply = { flex: poPickCard_(o) };
        else {
          var ok = o.items.filter(function (it) { return it.answer === ANS.OK; }).length;
          poSetAll_(o, PC.STATUS, ok > 0 ? POS.ACCEPTED : POS.NONE);
          reply = { text: ok > 0
            ? "✅ รับออเดอร์ " + id + " — ทำได้ " + ok + " จาก " + o.items.length + " รายการ\n" +
              o.items.map(function (it) { return (it.answer === ANS.OK ? "✅ " : "❌ ") + it.item; }).join("\n") +
              "\n\nทำเสร็จแล้วกดเมนู «" + MENU_PRICE + "»"
            : "รับทราบครับ ❌ ไม่มีของทุกรายการ — ปิดใบ " + id + " แล้ว" };
        }
      }
    } else if (act === "price") {
      reply = { start: o };
    } else if (act === "pok") {
      reply = { text: poPriceConfirm_(userId, o) };
    } else if (act === "predo") {
      if (o.status !== POS.ACCEPTED) { reply = { text: "ใบ " + id + " สถานะ «" + o.status + "» แก้ราคาไม่ได้แล้ว — ติดต่อแอดมิน" }; }
      else {
        o.items.forEach(function (it) { sh.getRange(it.row, PC.PRICE).setValue(""); it.price = null; });
        reply = { start: o };
      }
    }
  } finally {
    lock.releaseLock();
  }
  if (!reply) return;
  if (reply.start) { poPriceStart_(ev, userId, reply.start); return; }
  if (reply.flex) { lineReplyMessages_(ev.replyToken, [{ type: "flex", altText: "เลือกรายการที่ทำได้", contents: reply.flex }]); return; }
  lineReply_(ev.replyToken, reply.text, reply.buttons);
}

// ── แจ้งราคา ────────────────────────────────────────────────

/** เมนู «🧾 แจ้งราคา / ปิดงาน» — ใบเดียวเริ่มเลย · หลายใบให้เลือก */
function poPriceMenu_(ev, shop) {
  var list = shopOpenOrders_(shop, [POS.ACCEPTED]);
  if (!list.length) {
    var wait = shopOpenOrders_(shop, [POS.WAIT]).length;
    lineReply_(ev.replyToken, "ไม่มีงานที่รอแจ้งราคาครับ" +
      (wait ? "\nมีออเดอร์ที่ยังไม่ได้กดรับ " + wait + " ใบ — กดเมนู «" + MENU_ORDERS + "»" : "") +
      "\n(ถ้าแจ้งราคาผิด พิมพ์บอกแอดมินในแชทนี้)");
    return;
  }
  if (list.length === 1) { poPriceStart_(ev, "", list[0], shop); return; }
  var buttons = list.slice(0, 10).map(function (o) {
    var n = o.items.filter(function (it) { return it.answer === ANS.OK; }).length;
    return { type: "action", action: { type: "postback", label: (o.id + " · " + (o.target === PO_STOCK ? "คลัง" : o.target)).slice(0, 40), data: "po|price|" + o.id, displayText: "แจ้งราคา " + o.id + " (" + n + " รายการ)" } };
  });
  lineReply_(ev.replyToken, "🧾 เลือกใบที่ทำเสร็จแล้ว (" + list.length + " ใบ)", buttons);
}

/** เริ่ม/ต่อการถามราคา — ถามรายการแรกที่ทำได้และยังไม่มีราคา */
function poPriceStart_(ev, userId, o, shop) {
  if (o.status !== POS.ACCEPTED) {
    lineReply_(ev.replyToken, "ใบ " + o.id + " สถานะ «" + o.status + "» — แจ้งราคาได้เฉพาะใบที่ร้านรับแล้ว");
    return;
  }
  var uid = userId || (ev.source && ev.source.userId);
  var next = o.items.filter(function (it) { return it.answer === ANS.OK && it.price == null; })[0];
  if (!next) { poPriceReview_(ev, o); return; }
  CacheService.getScriptCache().put("po_price_" + uid, o.id, 1800);
  var okItems = o.items.filter(function (it) { return it.answer === ANS.OK; });
  lineReply_(ev.replyToken,
    "🧾 " + o.id + " · แจ้งราคารวมทีละรายการ (บาท)\n\n" +
    next.seq + ". " + next.item + fmtQty_(next) + " = ?\n\n" +
    "(รายการ " + (okItems.indexOf(next) + 1) + " จาก " + okItems.length + ") พิมพ์ตัวเลข เช่น 300 · พิมพ์ «ยกเลิก» เพื่อหยุด");
}

function poPriceInput_(ev, userId, shop, id, text) {
  var cache = CacheService.getScriptCache();
  if (text.replace(/\s+/g, "") === "ยกเลิก") {
    cache.remove("po_price_" + userId);
    lineReply_(ev.replyToken, "หยุดแจ้งราคาแล้ว — ราคาที่พิมพ์ไปแล้วยังอยู่ กดเมนู «" + MENU_PRICE + "» เพื่อทำต่อ");
    return;
  }
  var m = text.replace(/บาท|฿|\s/g, "").match(/^(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?$/);
  if (!m) {
    lineReply_(ev.replyToken, "พิมพ์เป็นตัวเลขราคารวมของรายการนี้ เช่น 300 หรือ 1,250.50 (พิมพ์ «ยกเลิก» เพื่อหยุด)");
    return;
  }
  var price = Number(m[1].replace(/,/g, "") + (m[2] || ""));
  var o;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    o = poGet_(id);
    if (!o || o.shopCode !== shop.code || o.status !== POS.ACCEPTED) {
      cache.remove("po_price_" + userId);
      lineReply_(ev.replyToken, "ใบ " + id + " แจ้งราคาไม่ได้แล้ว (สถานะ «" + (o ? o.status : "ไม่พบ") + "») — ติดต่อแอดมิน");
      return;
    }
    var next = o.items.filter(function (it) { return it.answer === ANS.OK && it.price == null; })[0];
    if (next) {
      poSheet_().getRange(next.row, PC.PRICE).setValue(price);
      next.price = price;
    }
  } finally {
    lock.releaseLock();
  }
  poPriceStart_(ev, userId, o, shop);
}

/** ครบทุกรายการแล้ว — โชว์สรุปให้ร้านตรวจก่อนยืนยัน (เงินต้องไม่ผิด) */
function poPriceReview_(ev, o) {
  CacheService.getScriptCache().remove("po_price_" + (ev.source && ev.source.userId));
  var total = 0;
  var lines = o.items.map(function (it) {
    if (it.answer !== ANS.OK) return "❌ " + it.item + " — ไม่มีของ";
    total += it.price || 0;
    return "✅ " + it.item + fmtQty_(it) + " = " + fmtBaht_(it.price) + " บาท";
  });
  lineReply_(ev.replyToken,
    "🧾 ตรวจราคา " + o.id + "\n\n" + lines.join("\n") + "\n\nรวม " + fmtBaht_(total) + " บาท\nถูกต้องไหมครับ?",
    [
      { type: "action", action: { type: "postback", label: "✅ ถูกต้อง ปิดงาน", data: "po|pok|" + o.id, displayText: "ยืนยันราคา " + o.id } },
      { type: "action", action: { type: "postback", label: "✏️ พิมพ์ราคาใหม่", data: "po|predo|" + o.id, displayText: "แก้ราคา " + o.id } },
    ]);
}

/** ร้านยืนยันราคา → ใบเป็น «แจ้งราคาแล้ว» · เปิดรับรูปบิล 30 นาที */
function poPriceConfirm_(userId, o) {
  if (o.status !== POS.ACCEPTED) return "ใบ " + o.id + " สถานะ «" + o.status + "» แล้ว";
  var missing = o.items.filter(function (it) { return it.answer === ANS.OK && it.price == null; }).length;
  if (missing) return "ยังแจ้งราคาไม่ครบ (ขาด " + missing + " รายการ) — กดเมนู «" + MENU_PRICE + "»";
  var total = o.items.reduce(function (a, it) { return a + (it.answer === ANS.OK ? it.price || 0 : 0); }, 0);
  poSetAll_(o, PC.STATUS, POS.PRICED);
  poSetAll_(o, PC.PRICED_AT, nowText_());
  CacheService.getScriptCache().put("po_bill_" + userId, o.id, 1800);
  log_("INFO", "ร้าน " + o.shopCode + " แจ้งราคา " + o.id + " รวม " + total);
  return "✅ ปิดงาน " + o.id + " รวม " + fmtBaht_(total) + " บาท ขอบคุณครับ\n\n📷 ส่งรูปบิล/ใบเสร็จต่อได้เลย (ภายใน 30 นาที)";
}

/**
 * รูปบิลจากร้าน — รับเฉพาะหลังยืนยันราคา (ภายใน 30 นาที) เก็บลงโฟลเดอร์ของบอทเอง «บิลร้าน/ปี-เดือน»
 * คืน true ถ้าเป็นรูปของร้าน (จัดการแล้ว ไม่ต้องไปเข้าทางรูปตั๋วของคนขับ)
 */
function handlePoImage_(ev, userId) {
  var shop = partyOf_(SHEET.SHOPS, userId);
  if (!shop) return false;
  var cache = CacheService.getScriptCache();
  var id = cache.get("po_bill_" + userId);
  if (!id) {
    lineReply_(ev.replyToken, "📷 ถ้าเป็นรูปบิล: กดเมนู «" + MENU_PRICE + "» แจ้งราคาให้เสร็จก่อน แล้วส่งรูปบิลตามได้เลยครับ");
    return true;
  }
  var blob = lineGetContent_(ev.message.id);
  blob.setName(id + "_" + Utilities.formatDate(new Date(), TZ, "yyyyMMdd-HHmmss") + "_" + ev.message.id + ".jpg");
  var url = imageFolder_("บิลร้าน").createFile(blob).getUrl();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var o = poGet_(id);
    if (o) poSetAll_(o, PC.BILL, o.bill ? o.bill + "\n" + url : url);
  } finally {
    lock.releaseLock();
  }
  cache.put("po_bill_" + userId, id, 1800);
  lineReply_(ev.replyToken, "📷 รับรูปบิล " + id + " แล้ว ✅ (ส่งเพิ่มได้อีกภายใน 30 นาที)");
  return true;
}
