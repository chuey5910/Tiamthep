"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { DateRangeFilter } from "@/components/Filters";
import { Badge, Card, Empty } from "@/components/ui";
import { allocateSatang, billingTotals, rateLabel } from "@/lib/billing";
import { baht, money, num } from "@/lib/format";
import { compareThaiFirst } from "@/lib/sort";
import { PRICE_UNITS } from "@/lib/price-unit";
import { cancelInvoice, createInvoice, createMissingRoutes, exportBillingExcel } from "./actions";

export type CustomerView = {
  customerId: number;
  code: string;
  name: string;
  legs: number;
  billedLegs: number;
  openLegs: number;
  openAmount: number;
  problemLegs: number;
  invoices: number;
  dueDate: string;
  dueDaySource: "ลูกค้า" | "ค่ากลาง";
  billingDayNote: string | null;
  overdue: boolean;
};

export type LineView = {
  jobId: number;
  date: string;
  plate: string;
  ticketOrigin: string | null;
  origin: string;
  destination: string;
  weightOrigin: number | null;
  weightDest: number | null;
  weightBasis: "น้ำหนักต้นทาง" | "น้ำหนักปลายทาง";
  priceUnit: string;
  rate: number | null;
  amount: number;
  vehicleType: string | null;
  issues: string[];
  fix: { href: string; label: string } | null;
  missingRoute: { origin: string; destination: string; vehicleType: string } | null;
  invoiceNo: string | null;
};

export type InvoiceView = {
  id: number;
  invoiceNo: string;
  billedAt: string;
  dueAt: string;
  period: string;
  legs: number;
  amount: number;
  billedBy: string | null;
  legsInRange: number;
};

export type PickedCustomer = {
  customerId: number;
  code: string;
  name: string;
  address: string | null;
  taxId: string | null;
  branch: string | null;
  creditDays: number;
  weightBasis: string;
};

/** ขาที่ติ๊กได้ = ยังไม่วางบิล และข้อมูลครบ */
const selectable = (l: LineView) => !l.invoiceNo && l.issues.length === 0;

export function BillingHub({
  customers,
  picked,
  lines,
  invoices,
  range,
  fromStr,
  toStr,
  customerFilter,
}: {
  customers: CustomerView[];
  picked: PickedCustomer | null;
  lines: LineView[];
  invoices: InvoiceView[];
  range: string;
  /** ช่วงวันที่ในรูปแบบ YYYY-MM-DD — ใช้ทำลิงก์ที่ไม่ทำให้ช่วงที่เลือกไว้หาย */
  fromStr: string;
  toStr: string;
  customerFilter: React.ReactNode;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [origin, setOrigin] = useState("");
  const [dest, setDest] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /** เส้นทางที่ขาด: คีย์ที่ติ๊กไว้ และหน่วยคิดราคาที่เลือกให้แต่ละเส้น */
  const [pickedRoutes, setPickedRoutes] = useState<Set<string>>(new Set());
  const [routeUnits, setRouteUnits] = useState<Record<string, string>>({});

  const originOptions = useMemo(
    () => [...new Set(lines.map((l) => l.origin))].sort(compareThaiFirst),
    [lines],
  );
  const destOptions = useMemo(
    () => [...new Set(lines.map((l) => l.destination))].sort(compareThaiFirst),
    [lines],
  );

  // เปลี่ยนลูกค้าหรือช่วงวันที่แล้ว ตัวกรองเดิมอาจไม่มีในรายการใหม่ — ถือว่า "ทุกที่" ไปเลย
  // ไม่งั้นตารางจะว่างเปล่าโดยไม่มีอะไรบอกว่าเพราะตัวกรองค้างอยู่
  const activeOrigin = originOptions.includes(origin) ? origin : "";
  const activeDest = destOptions.includes(dest) ? dest : "";

  const shown = useMemo(
    () =>
      lines.filter(
        (l) => (!activeOrigin || l.origin === activeOrigin) && (!activeDest || l.destination === activeDest),
      ),
    [lines, activeOrigin, activeDest],
  );

  // จัดกลุ่มตามปลายทาง — บริษัทเดียวอาจแยกวางบิลตามปลายทาง
  const groups = useMemo(() => {
    const m = new Map<string, LineView[]>();
    for (const l of shown) {
      const list = m.get(l.destination);
      if (list) list.push(l);
      else m.set(l.destination, [l]);
    }
    return [...m.entries()].sort((a, b) => compareThaiFirst(a[0], b[0]));
  }, [shown]);

  // ลำดับที่แสดงในตาราง — นับจากรายการทั้งหมดของลูกค้า ไม่ใช่ในกลุ่ม จะได้อ้างอิงตรงกันเสมอ
  const seqOf = useMemo(() => new Map(lines.map((l, i) => [l.jobId, i + 1])), [lines]);

  // ขาที่ติ๊กไว้ของลูกค้า/ช่วงก่อนหน้า ต้องไม่ติดมาด้วย ไม่งั้นยอดจะเพี้ยน
  const chosenLines = lines.filter((l) => chosen.has(l.jobId));
  const totals = billingTotals(chosenLines.map((l) => l.amount));

  // ยอดที่พิมพ์ในบิลของขาที่เลือก — เกลี่ยเศษสตางค์ให้บวกทุกบรรทัดได้เท่ายอดรวมพอดี
  const shownAmount = useMemo(() => {
    const m = new Map<number, number>();
    const allocated = allocateSatang(chosenLines.map((l) => l.amount));
    chosenLines.forEach((l, i) => m.set(l.jobId, allocated[i]));
    return m;
  }, [chosenLines]);
  /** ยอดของขานี้ที่ต้องแสดง — ขาที่เลือกใช้ยอดที่เกลี่ยแล้ว ขาที่ยังไม่เลือกปัดตามปกติ */
  const amountOf = (l: LineView) => shownAmount.get(l.jobId) ?? l.amount;
  /** เฉพาะขาที่ยังอยู่ในรายการจริง — ใช้กับทุกปุ่ม จะได้ไม่พาขาเก่าติดไปด้วย */
  const chosenIds = chosenLines.map((l) => l.jobId);
  /** ขาที่ติ๊กได้ "ในมุมมองที่กรองอยู่ตอนนี้" — ปุ่มเลือกทั้งหมดต้องทำงานกับสิ่งที่ตาเห็น */
  const openInView = shown.filter(selectable);

  // เส้นทางที่ยังไม่มีในระบบ รวมให้เหลือเส้นละแถว พร้อมนับว่ามีกี่ขาค้างอยู่เพราะเส้นนี้
  const missingRoutes = useMemo(() => {
    const m = new Map<string, { origin: string; destination: string; vehicleType: string; legs: number }>();
    for (const l of lines) {
      if (!l.missingRoute) continue;
      const k = `${l.missingRoute.origin}|${l.missingRoute.destination}|${l.missingRoute.vehicleType}`;
      const cur = m.get(k);
      if (cur) cur.legs += 1;
      else m.set(k, { ...l.missingRoute, legs: 1 });
    }
    return [...m.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.legs - a.legs || compareThaiFirst(a.destination, b.destination));
  }, [lines]);

  const addRoutes = () => {
    const items = missingRoutes
      .filter((r) => pickedRoutes.has(r.key))
      .map((r) => ({
        origin: r.origin,
        destination: r.destination,
        vehicleType: r.vehicleType,
        priceUnit: routeUnits[r.key] ?? "ต่อเที่ยว",
      }));
    setError(null);
    setDone(null);
    start(async () => {
      const res = await createMissingRoutes(items);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPickedRoutes(new Set());
      setDone(
        `สร้างเส้นทางแล้ว ${res.created} เส้น${res.skipped ? ` (ข้าม ${res.skipped} เส้นที่มีอยู่แล้ว)` : ""} — ` +
          "ขั้นต่อไปต้องไปตั้งราคาของแต่ละเส้น กดปุ่ม «ตั้งราคา» ที่ท้ายแถวในหน้าเส้นทาง",
      );
      router.refresh();
    });
  };

  const toggle = (jobId: number) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });

  const setMany = (ids: number[], on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const issue = () => {
    if (!picked) return;
    setError(null);
    setDone(null);
    start(async () => {
      const res = await createInvoice(picked.customerId, chosenIds);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setChosen(new Set());
      setDone(`ออกใบวางบิลแล้ว — เลขที่ ${res.invoiceNo}`);
      router.refresh();
    });
  };

  const download = () => {
    if (!picked) return;
    setError(null);
    start(async () => {
      const res = await exportBillingExcel(picked.customerId, chosenIds);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      );
      // ต้องแปะปุ่มลงหน้าเว็บก่อนกด ไม่งั้นเบราว์เซอร์ไม่ใช้ชื่อไฟล์ที่ตั้งไว้ (ได้ไฟล์ชื่อ "download")
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  };

  const cancel = (inv: InvoiceView) => {
    if (!confirm(`ยกเลิกใบวางบิล ${inv.invoiceNo}?\n\nขาทั้ง ${inv.legs} ขาในใบนี้จะกลับมาเป็น "ยังไม่วางบิล" ให้เลือกใหม่ได้`))
      return;
    setError(null);
    setDone(null);
    start(async () => {
      const res = await cancelInvoice(inv.id);
      if (!res.ok) setError(res.error);
      else {
        setDone(`ยกเลิกใบ ${inv.invoiceNo} แล้ว — ขาในใบนั้นกลับมาให้เลือกใหม่ได้`);
        router.refresh();
      }
    });
  };

  return (
    <>
      <Card title={`สถานะวางบิล — ${range}`} className="no-print mb-4" bodyClass="">
        {customers.length === 0 ? (
          <Empty>ยังไม่มีงานที่เรียกเก็บเงินในช่วงนี้</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>รหัส</th>
                  <th>ชื่อลูกค้า</th>
                  <th className="num">ขาทั้งหมด</th>
                  <th className="num">วางบิลแล้ว</th>
                  <th className="num">ยังค้าง</th>
                  <th className="num">ยอดที่ยังไม่วางบิล</th>
                  <th>ครบกำหนด</th>
                  <th>สถานะ</th>
                  <th className="no-print"></th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr
                    key={c.customerId}
                    className={c.overdue ? "bg-red-50 font-bold text-red-800" : undefined}
                  >
                    <td className="font-bold">{c.code}</td>
                    <td>{c.name}</td>
                    <td className="num">{c.legs}</td>
                    <td className="num">{c.billedLegs || "-"}</td>
                    <td className="num font-bold">{c.openLegs || "-"}</td>
                    <td className="num font-bold">{c.openLegs ? baht(c.openAmount) : "—"}</td>
                    <td className="whitespace-nowrap">
                      {c.dueDate}
                      {c.dueDaySource === "ลูกค้า" && (
                        <>
                          {" "}
                          <Badge tone="muted">ตั้งเฉพาะราย</Badge>
                        </>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      <StatusBadge c={c} />
                      {c.problemLegs > 0 && (
                        <>
                          {" "}
                          <Badge tone="warn">ข้อมูลไม่ครบ {c.problemLegs} ขา</Badge>
                        </>
                      )}
                    </td>
                    <td className="no-print">
                      <a
                        href={`?from=${fromStr}&to=${toStr}&customer=${c.customerId}`}
                        className={`btn px-2 py-1 text-[12px] ${c.overdue ? "btn-primary" : "btn-ghost"}`}
                      >
                        เปิดรายการ
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {customers.some((c) => c.billingDayNote && c.dueDaySource === "ค่ากลาง") && (
          <p className="border-t border-[var(--border)] px-4 py-2.5 text-[12px] font-medium text-amber-900">
            ⚠️ ลูกค้าบางรายเขียนวันรับวางบิลไว้เป็นข้อความ แต่ยังไม่ได้ตั้งเป็นตัวเลขให้ระบบรู้ — ระบบจึงใช้ค่ากลางไปก่อน
            <br />– ตั้งได้ที่ <a className="font-bold underline" href="/db/customers">ฐานข้อมูล → ข้อมูลลูกค้า</a> ช่อง
            «วันครบกำหนดวางบิล»
          </p>
        )}
      </Card>

      {error && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-800">
          ❌ {error}
        </p>
      )}
      {done && (
        <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] font-medium text-emerald-800">
          ✅ {done}
        </p>
      )}

      {invoices.length > 0 && (
        <Card title={`ใบวางบิลที่ออกแล้ว — ${picked?.code}`} className="no-print mb-4" bodyClass="">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>เลขที่ใบวางบิล</th>
                  <th>วันที่วางบิล</th>
                  <th>ครบกำหนดชำระ</th>
                  <th>ช่วงงาน</th>
                  <th className="num">ขา</th>
                  <th className="num">ค่าบรรทุก</th>
                  <th>ผู้บันทึก</th>
                  <th className="no-print"></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="font-bold">{inv.invoiceNo}</td>
                    <td className="whitespace-nowrap">{inv.billedAt}</td>
                    <td className="whitespace-nowrap">{inv.dueAt || "-"}</td>
                    <td className="whitespace-nowrap">{inv.period}</td>
                    <td className="num">{inv.legs}</td>
                    <td className="num font-bold">{money(inv.amount)}</td>
                    <td>{inv.billedBy ?? "-"}</td>
                    <td className="no-print">
                      <button
                        type="button"
                        className="btn btn-danger px-2 py-1 text-[12px]"
                        disabled={pending}
                        onClick={() => cancel(inv)}
                      >
                        ยกเลิก
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card
        title={picked ? `เลือกขาที่จะวางบิล — ${picked.code} ${picked.name}` : "เลือกขาที่จะวางบิล"}
        className="print:[&>header]:hidden"
        bodyClass=""
      >
        {/* ทุกตัวเลือกของการวางบิลอยู่แถวเดียวกัน — ลูกค้า · ช่วงวันที่ · ต้นทาง · ปลายทาง */}
        <div className="no-print flex flex-wrap items-end gap-3 border-b border-[var(--border)] p-3">
          {customerFilter}
          <DateRangeFilter from={fromStr} to={toStr} inline />
        </div>
        {picked && (originOptions.length > 1 || destOptions.length > 1) && (
          <div className="no-print flex flex-wrap items-end gap-3 p-3">
            {originOptions.length > 1 && (
              <div>
                <label className="lbl">ต้นทาง</label>
                <select className="inp w-56" value={activeOrigin} onChange={(e) => setOrigin(e.target.value)}>
                  <option value="">— ทุกต้นทาง ({originOptions.length} ที่) —</option>
                  {originOptions.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {destOptions.length > 1 && (
              <div>
                <label className="lbl">ปลายทาง</label>
                <select className="inp w-56" value={activeDest} onChange={(e) => setDest(e.target.value)}>
                  <option value="">— ทุกปลายทาง ({destOptions.length} ที่) —</option>
                  {destOptions.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {(activeOrigin || activeDest) && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setOrigin("");
                  setDest("");
                }}
              >
                ล้างตัวกรองเส้นทาง
              </button>
            )}
            <span className="pb-2 text-[12px] text-slate-500">
              – กรองแล้วเห็น {shown.length} จาก {lines.length} ขา · ลูกค้ารายนี้วิ่ง {originOptions.length} ต้นทาง{" "}
              {destOptions.length} ปลายทาง
            </span>
          </div>
        )}

        {!picked ? (
          <Empty>เลือกลูกค้าที่จะวางบิลจากช่องด้านบน หรือกดปุ่ม «เปิดรายการ» ที่แถวของลูกค้ารายนั้น</Empty>
        ) : lines.length === 0 ? (
          <Empty>ลูกค้ารายนี้ไม่มีงานที่เรียกเก็บเงินในช่วงวันที่ที่เลือก</Empty>
        ) : shown.length === 0 ? (
          <Empty>ไม่มีขาที่ตรงกับต้นทาง/ปลายทางที่กรองไว้ — กดล้างตัวกรองเส้นทางเพื่อดูทั้งหมด</Empty>
        ) : (
          <>
            {missingRoutes.length > 0 && (
              <div className="no-print mx-3 mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <div className="text-[14px] font-bold text-amber-900">
                  ⚠️ มี {missingRoutes.length} เส้นทางที่ยังไม่มีในฐานข้อมูล — ขาที่วิ่งเส้นนี้วางบิลไม่ได้
                </div>
                <p className="mt-0.5 text-[12px] font-medium text-amber-900">
                  – ติ๊กเลือกแล้วกดสร้างทีเดียว ไม่ต้องไปพิมพ์ชื่อทีละเส้น · ระบบสร้างให้แค่โครง{" "}
                  <b>ราคายังต้องไปตั้งเอง</b> (ระบบไม่เดาราคาแทน)
                </p>
                <div className="mt-2 overflow-x-auto rounded-lg border border-amber-200 bg-white">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th className="w-10">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={missingRoutes.length > 0 && pickedRoutes.size >= missingRoutes.length}
                            onChange={(e) =>
                              setPickedRoutes(e.target.checked ? new Set(missingRoutes.map((r) => r.key)) : new Set())
                            }
                          />
                        </th>
                        <th>ต้นทาง</th>
                        <th>ปลายทาง</th>
                        <th>ประเภทรถ</th>
                        <th className="num">ขาที่ค้าง</th>
                        <th>หน่วยคิดราคา</th>
                      </tr>
                    </thead>
                    <tbody>
                      {missingRoutes.map((r) => (
                        <tr key={r.key}>
                          <td>
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={pickedRoutes.has(r.key)}
                              onChange={() =>
                                setPickedRoutes((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(r.key)) next.delete(r.key);
                                  else next.add(r.key);
                                  return next;
                                })
                              }
                            />
                          </td>
                          <td>{r.origin}</td>
                          <td>{r.destination}</td>
                          <td className="text-slate-500">{r.vehicleType}</td>
                          <td className="num font-bold">{r.legs}</td>
                          <td>
                            <select
                              className="inp w-36 py-1 text-[13px]"
                              value={routeUnits[r.key] ?? "ต่อเที่ยว"}
                              onChange={(e) => setRouteUnits((prev) => ({ ...prev, [r.key]: e.target.value }))}
                            >
                              {PRICE_UNITS.map((u) => (
                                <option key={u} value={u}>
                                  {u}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={pending || pickedRoutes.size === 0}
                    onClick={addRoutes}
                  >
                    {pending ? "กำลังสร้าง…" : `+ สร้างเส้นทางที่เลือก (${pickedRoutes.size} เส้น)`}
                  </button>
                  <a href="/db/routes" target="_blank" rel="noopener" className="btn btn-ghost">
                    เปิดหน้าเส้นทางเพื่อตั้งราคา ↗
                  </a>
                </div>
              </div>
            )}

            <div className="no-print mx-3 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-[13px] font-bold text-brand-900">
              <span>
                ☑ เลือกไว้ <span className="text-[16px]">{chosenIds.length}</span> จาก {lines.length} ขา · ยอด{" "}
                <span className="text-[16px]">{money(totals.amount)}</span> บาท
              </span>
              <span className="flex-1" />
              <button
                type="button"
                className="btn btn-ghost px-2 py-1 text-[12px]"
                onClick={() => setMany(openInView.map((l) => l.jobId), true)}
              >
                {activeOrigin || activeDest ? "เลือกทั้งหมดที่กรองอยู่" : "เลือกทั้งหมดที่ยังไม่วางบิล"} ({openInView.length})
              </button>
              <button
                type="button"
                className="btn btn-ghost px-2 py-1 text-[12px]"
                onClick={() => setChosen(new Set())}
              >
                ล้างที่เลือก
              </button>
              <button type="button" className="btn btn-primary" disabled={pending || chosenIds.length === 0} onClick={issue}>
                {pending ? "กำลังบันทึก…" : `🧾 ออกใบวางบิลจากที่เลือก (${chosenIds.length} ขา)`}
              </button>
            </div>

            <div className="no-print flex flex-wrap items-center gap-2 px-3 pb-3">
              <button type="button" className="btn btn-primary" disabled={pending || chosenIds.length === 0} onClick={download}>
                ⬇ Export Excel
              </button>
              <button type="button" className="btn btn-primary" data-print disabled={chosenIds.length === 0}>
                📄 Export PDF / พิมพ์
              </button>
              <span className="text-[12px] text-slate-500">
                – ไฟล์และใบที่พิมพ์ออกเฉพาะขาที่ติ๊กเลือก · PDF ให้เลือก «บันทึกเป็น PDF» ในหน้าต่างพิมพ์
              </span>
            </div>

            {/* หัวใบวางบิล — โผล่เฉพาะตอนสั่งพิมพ์ */}
            <div className="hidden px-4 pb-3 print:block">
              <div className="text-[15px] font-bold">
                ใบวางบิล — {picked.code} {picked.name}
              </div>
              <div className="text-[12px] leading-relaxed">
                {picked.address && <>ที่อยู่: {picked.address}<br /></>}
                เลขประจำตัวผู้เสียภาษี: {picked.taxId ?? "-"} · สาขา: {picked.branch ?? "-"} · เครดิต{" "}
                {picked.creditDays} วัน
                <br />
                งานช่วง {range} · รวม {chosenIds.length} ขา · คิดเงินตาม{picked.weightBasis}
              </div>
            </div>

            <div className="overflow-x-auto print:hidden">
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="no-print w-10">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={openInView.length > 0 && openInView.every((l) => chosen.has(l.jobId))}
                        onChange={(e) => setMany(openInView.map((l) => l.jobId), e.target.checked)}
                      />
                    </th>
                    <th>ลำดับ</th>
                    <th>วันที่</th>
                    <th>ทะเบียนรถ</th>
                    <th>เลขที่ตั๋วต้นทาง</th>
                    <th>ต้นทาง</th>
                    <th>ปลายทาง</th>
                    <th className="num">น้ำหนักต้นทาง</th>
                    <th className="num">น้ำหนักปลายทาง</th>
                    <th className="num">ราคา/หน่วย</th>
                    <th className="num">ค่าบรรทุก (บาท)</th>
                    <th className="no-print">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(([destination, rows]) => {
                    const ids = rows.filter(selectable).map((l) => l.jobId);
                    const all = ids.length > 0 && ids.every((id) => chosen.has(id));
                    const groupAmount = rows
                      .filter((l) => chosen.has(l.jobId))
                      .reduce((a, l) => a + amountOf(l), 0);
                    return (
                      <GroupRows
                        key={destination}
                        destination={destination}
                        rows={rows}
                        allChecked={all}
                        canCheck={ids.length > 0}
                        chosenAmount={groupAmount}
                        onToggleGroup={(on) => setMany(ids, on)}
                        chosen={chosen}
                        onToggle={toggle}
                        seqOf={seqOf}
                        amountOf={amountOf}
                      />
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="no-print" />
                    <td colSpan={6}>
                      รวมที่เลือก {chosenIds.length} ขา (จากทั้งหมด {lines.length} ขา)
                    </td>
                    <td className="num">
                      {picked.weightBasis === "น้ำหนักต้นทาง"
                        ? num(chosenLines.reduce((a, l) => a + (l.weightOrigin ?? 0), 0), 3)
                        : ""}
                    </td>
                    <td className="num">
                      {picked.weightBasis === "น้ำหนักปลายทาง"
                        ? num(chosenLines.reduce((a, l) => a + (l.weightDest ?? 0), 0), 3)
                        : ""}
                    </td>
                    <td className="num">—</td>
                    <td className="num">{money(totals.amount)}</td>
                    <td className="no-print" />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* ใบวางบิลสำหรับพิมพ์ — เฉพาะขาที่เลือก เรียงตามวันที่ และนับลำดับใหม่ให้เรียงสวย */}
            <table className="tbl hidden print:table">
              <thead>
                <tr>
                  <th>ลำดับ</th>
                  <th>วันที่</th>
                  <th>ทะเบียนรถ</th>
                  <th>เลขที่ตั๋วต้นทาง</th>
                  <th>ต้นทาง</th>
                  <th>ปลายทาง</th>
                  <th className="num">น้ำหนักต้นทาง</th>
                  <th className="num">น้ำหนักปลายทาง</th>
                  <th className="num">ราคา/หน่วย</th>
                  <th className="num">ค่าบรรทุก (บาท)</th>
                </tr>
              </thead>
              <tbody>
                {chosenLines.map((l, i) => (
                  <tr key={l.jobId}>
                    <td>{i + 1}</td>
                    <td className="whitespace-nowrap">{l.date}</td>
                    <td className="whitespace-nowrap">{l.plate}</td>
                    <td className="whitespace-nowrap">{l.ticketOrigin ?? "-"}</td>
                    <td>{l.origin}</td>
                    <td>{l.destination}</td>
                    <td className="num">{l.weightOrigin != null ? num(l.weightOrigin, 3) : "-"}</td>
                    <td className="num">{l.weightDest != null ? num(l.weightDest, 3) : "-"}</td>
                    <td className="num">{rateLabel(l.priceUnit, l.rate)}</td>
                    <td className="num">{money(amountOf(l))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6}>รวม {totals.legs} ขา</td>
                  <td className="num">{num(chosenLines.reduce((a, l) => a + (l.weightOrigin ?? 0), 0), 3)}</td>
                  <td className="num">{num(chosenLines.reduce((a, l) => a + (l.weightDest ?? 0), 0), 3)}</td>
                  <td className="num">—</td>
                  <td className="num">{money(totals.amount)}</td>
                </tr>
              </tfoot>
            </table>

            {/* ท้ายบิลมีบรรทัดเดียว — ค่าบรรทุกรวม ไม่มี VAT ไม่มีหัก ณ ที่จ่าย */}
            <div className="print-keep p-4">
              <dl className="ml-auto w-full max-w-sm text-[14px]">
                <div className="flex justify-between gap-3 rounded-lg bg-brand-50 px-3 py-2">
                  <dt className="text-[14px] font-bold text-brand-900">ค่าบรรทุกรวม ({totals.legs} ขา)</dt>
                  <dd className="text-[16px] font-extrabold text-brand-900">{money(totals.amount)}</dd>
                </div>
              </dl>
              {/* ช่องเซ็น — กระดาษแนวตั้งกว้าง 17 ซม. วางสองช่องเรียงกัน ชื่อบนวันที่ล่าง */}
              <div className="hidden pt-10 text-[11px] print:grid print:grid-cols-2 print:gap-10">
                <div>
                  <div>ผู้วางบิล ........................................</div>
                  <div className="pt-5">วันที่ ........................................</div>
                </div>
                <div>
                  <div>ผู้รับวางบิล ........................................</div>
                  <div className="pt-5">วันที่ ........................................</div>
                </div>
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}

function StatusBadge({ c }: { c: CustomerView }) {
  if (c.openLegs === 0) return <Badge tone="ok">ครบแล้ว · {c.invoices} ใบ</Badge>;
  if (c.billedLegs > 0) return <Badge tone="error">วางบิลบางส่วน · ค้าง {c.openLegs} ขา</Badge>;
  return <Badge tone={c.overdue ? "error" : "warn"}>ยังไม่วางบิล</Badge>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-dashed border-[var(--border)] py-1.5">
      <dt className="text-[13px] text-slate-600">{label}</dt>
      <dd className="text-[13px] font-bold text-slate-900">{value}</dd>
    </div>
  );
}

function GroupRows({
  destination,
  rows,
  allChecked,
  canCheck,
  chosenAmount,
  onToggleGroup,
  chosen,
  onToggle,
  seqOf,
  amountOf,
}: {
  destination: string;
  rows: LineView[];
  allChecked: boolean;
  canCheck: boolean;
  chosenAmount: number;
  onToggleGroup: (on: boolean) => void;
  chosen: Set<number>;
  onToggle: (jobId: number) => void;
  seqOf: Map<number, number>;
  /** ยอดที่ต้องพิมพ์ในบิล (เกลี่ยเศษสตางค์แล้ว) */
  amountOf: (l: LineView) => number;
}) {
  const open = rows.filter(selectable).length;
  return (
    <>
      <tr className="bg-slate-100">
        <td className="no-print">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={allChecked}
            disabled={!canCheck}
            onChange={(e) => onToggleGroup(e.target.checked)}
          />
        </td>
        <td colSpan={11} className="text-[13px] font-bold">
          ปลายทาง {destination} — {rows.length} ขา · ยังไม่วางบิล {open} ขา
          {chosenAmount > 0 && <> · เลือกแล้ว {money(chosenAmount)} บาท</>}
        </td>
      </tr>
      {rows.map((l) => {
        const picked = chosen.has(l.jobId);
        const bad = l.issues.length > 0;
        return (
          <tr
            key={l.jobId}
            className={bad ? "bg-red-50" : l.invoiceNo ? "text-slate-500" : undefined}
          >
            <td className="no-print">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={picked}
                disabled={!selectable(l)}
                onChange={() => onToggle(l.jobId)}
              />
            </td>
            <td>{seqOf.get(l.jobId)}</td>
            <td className="whitespace-nowrap">{l.date}</td>
            <td className="whitespace-nowrap">{l.plate}</td>
            <td className="whitespace-nowrap font-mono text-[12px]">{l.ticketOrigin ?? "-"}</td>
            <td>{l.origin}</td>
            <td>{l.destination}</td>
            <td className={`num ${l.weightBasis === "น้ำหนักต้นทาง" ? "font-bold" : "text-slate-500"}`}>
              {l.weightOrigin != null ? num(l.weightOrigin, 3) : "-"}
            </td>
            <td className={`num ${l.weightBasis === "น้ำหนักปลายทาง" ? "font-bold" : "text-slate-500"}`}>
              {l.weightDest != null ? num(l.weightDest, 3) : "-"}
            </td>
            <td className="num">{rateLabel(l.priceUnit, l.rate)}</td>
            <td className={`num font-bold ${bad ? "text-red-700" : ""}`}>{money(amountOf(l))}</td>
            <td className="no-print whitespace-nowrap">
              {bad ? (
                <>
                  <span title={l.issues.join(" · ")}>
                    <Badge tone="error">{shortIssue(l.issues[0])}</Badge>
                  </span>{" "}
                  {l.fix && (
                    <a
                      href={l.fix.href}
                      target="_blank"
                      rel="noopener"
                      title={`${l.issues.join(" · ")} — เปิดในแท็บใหม่`}
                      className="btn btn-primary px-2 py-1 text-[12px]"
                    >
                      {l.fix.label} ↗
                    </a>
                  )}
                </>
              ) : l.invoiceNo ? (
                <Badge tone="ok">วางบิลแล้ว {l.invoiceNo}</Badge>
              ) : null}
            </td>
          </tr>
        );
      })}
    </>
  );
}

/** ย่อคำเตือนให้พอดีป้าย — ข้อความเต็มอยู่ใน title ของป้าย */
function shortIssue(message: string): string {
  if (message.includes("ยังไม่ได้ตั้งราคาลูกค้า")) return "ยังไม่ได้ตั้งราคา";
  if (message.includes("สูงผิดปกติ — น่าจะกรอกเป็นกิโลกรัม") || message.includes("ตัน สูงผิดปกติ"))
    return "น้ำหนักผิดหน่วย";
  if (message.includes("ไม่พบเส้นทาง")) return "ไม่พบเส้นทาง";
  if (message.includes("มีซ้ำ")) return "เส้นทางซ้ำ";
  if (message.includes("แต่ยังไม่ได้กรอก")) return "ยังไม่กรอกน้ำหนัก";
  if (message.includes("ผิดปกติ")) return "ราคา/หน่วยผิด";
  return "ข้อมูลไม่ครบ";
}
