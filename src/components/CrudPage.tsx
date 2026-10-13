import Link from "next/link";
import { CrudForm, DeleteButton } from "./CrudForm";
import { Card, Empty, PageHeader } from "./ui";
import { DateRangeFilter, ExpiringToggle, SearchFilter, SelectFilter } from "./Filters";
import { ExportMenu } from "./ExportMenu";
import { loadOptions, type Option, type Resource } from "@/lib/crud";
import { prisma } from "@/lib/prisma";
import { crudQuery } from "@/lib/crud-query";
import { formatThaiDate } from "@/lib/date";
import { baht, num } from "@/lib/format";
import type { SearchParams } from "@/lib/params";
import type { ReactNode } from "react";

type Row = Record<string, unknown>;

function cellText(value: unknown, format: string | undefined, options: Option[] | undefined): ReactNode {
  if (value == null || value === "") return <span className="text-slate-300">—</span>;

  if (options?.length) {
    const hit = options.find((o) => o.value === String(value));
    if (hit) return hit.label;
  }

  if (value instanceof Date) return formatThaiDate(value);
  if (typeof value === "boolean") return value ? "ใช่" : "ไม่";

  switch (format) {
    case "money":
      return baht(Number(value));
    case "num":
      return num(Number(value));
    case "date":
      return formatThaiDate(new Date(String(value)));
    default:
      return String(value);
  }
}

/**
 * หน้าจัดการข้อมูลมาตรฐาน: ฟอร์มเพิ่ม/แก้ไขด้านบน ตารางข้อมูลด้านล่าง
 * ใช้ร่วมกันทุกตารางฐานข้อมูล จึงมั่นใจได้ว่าพฤติกรรมเหมือนกันหมด
 */
export async function CrudPage({
  resource,
  searchParams,
  extraHeader,
  extraFooter,
  toolbar,
}: {
  resource: Resource;
  searchParams: SearchParams;
  extraHeader?: ReactNode;
  extraFooter?: ReactNode;
  /** ปุ่มเพิ่มของหน้านั้น วางข้างปุ่ม Export (เช่น Import จาก Excel) */
  toolbar?: ReactNode;
}) {
  const options = await loadOptions(resource);
  const editId = typeof searchParams.edit === "string" ? searchParams.edit : undefined;
  const pageSize = resource.pageSize ?? 50;
  const page = Math.max(1, Number(searchParams.page) || 1);

  const { where, q, from, to, filterValues, onlyExpiring, alertDays, today } = await crudQuery(resource, searchParams);
  const expiryFields = resource.expiryFields ?? [];

  /** ฟิลด์วันหมดอายุของแถวนี้ที่ใกล้ถึง/เลยกำหนด: ชื่อฟิลด์ → จำนวนวันที่เหลือ (ติดลบ = เลยแล้ว) */
  const expiryOf = (row: Row): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const f of expiryFields) {
      const d = row[f];
      if (!(d instanceof Date)) continue;
      const daysLeft = Math.round((d.getTime() - today.getTime()) / 86400000);
      if (daysLeft <= alertDays) out[f] = daysLeft;
    }
    return out;
  };

  const model = (prisma as never as Record<string, {
    findMany: (a: unknown) => Promise<Row[]>;
    count: (a: unknown) => Promise<number>;
    findFirst: (a: unknown) => Promise<Row | null>;
  }>)[resource.model];

  const [rows, total] = await Promise.all([
    model.findMany({
      where,
      orderBy: resource.orderBy,
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    model.count({ where }),
  ]);

  let editing: Row | null = null;
  if (editId) {
    const idValue =
      resource.idType === "number"
        ? Number(editId)
        : resource.idType === "date"
          ? new Date(editId + "T00:00:00Z")
          : editId;
    editing = await model.findFirst({ where: { [resource.idField]: idValue } });
  }

  const tableFields = resource.fields.filter((f) => !f.hideInTable);
  const pages = Math.ceil(total / pageSize);

  // ลิงก์เปลี่ยนหน้า — คงตัวกรองทุกตัวไว้ (คำค้น · ช่วงวันที่ · dropdown) ไม่งั้นกดหน้าถัดไปแล้วกลายเป็นข้อมูลทั้งหมด
  const pageHref = (n: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string" && v && k !== "page" && k !== "edit") p.set(k, v);
    p.set("page", String(n));
    return `?${p.toString()}`;
  };

  const idOf = (row: Row): string => {
    const v = row[resource.idField];
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v);
  };

  const labelOf = (row: Row): string => {
    const first = resource.fields.find((f) => f.type === "text");
    return first ? String(row[first.name] ?? idOf(row)) : idOf(row);
  };

  return (
    <>
      <PageHeader title={resource.title} subtitle={resource.subtitle} />

      {resource.notes && resource.notes.length > 0 && (
        <ul className="mb-4 space-y-1 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-[13px] font-medium leading-relaxed text-brand-900">
          {resource.notes.map((n, i) => (
            <li key={i}>– {n}</li>
          ))}
        </ul>
      )}

      {extraHeader}

      <Card
        title={editing ? `แก้ไข: ${labelOf(editing)}` : "เพิ่มข้อมูลใหม่"}
        className="mb-4 no-print"
      >
        <CrudForm
          resourceKey={resource.key}
          fields={resource.fields}
          options={options}
          initial={editing ?? undefined}
          editingId={editing ? idOf(editing) : undefined}
        />
      </Card>

      {/* แถบค้นหา/กรอง + Export — มีทุกตาราง (Export ได้เสมอ แม้ตารางที่ไม่มีช่องค้นหา) */}
      {(
        <div className="no-print card mb-4 flex flex-wrap items-end gap-3 p-3">
          {resource.searchFields?.length ? <SearchFilter value={q} /> : null}
          {resource.dateRangeField && <DateRangeFilter from={from} to={to} inline clearable />}
          {(resource.filterFields ?? []).map((f) => {
            const field = resource.fields.find((x) => x.name === f);
            if (!field) return null;
            return (
              <SelectFilter
                key={f}
                name={`f_${f}`}
                label={field.label}
                value={filterValues[f] ?? ""}
                width="w-44"
                options={[{ value: "", label: "— ทั้งหมด —" }, ...(options[f] ?? [])]}
              />
            );
          })}
          {expiryFields.length > 0 && (
            <ExpiringToggle on={onlyExpiring} alertDays={alertDays} />
          )}
          <span className="pb-2 text-[12px] text-slate-500">พบ {total.toLocaleString("th-TH")} รายการ</span>
          <div className="ml-auto flex flex-wrap gap-2">
            {toolbar}
            <ExportMenu resourceKey={resource.key} />
          </div>
        </div>
      )}

      <Card bodyClass="p-0">
        {rows.length === 0 ? (
          <Empty>{q || Object.keys(filterValues).length || onlyExpiring || from || to ? "ไม่พบข้อมูลตามเงื่อนไขที่กรอง" : "ยังไม่มีข้อมูล — เพิ่มได้จากฟอร์มด้านบน"}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  {tableFields.map((f) => (
                    <th key={f.name} className={f.format === "money" || f.format === "num" ? "num" : undefined}>
                      {f.label}
                    </th>
                  ))}
                  <th className="no-print">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const id = idOf(row);
                  const expiring = expiryOf(row);
                  const danger = Object.keys(expiring).length > 0;
                  return (
                    <tr key={id} className={danger ? "row-danger" : undefined}>
                      {tableFields.map((f) => {
                        const daysLeft = expiring[f.name];
                        return (
                          <td
                            key={f.name}
                            // วันที่ไม่ตัดขึ้นบรรทัดใหม่ ("20 ก.ค. 2569" อ่านเป็นก้อนเดียว)
                            className={f.format === "money" || f.format === "num" ? "num" : f.type === "date" ? "whitespace-nowrap" : undefined}
                          >
                            {cellText(row[f.name], f.format, options[f.name])}
                            {daysLeft != null && (
                              <span className="ml-1 whitespace-nowrap text-[11px] font-bold">
                                {daysLeft < 0 ? `หมดอายุแล้ว ${-daysLeft} วัน` : daysLeft === 0 ? "หมดวันนี้" : `อีก ${daysLeft} วัน`}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="no-print">
                        <div className="flex flex-wrap justify-center gap-1">
                          <Link href={`?edit=${encodeURIComponent(id)}`} className="btn btn-ghost px-2 py-1 text-[12px]">
                            แก้ไข
                          </Link>
                          <DeleteButton resourceKey={resource.key} id={id} label={labelOf(row)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="no-print flex items-center justify-between border-t border-[var(--border)] px-4 py-2 text-[13px]">
            <span className="text-slate-500">
              หน้า {page} จาก {pages}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={pageHref(page - 1)} className="btn btn-ghost">
                  ◀ ก่อนหน้า
                </Link>
              )}
              {page < pages && (
                <Link href={pageHref(page + 1)} className="btn btn-ghost">
                  ถัดไป ▶
                </Link>
              )}
            </div>
          </div>
        )}
      </Card>

      {extraFooter}
    </>
  );
}
