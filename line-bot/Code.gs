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
 *  • ผล OCR "ไม่เขียนลงฐานข้อมูลเว็บโดยตรง" — ลงชีตสถานะ «ได้ตั๋วแล้ว» ก่อน
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
  TICKET_NO: 14,  // เลขที่ตั๋ว (จาก OCR — แก้ได้)
  W_ORIGIN: 15,   // น้ำหนักต้นทาง (ตัน)
  W_DEST: 16,     // น้ำหนักปลายทาง (ตัน)
  TICKET_IMG: 17, // ลิงก์รูปตั๋วใน Drive
  IMPORT_RESULT: 18, // ผลนำเข้าเว็บ — ฝั่งเว็บเขียนกลับ
};
var JOBS_HEADER = [
  "รหัสงาน", "วันที่", "รหัสคนขับ", "ชื่อคนขับ", "ทะเบียนรถ", "ทะเบียนหาง",
  "รหัสลูกค้า", "ต้นทาง", "ปลายทาง", "ประเภทสินค้า", "คำสั่ง/หมายเหตุ",
  "สถานะ", "เวลาแจ้งไลน์", "เลขที่ตั๋ว", "นน.ต้นทาง (ตัน)", "นน.ปลายทาง (ตัน)",
  "รูปตั๋ว", "ผลนำเข้าเว็บ",
];

// คอลัมน์ของแท็บ «คนขับ»
var DC = { CODE: 1, NAME: 2, LINE_ID: 3, REGISTERED_AT: 4 };
var DRIVERS_HEADER = ["รหัสคนขับ", "ชื่อ-นามสกุล", "LINE User ID", "ลงทะเบียนเมื่อ"];

// คอลัมน์ของแท็บ «ตั๋ว» — บันทึกทุกภาพที่ส่งเข้ามา (ไว้ตรวจย้อนหลัง)
var TC = { AT: 1, DRIVER: 2, JOB_ID: 3, MSG_ID: 4, IMG: 5, OCR_TEXT: 6, PARSED: 7 };
var TICKETS_HEADER = ["เวลา", "รหัสคนขับ", "รหัสงาน", "LINE Message ID", "รูป", "ข้อความจาก OCR", "ค่าที่อ่านได้"];

// สถานะของงาน — เดินหน้าอย่างเดียว: สั่งงาน → แจ้งแล้ว → ได้ตั๋วแล้ว → ยืนยัน → นำเข้าแล้ว
var ST = {
  NEW: "สั่งงาน",
  NOTIFIED: "แจ้งแล้ว",
  TICKET: "ได้ตั๋วแล้ว",
  CONFIRMED: "ยืนยัน",       // พนักงานตรวจแล้ว — รอเว็บดึงไปบันทึก
  IMPORTED: "นำเข้าแล้ว",     // ฝั่งเว็บเขียนกลับ
  IMPORT_FAILED: "นำเข้าไม่ผ่าน", // ฝั่งเว็บเขียนกลับ พร้อมเหตุผลในคอลัมน์ผลนำเข้า
  CANCELLED: "ยกเลิก",
};
var ALL_STATUSES = [ST.NEW, ST.NOTIFIED, ST.TICKET, ST.CONFIRMED, ST.IMPORTED, ST.IMPORT_FAILED, ST.CANCELLED];

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
    .addItem("② ติดตั้งตัวตั้งเวลาแจ้งงาน 17:00 / 20:00", "installTriggers")
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
  ensureSheet_(ss, SHEET.LOG, ["เวลา", "ระดับ", "ข้อความ"]);

  // แท็บฐานข้อมูล — เว็บ TMS ส่งข้อมูลจริงมาเติมให้ทุกครั้งที่กด «ดึงงานเข้าเว็บ»
  // คอลัมน์: A ทะเบียนรถ · B ทะเบียนหาง · C รหัสลูกค้า · D สถานที่ · E ประเภทสินค้า
  ensureSheet_(ss, SHEET.MASTER, ["ทะเบียนรถ", "ทะเบียนหาง", "รหัสลูกค้า", "สถานที่", "ประเภทสินค้า"]);

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

  jobs.setFrozenRows(1);
  SpreadsheetApp.getUi().alert(
    "สร้างโครงชีตเรียบร้อย\n\nขั้นต่อไป: กดเมนู «② ติดตั้งตัวตั้งเวลาแจ้งงาน 17:00 / 20:00»\n" +
    "แล้วไปที่เว็บ TMS หน้า «งานจากไลน์» กดปุ่มดึงข้อมูล 1 ครั้ง เพื่อส่งรายชื่อรถ/ลูกค้า/คนขับมาเติม dropdown"
  );
}

// เวลาส่งแจ้งงาน — รอบหลักและรอบเก็บตก (นาฬิกา 24 ชม. เวลาไทย)
// รอบเก็บตกส่งเฉพาะแถวที่ยังเป็น «สั่งงาน» จึงไม่มีทางส่งซ้ำคนที่ได้รับรอบแรกไปแล้ว
var SEND_TIMES = ["17:00", "20:00"];
var ARM_HOUR = 15; // ชั่วโมงที่ตัวตั้งนัดทำงาน — ต้องมาก่อนรอบแรกอย่างน้อย 1 ชั่วโมง

/**
 * ติดตั้งตัวตั้งเวลา — ใช้ 2 ชั้นเพื่อความเสถียร
 *  ชั้นที่ 1: ทริกเกอร์รายวันช่วง 15:00-16:00 ทำหน้าที่ "ตั้งนาฬิกาปลุก" เวลา 17:00 และ 20:00 ตรงของวันนั้น
 *            (ทริกเกอร์รายวันของ Google เองบอกได้แค่ช่วงชั่วโมง จึงต้องตั้งนัดแบบเจาะเวลาอีกที)
 *  ชั้นที่ 2: ทริกเกอร์รายวันช่วง 17:00-18:00 และ 20:00-21:00 เรียกส่งซ้ำ — ถ้าชั้นแรกส่งไปแล้วจะไม่มีอะไรให้ส่ง
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
    "รอบหลัก 17:00 น. และรอบเก็บตก 20:00 น. (ไม่ส่งซ้ำคนที่แจ้งแล้ว)"
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
      var code = String(v[JC.DRIVER - 1]).trim();
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
        linePush_(d.userId, jobsMessage_("🚚 แจ้งงานล่วงหน้า", d.name || code, code, items));
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
  lines.push("📸 เมื่อรับงานได้ตั๋วแล้ว ถ่ายรูปตั๋วส่งกลับมาในแชทนี้ได้เลย");
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
  if (ev.type !== "message") return;

  if (ev.message.type === "text") {
    handleText_(ev, userId, String(ev.message.text || "").trim());
  } else if (ev.message.type === "image") {
    handleImage_(ev, userId);
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
  lineReply_(ev.replyToken,
    "คำสั่งที่ใช้ได้\n" +
    "• พิมพ์ «งานวันนี้» — ดูงานของท่านวันนี้\n" +
    "• พิมพ์ «งานพรุ่งนี้» — ดูงานล่วงหน้าของพรุ่งนี้\n" +
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
  lineReply_(replyToken, jobsMessage_("🚚 งาน" + label, (d && d.name) || code, code, items));
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

  // ดึงไฟล์ภาพจาก LINE แล้วเก็บเข้า Drive ทันที (ได้รูปไว้ก่อน OCR จะสำเร็จหรือไม่ก็ตาม)
  var blob = lineGetContent_(ev.message.id);
  var stamp = Utilities.formatDate(new Date(), TZ, "yyyyMMdd-HHmmss");
  blob.setName(stamp + "_" + code + "_" + ev.message.id + ".jpg");
  var folder = DriveApp.getFolderById(prop_("DRIVE_FOLDER_ID"));
  var file = folder.createFile(blob);
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
    // จับคู่กับงานของคนขับคนนี้ "วันนี้" ที่ยังไม่มีตั๋ว (เรียงตามลำดับแถวในชีต)
    var today = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");
    var target = jobsOnDateOf_(code, today, ST.NOTIFIED)[0] || jobsOnDateOf_(code, today, ST.NEW)[0] || null;
    var jobs = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.JOBS);
    var jobId = "";

    if (target) {
      jobId = String(target.v[JC.ID - 1]);
      // เติมเฉพาะช่องที่ยังว่าง — ไม่ทับข้อมูลที่ออฟฟิศกรอกไว้แล้ว
      fillIfEmpty_(jobs, target.row, JC.TICKET_NO, parsed.ticketNo);
      fillIfEmpty_(jobs, target.row, JC.W_ORIGIN, parsed.weightOrigin);
      fillIfEmpty_(jobs, target.row, JC.W_DEST, parsed.weightDest);
      jobs.getRange(target.row, JC.TICKET_IMG).setValue(imgUrl);
      jobs.getRange(target.row, JC.STATUS).setValue(ST.TICKET);
    }

    // ลงบันทึกแท็บตั๋วทุกครั้ง — ตรวจย้อนหลังได้เสมอ แม้จับคู่งานไม่ได้
    var tickets = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.TICKETS);
    tickets.appendRow([
      Utilities.formatDate(new Date(), TZ, "dd/MM/yyyy HH:mm:ss"),
      code, jobId || "(จับคู่ไม่ได้)", ev.message.id, imgUrl,
      ocrText.slice(0, 5000), JSON.stringify(parsed),
    ]);

    if (target) {
      var summary = ["📸 รับรูปตั๋วแล้ว [" + jobId + "]"];
      if (parsed.ticketNo) summary.push("เลขที่ตั๋ว: " + parsed.ticketNo);
      if (parsed.weightOrigin) summary.push("นน.ต้นทาง: " + parsed.weightOrigin + " ตัน");
      if (parsed.weightDest) summary.push("นน.ปลายทาง: " + parsed.weightDest + " ตัน");
      if (!parsed.ticketNo && !parsed.weightOrigin && !parsed.weightDest) {
        summary.push("(ระบบอ่านตัวเลขไม่ได้ ออฟฟิศจะอ่านจากรูปแทน)");
      }
      summary.push("\nขอบคุณครับ ✅ ออฟฟิศจะตรวจและยืนยันอีกครั้ง");
      lineReply_(ev.replyToken, summary.join("\n"));
    } else {
      lineReply_(ev.replyToken, "รับรูปไว้แล้ว แต่ไม่พบงานของท่านในวันนี้ ออฟฟิศจะตรวจสอบให้ครับ");
      notifyAdmin_("⚠ คนขับ " + code + " ส่งรูปตั๋วมา แต่ไม่พบงานของเขาวันนี้ — ดูที่แท็บ «ตั๋ว»");
    }
  } finally {
    lock.releaseLock();
  }
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
 * รองรับตั๋วชั่งทั่วไป: เลขที่ตั๋ว, น้ำหนักสุทธิ (กก. → แปลงเป็นตัน)
 */
function parseTicket_(text) {
  var out = { ticketNo: "", weightOrigin: "", weightDest: "", date: "" };
  if (!text) return out;
  var t = text.replace(/[，،]/g, ",");

  // เลขที่ตั๋ว: "เลขที่ ..." / "No. ..." / "Ticket ..."
  var m = t.match(/(?:เลขที่(?:ตั๋ว|บิล|เอกสาร)?|ticket\s*no\.?|no\.?)\s*[:：#]?\s*([A-Za-z0-9\/\-]{4,20})/i);
  if (m) out.ticketNo = m[1];

  // วันที่บนตั๋ว (ไว้ให้ออฟฟิศเทียบ ไม่ได้ใช้อัตโนมัติ)
  m = t.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
  if (m) out.date = m[1];

  // น้ำหนักสุทธิ: "น้ำหนักสุทธิ 30,540 กก." / "NET 30540"
  m = t.match(/(?:น้ำหนักสุทธิ|นน\.?สุทธิ|สุทธิ|net\s*(?:weight)?)\s*[:：]?\s*([\d,]+(?:\.\d+)?)/i);
  if (m) {
    var kg = Number(m[1].replace(/,/g, ""));
    if (kg > 0) {
      // เกิน 500 ถือว่าหน่วยเป็นกิโลกรัม แปลงเป็นตัน / ไม่เกินถือว่าเป็นตันอยู่แล้ว
      var tons = kg > 500 ? Math.round((kg / 1000) * 1000) / 1000 : kg;
      // ตั๋วชั่งส่วนใหญ่คือน้ำหนักขาขึ้นสินค้า — ใส่ช่องต้นทาง ออฟฟิศย้ายเองได้ถ้าเป็นขาลง
      out.weightOrigin = tons;
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

function linePush_(userId, text) {
  var res = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
    method: "post",
    contentType: "application/json",
    headers: lineHeaders_(),
    payload: JSON.stringify({ to: userId, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error("LINE push " + res.getResponseCode() + ": " + res.getContentText());
}

function lineReply_(replyToken, text) {
  var res = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/reply", {
    method: "post",
    contentType: "application/json",
    headers: lineHeaders_(),
    payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
    muteHttpExceptions: true,
  });
  // replyToken หมดอายุ (ตอบช้าเกิน 1 นาที) — ไม่ throw เพราะงานหลักสำเร็จแล้ว
  if (res.getResponseCode() >= 300) log_("WARN", "LINE reply " + res.getResponseCode() + ": " + res.getContentText());
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

function notifyAdmin_(text) {
  var admin = prop_("ADMIN_USER_ID");
  if (!admin) return;
  try {
    linePush_(admin, text);
  } catch (err) {
    log_("ERROR", "แจ้งผู้ดูแลไม่สำเร็จ: " + err);
  }
}

function testNotifyAdmin() {
  var admin = prop_("ADMIN_USER_ID");
  if (!admin) {
    SpreadsheetApp.getUi().alert("ยังไม่ได้ตั้ง ADMIN_USER_ID ใน Script Properties");
    return;
  }
  linePush_(admin, "✅ ทดสอบจากระบบสั่งงานคนขับ — การเชื่อมต่อ LINE ใช้งานได้");
  SpreadsheetApp.getUi().alert("ส่งข้อความทดสอบแล้ว — ตรวจดูในไลน์ของผู้ดูแล");
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

    // เติมรหัสงาน + สถานะเริ่มต้น เมื่อแถวเริ่มมีข้อมูลวันที่
    var dateVal = sh.getRange(row, JC.DATE).getValue();
    if (dateVal && !sh.getRange(row, JC.ID).getValue()) {
      sh.getRange(row, JC.ID).setValue(nextJobId_(sh, dateVal));
      if (!sh.getRange(row, JC.STATUS).getValue()) sh.getRange(row, JC.STATUS).setValue(ST.NEW);
    }
    // เติมชื่อคนขับจากรหัส
    if (e.range.getColumn() === JC.DRIVER) {
      var code = String(e.range.getValue()).trim().toUpperCase();
      var d = code ? driverLineIds_()[code] : null;
      sh.getRange(row, JC.DRIVER_NAME).setValue(d ? d.name : "");
    }
  } catch (err) {
    // simple trigger ห้าม throw — แค่ไม่เติมค่าอัตโนมัติ พนักงานกรอกเองได้
  }
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
  if (v instanceof Date) return Utilities.formatDate(v, TZ, "yyyy-MM-dd");
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
