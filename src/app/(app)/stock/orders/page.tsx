import { Card, Empty, Formula, PageHeader, Stat } from "@/components/ui";
import { DateRangeFilter, SelectFilter } from "@/components/Filters";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { formatThaiDate, formatThaiDateTime } from "@/lib/date";
import { readRange, readString, type SearchParams } from "@/lib/params";
import { ANS, PO_STOCK, thaiDay, loadOrders, orderState, shopTotal, syncShopOrdersIfStale } from "@/lib/shop-orders";
import { round2 } from "@/lib/calc";
import { CancelButton, PostButton, RefreshButton, type PostDefaults, type PostOptions } from "./OrdersClient";

export const dynamic = "force-dynamic";

const n = (v: number | null | undefined) => (v == null ? "-" : v.toLocaleString("th-TH", { maximumFractionDigits: 2 }));
const key = (s: string) => s.replace(/\s+/g, "").toLowerCase();

const STATUS_OPTIONS = [
  { value: "", label: "— ทุกสถานะ —" },
  { value: "wait", label: "⏳ รอร้านตอบ" },
  { value: "doing", label: "🔧 ร้านรับแล้ว กำลังทำ" },
  { value: "priced", label: "✅ เสร็จ รอลงบัญชี" },
  { value: "posted", label: "📗 ลงบัญชีแล้ว" },
  { value: "none", label: "❌ ร้านไม่มีของ" },
  { value: "cancelled", label: "🚫 ยกเลิก" },
];

/**
 * ใบสั่งงานร้านค้า — พนักงานสั่งผ่านไลน์ (#สั่ง) → ร้านตอบในแชทร้าน → แอดมินลงบัญชีที่นี่
 * เปิดหน้าแล้วดึงชีตให้เอง (ทุก 20 วินาที) ไม่ต้องกดปุ่ม
 */
export default async function ShopOrdersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const admin = isAdmin(user);
  const sync = await syncShopOrdersIfStale().catch((e) => ({ ok: false as const, error: String(e) }));
  const { from, to, fromStr, toStr } = readRange(sp);
  const shop = readString(sp, "shop");
  const status = readString(sp, "status");

  const [orders, shopNames, all] = await Promise.all([
    loadOrders({ shop, from, to, status }),
    prisma.shopOrder.findMany({ distinct: ["shopName"], select: { shopName: true }, orderBy: { shopName: "asc" } }),
    prisma.shopOrder.findMany({ include: { items: true } }),
  ]);
  const states = all.map((o) => orderState(o).key);
  const count = (k: string) => states.filter((s) => s === k).length;
  const postedInRange = round2(
    orders.flatMap((o) => o.items).reduce((a, i) => a + (i.postedAmount ?? 0), 0),
  );
  const shopSum = round2(orders.filter((o) => o.view.key === "priced" || o.view.key === "posted").reduce((a, o) => a + (shopTotal(o.items) ?? 0), 0));

  // ค่าที่ระบบรู้อยู่แล้ว เติมให้ในหน้าต่างลงบัญชี: ประวัติรายการชื่อเดียวกัน · ชื่อสินค้าในคลังที่ตรงกันทุกตัวอักษร
  let options: PostOptions | null = null;
  const defaults: Record<string, PostDefaults> = {};
  const pricedOrders = orders.filter((o) => o.view.key === "priced");
  if (admin && pricedOrders.length) {
    const [vehicles, cats, inv, history] = await Promise.all([
      prisma.vehicle.findMany({ where: { active: true }, select: { plate: true }, orderBy: { plate: "asc" } }),
      prisma.lookup.findMany({ where: { kind: "expenseCategory" }, orderBy: { sort: "asc" } }),
      prisma.inventoryItem.findMany({ select: { code: true, name: true, unit: true }, orderBy: { name: "asc" } }),
      prisma.shopOrderItem.findMany({ where: { postedAt: { not: null } }, orderBy: { postedAt: "desc" }, select: { description: true, postedCategory: true, postedItemCode: true } }),
    ]);
    options = {
      plates: vehicles.map((v) => v.plate),
      categories: cats.map((c) => c.value),
      items: inv.map((i) => ({ value: i.code, label: `${i.code} — ${i.name} (${i.unit})` })),
    };
    const invByName = new Map(inv.map((i) => [key(i.name), i.code]));
    for (const o of pricedOrders) {
      for (const it of o.items) {
        if (it.answer !== ANS.OK) continue;
        const prev = history.filter((h) => key(h.description) === key(it.description));
        defaults[String(it.id)] = {
          kind: o.target === PO_STOCK ? "stock" : "vehicle",
          plate: o.target === PO_STOCK ? "" : o.target,
          category: prev.find((h) => h.postedCategory)?.postedCategory ?? "",
          itemCode: prev.find((h) => h.postedItemCode)?.postedItemCode ?? invByName.get(key(it.description)) ?? "",
        };
      }
    }
  }

  return (
    <>
      <PageHeader
        title="ใบสั่งงานร้านค้า"
        subtitle="พนักงานสั่งผ่านไลน์ด้วย #สั่ง → ร้านกดรับ/แจ้งราคาในแชทร้าน → ตรวจแล้วกดลงบัญชี — ไม่มีเลขใบสั่งงาน = บริษัทไม่ได้สั่ง"
        actions={<RefreshButton />}
      />
      {sync && !sync.ok && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-bold text-amber-900">⚠️ {sync.error}</p>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="⏳ รอร้านตอบ" value={count("wait")} tone={count("wait") ? "warn" : "default"} hint="ทุกช่วงวันที่" />
        <Stat label="🔧 ร้านรับแล้ว กำลังทำ" value={count("doing")} hint="ทุกช่วงวันที่" />
        <Stat label="✅ เสร็จ รอลงบัญชี" value={count("priced")} tone={count("priced") ? "warn" : "default"} hint="ทุกช่วงวันที่" />
        <Stat label="📗 ลงบัญชีแล้ว (ช่วงที่เลือก)" value={`${n(postedInRange)} บาท`} tone="good" hint="รวมยอดที่ลงบัญชีของใบในตาราง" />
      </div>

      <div className="no-print card mb-4 flex flex-wrap items-end gap-3 p-3">
        <SelectFilter
          name="shop"
          label="ร้าน"
          value={shop}
          options={[{ value: "", label: "— ทุกร้าน —" }, ...shopNames.map((s) => ({ value: s.shopName, label: s.shopName }))]}
        />
        <DateRangeFilter from={fromStr} to={toStr} inline />
        <SelectFilter name="status" label="สถานะ" value={status} options={STATUS_OPTIONS} />
      </div>

      <Card bodyClass="p-0">
        {orders.length === 0 ? (
          <Empty>ไม่มีใบสั่งงานในช่วงที่เลือก</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>เลขใบสั่ง</th>
                  <th>สั่งเมื่อ</th>
                  <th>ผู้สั่ง</th>
                  <th>ร้าน</th>
                  <th>ลงที่</th>
                  <th>รายการ (ร้านตอบ)</th>
                  <th>สถานะ</th>
                  <th>
                    ราคา
                    <br />
                    ร้านแจ้ง
                  </th>
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const total = shopTotal(o.items);
                  const bills = (o.billUrls ?? "").split(/\n/).filter(Boolean);
                  return (
                    <tr key={o.id}>
                      <td className="whitespace-nowrap font-bold">{o.id}</td>
                      <td className="whitespace-nowrap">
                        {formatThaiDate(thaiDay(o.orderedAt))}
                        <div className="text-[12px] text-slate-500">{formatThaiDateTime(o.orderedAt).split(" ").pop()} น.</div>
                      </td>
                      <td className="min-w-[5.5rem]">
                        {o.orderedBy || o.staffName || o.staffCode}
                        {o.operatorName && <div className="text-[12px] text-slate-500">คนดำเนินการ: <b className="text-slate-700">{o.operatorName}</b></div>}
                      </td>
                      <td className="min-w-[6rem]">{o.shopName}</td>
                      <td className="whitespace-nowrap">{o.target === PO_STOCK ? "📦 เข้าคลัง" : `🚚 รถ ${o.target}`}</td>
                      <td className="min-w-[12rem] text-left text-[13px] leading-relaxed">
                        {o.items.map((it) => {
                          if (it.answer === ANS.FOUND) {
                            return (
                              <div key={it.id} className="text-amber-700">
                                🔍 {it.description} · {n(it.qty)} {it.unit ?? ""} — ร้านตรวจพบเพิ่ม (ยังไม่ได้สั่ง)
                              </div>
                            );
                          }
                          const mark = it.answer === ANS.OK ? "✅" : it.answer === ANS.NO ? "❌" : `${it.seq}.`;
                          const posted = it.expenseId != null ? ` · 📗 ค่าใช้จ่ายรถ ${it.postedTarget}` : it.stockInId != null ? ` · 📗 เข้าคลัง ${it.postedItemCode}` : "";
                          return (
                            <div key={it.id}>
                              {mark} {it.description} · {n(it.qty)} {it.unit ?? ""}
                              {it.answer === ANS.NO ? " — ร้านไม่มีของ" : it.shopPrice != null ? ` — ${n(it.shopPrice)}` : ""}
                              {posted && <span className="text-emerald-700">{posted}{it.postedAmount != null && it.postedAmount !== it.shopPrice ? ` (ลง ${n(it.postedAmount)})` : ""}</span>}
                            </div>
                          );
                        })}
                      </td>
                      <td className={`min-w-[7rem] text-[13px] font-bold ${o.view.tone}`}>
                        <div>
                          {o.view.icon} {o.view.label}
                        </div>
                        {o.view.key === "wait" && <div className="font-medium text-slate-500">(ส่งเมื่อ {formatThaiDateTime(o.orderedAt).split(" ").pop()})</div>}
                        {o.view.note && <div className="text-amber-700">⚠️ {o.view.note}</div>}
                        {o.pricedAt && <div className="font-medium text-slate-500">แจ้งราคา {formatThaiDate(o.pricedAt)}</div>}
                        {bills.map((b, i) => (
                          <div key={b}>
                            <a href={b} target="_blank" rel="noreferrer" className="font-medium underline">
                              📷 รูปบิล{bills.length > 1 ? ` ${i + 1}` : ""}
                            </a>
                          </div>
                        ))}
                      </td>
                      <td className="num whitespace-nowrap font-bold">{total == null ? "-" : n(total)}</td>
                      <td>
                        <div className="flex flex-wrap justify-center gap-1.5">
                          {admin && o.view.key === "priced" && options && (
                            <PostButton
                              order={{
                                id: o.id,
                                shopName: o.shopName,
                                target: o.target,
                                items: o.items
                                  .filter((it) => it.answer === ANS.OK)
                                  .map((it) => ({
                                    id: it.id,
                                    seq: it.seq,
                                    description: it.description,
                                    qty: it.qty,
                                    unit: it.unit,
                                    shopPrice: it.shopPrice,
                                    posted: it.expenseId != null || it.stockInId != null,
                                  })),
                              }}
                              options={options}
                              defaults={defaults}
                            />
                          )}
                          {admin && (o.view.key === "wait" || o.view.key === "doing") && <CancelButton id={o.id} />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7} className="text-right font-bold">
                    รวมราคาที่ร้านแจ้ง (ใบที่เสร็จแล้ว ตามตัวกรอง) — ใช้เทียบใบวางบิลของร้านสิ้นเดือน
                  </td>
                  <td className="num font-bold">{n(shopSum)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Formula>
        <b>สิ้นเดือน เทียบใบวางบิลของร้าน:</b> เลือกร้าน + ช่วงวันที่ ระบบรวมราคาที่ร้านแจ้งให้ด้านล่างตาราง
        – ✅ รายการในบิลที่มีใบสั่งงานและราคาตรง = จ่ายได้ – ⚠️ ราคาในบิลไม่ตรงกับที่ร้านแจ้ง = สอบถามร้าน
        – <b className="text-red-700">❌ รายการในบิลที่ไม่มีใบสั่งงาน = บริษัทไม่ได้สั่ง</b>
        <br />
        <b>ลงบัญชี:</b> รายการของรถ → หน้า ค่าใช้จ่าย (รายคัน) · รายการเข้าคลัง → รับเข้าคลัง (เป็นต้นทุนเมื่อเบิกใช้ จึงไม่นับซ้ำในค่าใช้จ่าย)
        · ยอดเงิน = ราคารวมที่ร้านแจ้ง ราคาต่อหน่วย = รวม ÷ จำนวน · ลงแล้วกดซ้ำไม่เกิดรายการซ้ำ
      </Formula>

      {admin && (
        <Card title="ตั้งค่าไลน์ (ผู้ดูแล)" className="mt-4">
          <ul className="space-y-1 text-[13px] leading-relaxed text-slate-700">
            <li>
              – <b>ร้าน / พนักงานสั่งของ:</b> กรอกรหัส+ชื่อ ในแท็บ «ร้านค้า» / «พนักงานสั่งของ» ของชีตสั่งงาน แล้วให้แต่ละคนพิมพ์{" "}
              <b>ลงทะเบียน &lt;รหัส&gt;</b> ในไลน์ «จัดซื้อ เทียมเทพ»
            </li>
            <li>
              – <b>คำสั่งในไลน์:</b> #สั่ง · #สั่งเข้าคลัง · #สถานะ · #ยกเลิก · #ช่วยเหลือ — « / » คั่นชื่อรายการกับจำนวนเสมอ
            </li>
            <li>
              – <b>เมนูร้าน</b> ตั้งไว้ใน LINE Official Account Manager ของบัญชีจัดซื้อ (ริชเมนู) — แก้รูป/ปุ่มที่นั่น
            </li>
          </ul>
        </Card>
      )}
    </>
  );
}
