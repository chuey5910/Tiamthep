import { redirect } from "next/navigation";

/** รวมเข้าหน้า «คลังอะไหล่» แล้ว — ลิงก์เก่ายังใช้ได้ ไม่ให้ใครเจอ 404 */
export default function Page() {
  redirect("/stock/items");
}
