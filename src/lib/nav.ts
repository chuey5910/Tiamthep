/** icon = อีโมจิหน้าหัวข้อของหน้านั้น (ไม่ใส่จะใช้ของกลุ่ม) */
export type NavItem = { href: string; label: string; icon?: string };
/** adminOnly = แสดงเฉพาะผู้ที่มีสิทธิ์ผู้ดูแลระบบ */
export type NavGroup = { title: string; icon: string; items: NavItem[]; adminOnly?: boolean };

export const NAV: NavGroup[] = [
  {
    title: "ภาพรวม",
    icon: "▦",
    items: [
      { href: "/", icon: "🏠", label: "หน้าหลัก" },
      { href: "/guide", icon: "📖", label: "คู่มือการใช้งาน" },
    ],
  },
  {
    title: "บันทึกประจำวัน",
    icon: "✎",
    items: [
      { href: "/entry/jobs", icon: "🚚", label: "บันทึกงานขนส่ง" },
      { href: "/entry/line-jobs", icon: "💬", label: "งานจากไลน์ (ชีตสั่งงาน)" },
      { href: "/entry/advances", icon: "💵", label: "เงินเดินทาง / ค่าทางด่วน" },
      { href: "/entry/expenses", icon: "🧾", label: "ค่าใช้จ่าย" },
      { href: "/entry/fuel", icon: "⛽", label: "การเติมน้ำมัน" },
    ],
  },
  {
    title: "รายงาน",
    icon: "📊",
    items: [
      { href: "/reports/company", icon: "📈", label: "งบกำไรขาดทุนกิจการ" },
      { href: "/reports/vehicles", icon: "🚛", label: "กำไรขาดทุนรายคัน" },
      { href: "/reports/drivers", icon: "👷", label: "กำไรขาดทุนราย พขร." },
      { href: "/reports/revenue", icon: "💰", label: "รายงานรายได้" },
      { href: "/reports/expenses", icon: "📉", label: "รายงานค่าใช้จ่าย" },
      { href: "/reports/allowance", icon: "🍱", label: "สรุปเบี้ยเลี้ยง พขร." },
      { href: "/reports/fuel-bonus", icon: "🎁", label: "เงินพิเศษค่าน้ำมัน" },
      { href: "/reports/partners", icon: "🤝", label: "จ่ายเงินรถร่วม" },
    ],
  },
  {
    title: "ฐานข้อมูล",
    icon: "🗄",
    items: [
      { href: "/db/vehicles", icon: "🚛", label: "ข้อมูลรถ" },
      { href: "/db/drivers", icon: "👷", label: "ข้อมูลพนักงานขับรถ" },
      { href: "/db/pairings", icon: "🔗", label: "จับคู่รถ + พขร." },
      { href: "/db/customers", icon: "🏢", label: "ข้อมูลลูกค้า" },
      { href: "/db/routes", icon: "🗺️", label: "เส้นทาง ระยะทาง ราคา" },
      { href: "/db/fuel-prices", icon: "⛽", label: "ราคาน้ำมันอ้างอิง" },
      { href: "/db/partners", icon: "🤝", label: "รถร่วม (outsource)" },
    ],
  },
  {
    title: "คลังอะไหล่",
    icon: "🔧",
    items: [
      { href: "/stock/balance", icon: "📦", label: "สรุปคงเหลือ" },
      { href: "/stock/items", icon: "🧰", label: "รายการสินค้า" },
      { href: "/stock/units", icon: "🛞", label: "ทะเบียนยาง/แบตเตอรี่" },
      { href: "/stock/in", icon: "📥", label: "รับเข้าสต็อก" },
      { href: "/stock/out", icon: "📤", label: "เบิกใช้สต็อก" },
      { href: "/stock/bills", icon: "🧾", label: "ใบวางบิลอู่/ผู้ขาย" },
    ],
  },
  {
    title: "ตั้งค่า",
    icon: "⚙",
    items: [
      { href: "/settings", icon: "⚙️", label: "ตั้งค่าระบบ" },
      { href: "/settings/fuel-basis", icon: "📐", label: "เกณฑ์ราคาน้ำมันลูกค้า" },
      { href: "/settings/bands", icon: "📊", label: "ช่วงราคาน้ำมัน" },
      { href: "/settings/lookups", icon: "📋", label: "รายการตัวเลือก" },
    ],
  },
  {
    title: "ผู้ดูแลระบบ",
    icon: "🔐",
    adminOnly: true,
    items: [
      { href: "/admin/users", icon: "👥", label: "จัดการผู้ใช้งาน" },
      { href: "/admin/employees", icon: "🪪", label: "ทะเบียนพนักงาน (สิทธิ์สมัคร)" },
      { href: "/admin/login-log", icon: "🕒", label: "บันทึกการเข้าระบบ" },
    ],
  },
];
