import Link from "next/link";
import { FitScreen } from "@/components/FitScreen";
import { FitText } from "@/components/FitText";
import { requireAdmin } from "@/lib/auth";
import { endOfMonth, utcDate } from "@/lib/date";
import { round2 } from "@/lib/calc";
import { readInt, type SearchParams } from "@/lib/params";
import { prisma } from "@/lib/prisma";
import { companyPnl, loadPeriod } from "@/lib/reports";
import { RoadChart } from "./RoadChart";
import s from "./dashboard.module.css";

export const dynamic = "force-dynamic";

const M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const fmt = (n: number) => Math.round(n).toLocaleString("th-TH");
const signed = (n: number) => `${n < 0 ? "−" : ""}${fmt(Math.abs(n))}`;

type Month = { revenue: number; cost: number; profit: number };

/** ตัวเลขของเดือน — เครื่องคำนวณเดียวกับหน้า «งบกำไรขาดทุนกิจการ» ตัวเลขจึงตรงกันเสมอ */
async function monthPnl(y: number, m: number): Promise<Month> {
  const p = companyPnl(await loadPeriod({ from: utcDate(y, m, 1), to: endOfMonth(y, m) }));
  return { revenue: p.totalRevenue, cost: p.totalCost, profit: p.netProfit };
}

/**
 * แดชบอร์ดกิจการ — รายได้ · ค่าใช้จ่าย · กำไรสุทธิ ทุกเดือนของปี ในจอเดียว ไม่ต้องเลื่อน
 * กดที่รถ/กล่องของเดือนไหน เปิดงบกำไรขาดทุนของเดือนนั้น
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // เห็นเฉพาะผู้ดูแลระบบ (เจ้าของสั่ง) — คนอื่นพิมพ์ลิงก์ตรงก็ถูกพากลับหน้าหลัก
  await requireAdmin();
  const sp = await searchParams;
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  const year = Math.min(curY, Math.max(2000, readInt(sp, "year", curY) || curY));
  // เดือนที่ผ่านมาแล้ว (ปีนี้ = ถึงเดือนปัจจุบัน) — เดือนข้างหน้ายังไม่เกิด ไม่คำนวณ
  const lastMonth = year < curY ? 12 : curM;

  const [months, prevMonths, first] = await Promise.all([
    Promise.all(Array.from({ length: 12 }, (_, i) => (i + 1 <= lastMonth ? monthPnl(year, i + 1) : null))),
    Promise.all(Array.from({ length: lastMonth }, (_, i) => monthPnl(year - 1, i + 1))),
    prisma.job.findFirst({ orderBy: { loadDate: "asc" }, select: { loadDate: true } }),
  ]);

  const firstYear = Math.min(year, first?.loadDate.getUTCFullYear() ?? curY);
  const years = Array.from({ length: curY - firstYear + 1 }, (_, i) => firstYear + i).slice(-4);

  const has = (m: Month | null): m is Month => !!m && (m.revenue !== 0 || m.cost !== 0);
  const withData = months.map((m, i) => ({ m, i })).filter((x): x is { m: Month; i: number } => has(x.m));
  const revenue = round2(withData.reduce((a, x) => a + x.m.revenue, 0));
  const cost = round2(withData.reduce((a, x) => a + x.m.cost, 0));
  const profit = round2(revenue - cost);
  const margin = revenue > 0 ? profit / revenue : 0;
  const n = withData.length;

  const best = n ? withData.reduce((a, b) => (b.m.profit > a.m.profit ? b : a)) : null;
  const worst = n ? withData.reduce((a, b) => (b.m.profit < a.m.profit ? b : a)) : null;
  // เทียบปีก่อน: เดือนเดียวกัน (ม.ค. ถึงเดือนล่าสุด) — ปีก่อนไม่มีข้อมูล = บอกตรงๆ ไม่เทียบ
  const thisSame = round2(months.slice(0, lastMonth).reduce((a, m) => a + (m?.profit ?? 0), 0));
  const prevSame = round2(prevMonths.reduce((a, m) => a + m.profit, 0));
  const prevHas = prevMonths.some(has);
  const yoy = prevHas && prevSame !== 0 ? (thisSame - prevSame) / Math.abs(prevSame) : null;
  const span = lastMonth === 1 ? M[0] : `${M[0]}–${M[lastMonth - 1]}`;

  const monthHref = (i: number) => `/reports/company?year=${year}&month=${i + 1}`;
  const isNow = (i: number) => year === curY && i + 1 === curM;

  // ช่องเดือนที่มีตัวเลขกว้างกว่า ช่องที่ไม่มีรายการ/ยังไม่ถึงแคบลง — ตัวเลขจะได้ใหญ่ อ่านง่าย
  const GAP = 5;
  const weights = months.map((m) => (has(m) ? 1 : 0.5));

  const ring = (p: number) => {
    const r = 40;
    const c = 2 * Math.PI * r;
    const shown = Math.max(0, Math.min(1, p));
    const label = `${(p * 100).toFixed(1)}%`;
    return (
      <svg width="78" height="78" viewBox="0 0 104 104" style={{ flex: "none" }}>
        <circle cx="52" cy="52" r={r} fill="none" stroke="#e8fbf3" strokeWidth="13" />
        <circle cx="52" cy="52" r={r} fill="none" stroke={p < 0 ? "#ff5a5f" : "#12b886"} strokeWidth="13" strokeLinecap="round" strokeDasharray={`${c * shown} ${c}`} transform="rotate(-90 52 52)" />
        <text x="52" y="51" textAnchor="middle" fontSize={Math.min(22, 84 / (label.length * 0.62))} fontWeight="800" fill="#1b1440">
          {label}
        </text>
        <text x="52" y="70" textAnchor="middle" fontSize="12" fill="#6b6390">อัตรากำไร</text>
      </svg>
    );
  };

  const spark = (vals: number[]) => {
    if (vals.length < 2) return null;
    const mx = Math.max(...vals);
    const mn = Math.min(...vals);
    const pts = vals.map((v, i) => `${(i * 200) / (vals.length - 1)},${34 - ((v - mn) / (mx - mn || 1)) * 28}`).join(" ");
    return (
      <svg width="200" height="38" viewBox="0 0 200 38" style={{ marginLeft: "auto", width: 80, height: 22, flex: "none" }}>
        <polyline points={pts} fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  };

  return (
    <FitScreen width={1000} height={580} maxHeight={1000}>
      <div className={s.canvas}>
        <section className={s.hero}>
          <div className={s.top}>
            <div className={s.title}>📊 แดชบอร์ดกิจการ ปี {year + 543}</div>
            <div className={s.pills}>
              {years.map((y) => (
                <Link key={y} href={`/dashboard?year=${y}`} className={`${s.pill} ${y === year ? s.pillOn : ""}`}>
                  {y + 543}
                </Link>
              ))}
            </div>
          </div>
          <div className={s.kpis}>
            {[
              { label: "รายได้รวมทั้งปี", dot: "#7fb2ff", total: revenue, vals: withData.map((x) => x.m.revenue) },
              { label: "ค่าใช้จ่ายรวมทั้งปี", dot: "#ffb3b5", total: cost, vals: withData.map((x) => x.m.cost) },
            ].map((k) => {
              const hint = n ? `เฉลี่ยเดือนละ ${fmt(k.total / n)} บาท` : "ยังไม่มีข้อมูลในปีนี้";
              return (
                <div key={k.label} className={s.kpi}>
                  <div className={s.kpiBody}>
                    <div className={s.kpiLbl}>
                      <span className={s.dot} style={{ background: k.dot }} />
                      {k.label}
                      {spark(k.vals)}
                    </div>
                    <FitText className={s.big}>
                      {fmt(k.total)} <small>บาท</small>
                    </FitText>
                    <FitText className={s.hint}>
                      {hint}
                    </FitText>
                  </div>
                </div>
              );
            })}
            <div className={`${s.kpi} ${s.kpiProfit}`}>
              {ring(margin)}
              <div className={s.kpiBody}>
                <div className={s.kpiLbl}>💰 กำไรสุทธิทั้งปี</div>
                <FitText className={`${s.big} ${profit < 0 ? s.loss : ""}`}>
                  {signed(profit)} <small>บาท</small>
                </FitText>
                <FitText className={s.hint}>= รายได้ {fmt(revenue)}</FitText>
                <FitText className={s.hint}>− ค่าใช้จ่าย {fmt(cost)}</FitText>
              </div>
            </div>
          </div>
        </section>

        <section className={s.card}>
          <div className={s.h2}>
            🚚 ถนนกำไร 12 เดือน
            <span className={s.legend}>
              <span>ตัวเลขในกล่อง:</span>
              <span style={{ color: "var(--profit)" }}>
                <i style={{ background: "var(--profit)" }} />
                กำไร
              </span>
              <span style={{ color: "var(--rev)" }}>
                <i style={{ background: "var(--rev)" }} />
                รายได้
              </span>
              <span style={{ color: "var(--cost)" }}>
                <i style={{ background: "var(--cost)" }} />
                ค่าใช้จ่าย
              </span>
              <span>▲▼ เทียบเดือนก่อน</span>
              {year === curY && (
                <span>
                  <span className={s.nowName}>ชมพู</span> = เดือนนี้
                </span>
              )}
            </span>
          </div>

          <RoadChart
            months={months}
            names={M}
            hrefs={M.map((_, i) => monthHref(i))}
            nowIdx={year === curY ? curM - 1 : -1}
            year={year}
            weights={weights}
            gap={GAP}
          />

          <div className={s.strip} style={{ gridTemplateColumns: weights.map((w) => `${w}fr`).join(" "), gap: GAP }}>
            {months.map((m, i) => {
              if (!m) {
                return (
                  <div key={i} className={`${s.mi} ${s.empty}`}>
                    <div className={s.nm}>{M[i]}</div>
                    <div className={s.wait}>⏳</div>
                  </div>
                );
              }
              if (!has(m)) {
                return (
                  <Link key={i} href={monthHref(i)} className={`${s.mi} ${s.empty} ${isNow(i) ? s.now : ""}`}>
                    <div className={s.nm}>{M[i]}</div>
                    <div className={s.wait}>–</div>
                  </Link>
                );
              }
              const prev = i > 0 ? months[i - 1] : null;
              const loss = m.profit < 0;
              return (
                <Link key={i} href={monthHref(i)} className={`${s.mi} ${isNow(i) ? s.now : ""}`}>
                  <div className={s.stripe} style={{ background: loss ? "linear-gradient(90deg,#ff5a5f,#ff8a5b)" : "linear-gradient(90deg,#12b886,#3bd6a0)" }} />
                  <div className={s.nm}>
                    {/* เดือนนี้ (ยังไม่จบเดือน) = ชื่อเดือนในป้ายชมพู */}
                    <span className={isNow(i) ? s.nowName : undefined}>{M[i]}</span>
                  </div>
                  <FitText className={`${s.pf} ${loss ? s.loss : ""}`}>
                    {signed(m.profit)}
                  </FitText>
                  <FitText className={s.rv}>
                    {fmt(m.revenue)}
                  </FitText>
                  <FitText className={s.cs}>
                    {fmt(m.cost)}
                  </FitText>
                  {has(prev) ? (
                    <FitText className={`${s.dl} ${m.profit >= prev.profit ? s.up : s.down}`}>
                      {m.profit >= prev.profit ? "▲" : "▼"} {fmt(Math.abs(m.profit - prev.profit))}
                    </FitText>
                  ) : (
                    <div className={s.dl} style={{ color: "#8f86b8" }}>
                      –
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
          <div className={s.tap}>👆 กดที่รถหรือกล่องเดือนไหน — เปิดงบกำไรขาดทุนของเดือนนั้น</div>
        </section>

        <section className={s.hl}>
          <div className={s.h} style={{ background: "linear-gradient(135deg,#12b886,#0ca678)" }}>
            <div className={s.ht}>🏆 เดือนกำไรสูงสุด</div>
            <FitText className={s.hv}>
              {best ? `${M[best.i]} · ${signed(best.m.profit)}` : "–"}
            </FitText>
            <div className={s.hs}>{!best ? "ยังไม่มีข้อมูล" : best.m.revenue > 0 ? `อัตรากำไร ${((best.m.profit / best.m.revenue) * 100).toFixed(1)}%` : "เดือนนั้นไม่มีรายได้"}</div>
          </div>
          <div className={s.h} style={{ background: "linear-gradient(135deg,#ff5a5f,#ff8a5b)" }}>
            <div className={s.ht}>🧐 เดือนกำไรต่ำสุด</div>
            <FitText className={s.hv}>
              {worst ? `${M[worst.i]} · ${signed(worst.m.profit)}` : "–"}
            </FitText>
            <div className={s.hs}>{worst ? "กดเดือนนั้น ดูค่าใช้จ่าย" : "ยังไม่มีข้อมูล"}</div>
          </div>
          <div className={s.h} style={{ background: "linear-gradient(135deg,#2f6bff,#5c8dff)" }}>
            <div className={s.ht}>📈 กำไรเฉลี่ยต่อเดือน</div>
            <div className={s.hv}>{n ? signed(profit / n) : "–"}</div>
            <FitText className={s.hs}>
              {n ? `= กำไร ${signed(profit)} ÷ ${n} เดือน` : "ยังไม่มีข้อมูล"}
            </FitText>
          </div>
          <div className={s.h} style={{ background: "linear-gradient(135deg,#7b2ff7,#b14bff)" }}>
            <div className={s.ht}>
              🔁 เทียบปีก่อน ({span})
            </div>
            {prevHas ? (
              <>
                <div className={s.hv}>{yoy == null ? signed(thisSame - prevSame) : `${yoy >= 0 ? "▲" : "▼"} ${Math.abs(yoy * 100).toFixed(1)}%`}</div>
                <FitText className={s.hs}>
                  {year + 543}: {signed(thisSame)} · {year + 542}: {signed(prevSame)}
                </FitText>
              </>
            ) : (
              <>
                <div className={s.hv}>–</div>
                <div className={s.hs}>ปี {year + 542} ไม่มีรายการให้เทียบ</div>
              </>
            )}
          </div>
        </section>
      </div>
    </FitScreen>
  );
}
