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
 *     และรอบเก็บตก 20:00 น. (ไม่ส่งซ้ำคนที่แจ้งไปแล้ว)      → sendMorningJobs()
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
  IMPORT_RESULT: 20, // ผลนำเข้าเว็บ — ฝั่งเว็บเขียนกลับ
  ACK_AT: 21,      // เวลาคนขับกดปุ่มรับทราบงาน
  ALC_IMG: 22,     // ลิงก์รูปเป่าแอลกอฮอล์ก่อนเริ่มงาน
  POD_IMG: 23,     // รูปสินค้าขึ้นรถ (ถ่ายหลังขึ้นของเสร็จ ไว้ส่งให้ลูกค้า) — มีได้หลายรูป ต่อบรรทัดกัน
};
var JOBS_HEADER = [
  "รหัสงาน", "วันที่", "รหัสคนขับ", "ชื่อคนขับ", "ทะเบียนรถ", "ทะเบียนหาง",
  "รหัสลูกค้า", "ต้นทาง", "ปลายทาง", "ประเภทสินค้า", "คำสั่ง/หมายเหตุ",
  "สถานะ", "เวลาแจ้งไลน์",
  "เลขตั๋วต้นทาง", "นน.ต้นทาง (ตัน)", "รูปตั๋วต้นทาง",
  "เลขตั๋วปลายทาง", "นน.ปลายทาง (ตัน)", "รูปตั๋วปลายทาง",
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

  jobs.setFrozenRows(1);
  SpreadsheetApp.getUi().alert(
    "สร้างโครงชีตเรียบร้อย\n\nขั้นต่อไป: กดเมนู «② ติดตั้งตัวตั้งเวลาแจ้งงาน 17:00 / 20:00»\n" +
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
 * รอบเก็บตก 20:00 จึงส่งเฉพาะแถวที่รอบ 17:00 ยังไม่ได้ส่ง — ไม่ซ้ำคนเดิมแน่นอน
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
    var byDriver = {}; // code → [{row, values}]
    data.forEach(function (v, i) {
      if (String(v[JC.STATUS - 1]) !== ST.NEW) return;
      var ds = dateStr_(v[JC.DATE - 1]);
      if (ds !== tomorrow && ds !== today) return;
      // แปลงเป็นตัวใหญ่เสมอ — ทะเบียนคนขับเก็บแบบตัวใหญ่ พิมพ์ d001/D001/admin ก็ต้องเจอ
      var code = String(v[JC.DRIVER - 1]).trim().toUpperCase();
      if (!code) return;
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
    log_("INFO", "แจ้งงานล่วงหน้า: คนขับ " + Object.keys(byDriver).length + " คน ปัญหา " + problems.length + " รายการ");
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
    lines.push("• รถ: " + v[JC.HEAD - 1] + (v[JC.TRAILER - 1] ? " / หาง " + v[JC.TRAILER - 1] : ""));
    lines.push("• ลูกค้า: " + v[JC.CUSTOMER - 1]);
    lines.push("• เส้นทาง: " + v[JC.ORIGIN - 1] + " → " + v[JC.DEST - 1]);
    if (v[JC.CARGO - 1]) lines.push("• สินค้า: " + v[JC.CARGO - 1]);
    if (v[JC.NOTE - 1]) lines.push("• หมายเหตุ: " + v[JC.NOTE - 1]);
    lines.push("");
  });
  lines.push("👇 กดปุ่ม «✅ รับทราบงาน» ด้านล่างเพื่อตอบรับงาน");
  lines.push("🍺 ก่อนเริ่มงาน กดปุ่ม «ส่งรูปเป่าแอลกอฮอล์» แล้วส่งรูปผลเป่า");
  lines.push("📸 รับของเสร็จ ส่งรูปตั๋วใบที่ 1 (นน.ต้นทาง) · ลงของเสร็จ ส่งรูปตั๋วใบที่ 2 (นน.ปลายทาง)");
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
      "สวัสดีครับ 🚚 ระบบสั่งงานคนขับ เทียมเทพ ขนส่ง\n\n" +
      "ขั้นแรก พิมพ์ลงทะเบียนด้วยรหัสพนักงานของท่าน เช่น\n\nลงทะเบียน D001");
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
  var code = driverCodeOf_(userId);
  if (!code) {
    lineReply_(ev.replyToken, "ยังไม่ได้ลงทะเบียน — พิมพ์ «ลงทะเบียน <รหัสพนักงาน>» ก่อนครับ");
    return;
  }

  // «รับทราบงาน» — ประทับเวลาลงทุกแถวงานที่อยู่ในข้อความนั้น
  if (data.indexOf("ack|") === 0) {
    var ids = data.slice(4).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    var count = ackJobs_(code, ids);
    if (count > 0) {
      lineReply_(ev.replyToken,
        "✅ รับทราบงานเรียบร้อย (" + count + " งาน) ขอบคุณครับ\n\n" +
        "🍺 ก่อนเริ่มงาน อย่าลืมกดปุ่มด้านล่างแล้วส่งรูปผลเป่าแอลกอฮอล์",
        jobQuickReply_(null));
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
    registerDriver_(ev.replyToken, userId, m[1].toUpperCase());
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
  lineReply_(ev.replyToken,
    "คำสั่งที่ใช้ได้\n" +
    "• พิมพ์ «งานวันนี้» — ดูงานของท่านวันนี้\n" +
    "• พิมพ์ «งานพรุ่งนี้» — ดูงานล่วงหน้าของพรุ่งนี้\n" +
    "• พิมพ์ «เป่า» แล้วส่งรูป — บันทึกผลเป่าแอลกอฮอล์\n" +
    "• ส่งรูปตั๋ว — ระบบจะบันทึกให้อัตโนมัติ\n" +
    "• «ลงทะเบียน <รหัสพนักงาน>» — ผูกไลน์กับรหัสของท่าน");
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
      lineReply_(replyToken, "✅ ลงทะเบียนสำเร็จ\nคุณ" + (name || code) + " (" + code + ")\n\nระบบจะแจ้งงานล่วงหน้าให้ทุกเย็น เวลา 17:00 น. (รอบเก็บตก 20:00 น.)");
      log_("INFO", "ลงทะเบียนคนขับ " + code);
      return;
    }
    lineReply_(replyToken, "ไม่พบรหัส " + code + " ในทะเบียนคนขับ กรุณาตรวจรหัส หรือติดต่อออฟฟิศ");
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
  var code = driverCodeOf_(userId);
  if (!code) {
    lineReply_(ev.replyToken, "ยังไม่ได้ลงทะเบียน — พิมพ์ «ลงทะเบียน <รหัสพนักงาน>» ก่อน แล้วส่งรูปใหม่อีกครั้งครับ");
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

    if (target) {
      jobId = String(target.v[JC.ID - 1]);
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
    var today = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");
    var jobs = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.JOBS);
    var items = jobsOnDateOf_(code, today, null);
    items.forEach(function (it) {
      fillIfEmpty_(jobs, it.row, JC.ALC_IMG, imgUrl);
    });

    lineReply_(ev.replyToken,
      "🍺✅ บันทึกรูปเป่าแอลกอฮอล์เรียบร้อย\n" +
      (items.length ? "ผูกกับงานวันนี้ " + items.length + " งานแล้ว " : "") +
      "ขับขี่ปลอดภัยนะครับ 🙏");
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
  var imgUrl = imageFolder_("รูปตั๋ว").createFile(blob).getUrl();

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
  var resource = { title: "ocr_tmp_" + Date.now(), mimeType: "application/vnd.google-apps.document" };
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
  var t = text.replace(/[，،]/g, ",");

  // เลขที่ตั๋ว: "เลขที่ ..." / "เลขที่ตั๋ว/บิล/เอกสาร" / "Ticket No." / "No."
  var m = t.match(/(?:เลขที่(?:ตั๋ว|บิล|เอกสาร|ชั่ง)?|ticket\s*no\.?|doc\.?\s*no\.?|no\.?)\s*[:：#]?\s*([A-Za-z0-9\/\-]{4,20})/i);
  if (m) out.ticketNo = m[1];

  // วันที่บนตั๋ว (ไว้ให้ออฟฟิศเทียบ ไม่ได้ใช้อัตโนมัติ)
  m = t.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
  if (m) out.date = m[1];

  // น้ำหนักสุทธิ: "น้ำหนักสุทธิ 30,540 กก." / "นน.สุทธิ" / "NET WEIGHT 30540" / "NET 30.54"
  m = t.match(/(?:น้ำหนักสุทธิ|นน\.?\s*สุทธิ|สุทธิ|net\s*(?:weight|wt)?\.?)\s*[:：]?\s*([\d,]+(?:\.\d+)?)/i);
  if (m) {
    var num = Number(m[1].replace(/,/g, ""));
    if (num > 0) {
      // ผลลัพธ์เป็น "ตัน" ทศนิยม 3 หลักเสมอ: เลขเกิน 500 ถือว่าตั๋วบอกเป็นกิโลกรัม หาร 1,000 ให้
      out.netTons = num > 500 ? Math.round(num) / 1000 : Math.round(num * 1000) / 1000;
    }
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

/** สร้างก้อนข้อความ (แนบปุ่ม quick reply ได้) */
function textMessage_(text, quickItems) {
  var msg = { type: "text", text: text.slice(0, 4900) };
  if (quickItems && quickItems.length) msg.quickReply = { items: quickItems };
  return msg;
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
  items.push({
    type: "action",
    action: {
      type: "postback",
      label: "🍺 ส่งรูปเป่าแอลกอฮอล์",
      data: "alc",
      displayText: "ขอส่งรูปเป่าแอลกอฮอล์",
    },
  });
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

    // เติมรหัสงาน + สถานะเริ่มต้น เมื่อแถวเริ่มมีข้อมูลวันที่
    var dateVal = sh.getRange(row, JC.DATE).getValue();
    if (dateVal && !sh.getRange(row, JC.ID).getValue()) {
      sh.getRange(row, JC.ID).setValue(nextJobId_(sh, dateVal));
      if (!sh.getRange(row, JC.STATUS).getValue()) sh.getRange(row, JC.STATUS).setValue(ST.NEW);
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
 * นัดที่ยังมาไม่ถึง (เช่น ตอน 17:00 นัดของ 20:00) จะถูกเก็บไว้ตามเดิม
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
