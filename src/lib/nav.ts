export type NavItem = { href: string; label: string };
/** adminOnly = แสดงเฉพาะผู้ที่มีสิทธิ์ผู้ดูแลระบบ */
export type NavGroup = { title: string; icon: string; items: NavItem[]; adminOnly?: boolean };

export const NAV: NavGroup[] = [
  {
    title: "ภาพรวม",
    icon: "▦",
    items: [
      { href: "/", label: "หน้าหลัก" },
      { href: "/guide", label: "คู่มือการใช้งาน" },
    ],
  },
  {
    title: "บันทึกประจำวัน",
    icon: "✎",
    items: [
      { href: "/entry/jobs", label: "บันทึกงานขนส่ง" },
      { href: "/entry/advances", label: "เงินเดินทาง / ค่าทางด่วน" },
      { href: "/entry/expenses", label: "ค่าใช้จ่าย" },
      { href: "/entry/fuel", label: "การเติมน้ำมัน" },
    ],
  },
  {
    title: "รายงาน",
    icon: "📊",
    items: [
      { href: "/reports/company", label: "งบกำไรขาดทุนกิจการ" },
      { href: "/reports/vehicles", label: "กำไรขาดทุนรายคัน" },
      { href: "/reports/drivers", label: "กำไรขาดทุนราย พขร." },
      { href: "/reports/revenue", label: "รายงานรายได้" },
      { href: "/reports/expenses", label: "รายงานค่าใช้จ่าย" },
      { href: "/reports/allowance", label: "สรุปเบี้ยเลี้ยง พขร." },
      { href: "/reports/fuel-bonus", label: "เงินพิเศษค่าน้ำมัน" },
      { href: "/reports/partners", label: "จ่ายเงินรถร่วม" },
    ],
  },
  {
    title: "ฐานข้อมูล",
    icon: "🗄",
    items: [
      { href: "/db/vehicles", label: "ข้อมูลรถ" },
      { href: "/db/drivers", label: "ข้อมูลพนักงานขับรถ" },
      { href: "/db/pairings", label: "จับคู่รถ + พขร." },
      { href: "/db/customers", label: "ข้อมูลลูกค้า" },
      { href: "/db/routes", label: "เส้นทาง ระยะทาง ราคา" },
      { href: "/db/fuel-prices", label: "ราคาน้ำมันอ้างอิง" },
      { href: "/db/partners", label: "รถร่วม (outsource)" },
    ],
  },
  {
    title: "คลังอะไหล่",
    icon: "🔧",
    items: [
      { href: "/stock/balance", label: "สรุปคงเหลือ" },
      { href: "/stock/items", label: "รายการสินค้า" },
      { href: "/stock/units", label: "ทะเบียนยาง/แบตเตอรี่" },
      { href: "/stock/in", label: "รับเข้าสต็อก" },
      { href: "/stock/out", label: "เบิกใช้สต็อก" },
      { href: "/stock/bills", label: "ใบวางบิลอู่/ผู้ขาย" },
    ],
  },
  {
    title: "ตั้งค่า",
    icon: "⚙",
    items: [
      { href: "/settings", label: "ตั้งค่าระบบ" },
      { href: "/settings/fuel-basis", label: "เกณฑ์ราคาน้ำมันลูกค้า" },
      { href: "/settings/bands", label: "ช่วงราคาน้ำมัน" },
      { href: "/settings/lookups", label: "รายการตัวเลือก" },
    ],
  },
  {
    title: "ผู้ดูแลระบบ",
    icon: "🔐",
    adminOnly: true,
    items: [
      { href: "/admin/users", label: "จัดการผู้ใช้งาน" },
      { href: "/admin/login-log", label: "บันทึกการเข้าระบบ" },
    ],
  },
];
