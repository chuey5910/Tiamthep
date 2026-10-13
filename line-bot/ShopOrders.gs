/**
 * ═══════════════════════════════════════════════════════════════
 * ไลน์บอท — ส่วนใบสั่งงานร้านค้า (ไฟล์ที่ 2 ของโปรเจกต์ Apps Script)
 * ═══════════════════════════════════════════════════════════════
 *
 * แยกจาก Code.gs เพราะ Apps Script บันทึกได้ไฟล์ละไม่เกินราว 100,000 ตัวอักษร
 * ติดตั้ง: ในหน้า Apps Script กด ＋ ข้างคำว่า «ไฟล์» › สคริปต์ › ตั้งชื่อ ShopOrders แล้ววางไฟล์นี้
 * ใช้ฟังก์ชัน/ค่าคงที่ของ Code.gs ร่วมกัน (ไฟล์ในโปรเจกต์เดียวกันมองเห็นกันหมด)
 */

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

// ชื่อแท็บของระบบนี้ — ไม่เพิ่มเข้า SHEET ของ Code.gs ตอนโหลดไฟล์ เพราะ Apps Script โหลดไฟล์ตามลำดับในโปรเจกต์
// ถ้าไฟล์นี้ถูกโหลดก่อน Code.gs ตัวแปร SHEET ยังไม่มี (ข้ามไฟล์ใช้กันได้เฉพาะตอนฟังก์ชันทำงาน)
var PO_TAB = { PO: "ใบสั่งงานร้าน", SHOPS: "ร้านค้า", STAFF: "พนักงานสั่งของ" };

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
  ensureSheet_(ss, PO_TAB.SHOPS, SHOPS_HEADER);
  ensureSheet_(ss, PO_TAB.STAFF, STAFF_HEADER);
  SpreadsheetApp.getUi().alert(
    "สร้างแท็บ «ใบสั่งงานร้าน» «ร้านค้า» «พนักงานสั่งของ» เรียบร้อย\n\n" +
    "1. กรอกรหัส+ชื่อ ในแท็บ «ร้านค้า» (เช่น S01) และ «พนักงานสั่งของ» (เช่น M01)\n" +
    "2. ให้แต่ละคนพิมพ์ «ลงทะเบียน <รหัส>» ในไลน์บริษัท\n" +
    "3. ติดตั้งเมนูร้านในไลน์: เว็บ › ใบสั่งงานร้านค้า › ปุ่ม «ติดตั้งเมนูร้านในไลน์» (ครั้งเดียว)"
  );
}

function poSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(PO_TAB.PO);
  if (sh) return sh;
  sh = ensureSheet_(ss, PO_TAB.PO, PO_HEADER);
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
  var staff = partyByCode_(PO_TAB.STAFF, code);
  var shop = partyByCode_(PO_TAB.SHOPS, code);
  var hits = (inDrivers ? 1 : 0) + (staff ? 1 : 0) + (shop ? 1 : 0);
  if (hits > 1) {
    lineReply_(replyToken, "❌ รหัส " + code + " ซ้ำกันหลายแท็บ (คนขับ / พนักงานสั่งของ / ร้านค้า) — แจ้งออฟฟิศให้แก้รหัสไม่ให้ซ้ำ แล้วลงทะเบียนใหม่");
    return;
  }
  if (shop) return registerParty_(replyToken, userId, code, PO_TAB.SHOPS);
  if (staff) return registerParty_(replyToken, userId, code, PO_TAB.STAFF);
  registerDriver_(replyToken, userId, code);
}

/** ผูกไลน์กับรหัสร้าน/พนักงาน — 1 รหัส 1 ไลน์ · 1 ไลน์ 1 รหัสต่อแท็บ (กติกาเดียวกับคนขับ) */
function registerParty_(replyToken, userId, code, tab) {
  var isShop = tab === PO_TAB.SHOPS;
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

  var shop = partyOf_(PO_TAB.SHOPS, userId);
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
  var shops = partyRows_(PO_TAB.SHOPS);
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
  var staff = partyOf_(PO_TAB.STAFF, userId);
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
  var staff = partyOf_(PO_TAB.STAFF, userId);
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
  var staff = partyOf_(PO_TAB.STAFF, userId);
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
  var shop = partyOf_(PO_TAB.SHOPS, userId);
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
  var shop = partyOf_(PO_TAB.SHOPS, userId);
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
