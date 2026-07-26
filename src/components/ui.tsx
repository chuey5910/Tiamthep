import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  children,
  actions,
  className = "",
  bodyClass = "p-4",
}: {
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5">
          <h2 className="text-sm font-bold text-slate-800">{title}</h2>
          {actions && <div className="flex gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "good" | "bad" | "warn";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-700"
      : tone === "bad"
        ? "text-red-700"
        : tone === "warn"
          ? "text-amber-700"
          : "text-slate-900";
  return (
    <div className="card p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${toneClass}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}

export function Empty({ children = "ยังไม่มีข้อมูลในช่วงที่เลือก" }: { children?: ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-slate-400">{children}</div>;
}

export function TableWrap({ children, maxH = "" }: { children: ReactNode; maxH?: string }) {
  return <div className={`overflow-x-auto ${maxH}`}>{children}</div>;
}

export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "ok" | "warn" | "error" | "info" | "muted";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function PrintButton({ label = "พิมพ์ / บันทึก PDF" }: { label?: string }) {
  return (
    <form action={undefined}>
      <button type="button" className="btn btn-ghost no-print" data-print>
        🖨 {label}
      </button>
    </form>
  );
}

export function LinkButton({
  href,
  children,
  variant = "ghost",
}: {
  href: string;
  children: ReactNode;
  variant?: "ghost" | "primary";
}) {
  return (
    <Link href={href} className={`btn btn-${variant}`}>
      {children}
    </Link>
  );
}

/** คำอธิบายวิธีคำนวณ ใต้หัวรายงาน — ให้ผู้ใช้ตรวจสอบตัวเลขเองได้ */
export function Formula({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-[12px] leading-relaxed text-brand-900">
      {children}
    </div>
  );
}
