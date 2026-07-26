import Link from "next/link";
import { CrudForm, DeleteButton } from "./CrudForm";
import { Card, Empty, PageHeader } from "./ui";
import { SearchFilter } from "./Filters";
import { loadOptions, type Option, type Resource } from "@/lib/crud";
import { prisma } from "@/lib/prisma";
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
}: {
  resource: Resource;
  searchParams: SearchParams;
  extraHeader?: ReactNode;
  extraFooter?: ReactNode;
}) {
  const options = await loadOptions(resource);
  const q = typeof searchParams.q === "string" ? searchParams.q.trim() : "";
  const editId = typeof searchParams.edit === "string" ? searchParams.edit : undefined;
  const pageSize = resource.pageSize ?? 50;
  const page = Math.max(1, Number(searchParams.page) || 1);

  const where: Record<string, unknown> =
    q && resource.searchFields?.length
      ? { OR: resource.searchFields.map((f) => ({ [f]: { contains: q } })) }
      : {};

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
        <ul className="mb-4 space-y-1 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-[12px] leading-relaxed text-brand-900">
          {resource.notes.map((n, i) => (
            <li key={i}>• {n}</li>
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

      {resource.searchFields && resource.searchFields.length > 0 && (
        <div className="no-print card mb-4 flex flex-wrap items-end gap-3 p-3">
          <SearchFilter value={q} />
          <span className="pb-2 text-[12px] text-slate-500">พบ {total.toLocaleString("th-TH")} รายการ</span>
        </div>
      )}

      <Card bodyClass="p-0">
        {rows.length === 0 ? (
          <Empty>{q ? `ไม่พบข้อมูลที่ตรงกับ "${q}"` : "ยังไม่มีข้อมูล — เพิ่มได้จากฟอร์มด้านบน"}</Empty>
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
                  <th className="no-print w-24">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const id = idOf(row);
                  return (
                    <tr key={id}>
                      {tableFields.map((f) => (
                        <td
                          key={f.name}
                          className={f.format === "money" || f.format === "num" ? "num" : undefined}
                        >
                          {cellText(row[f.name], f.format, options[f.name])}
                        </td>
                      ))}
                      <td className="no-print">
                        <div className="flex gap-1">
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
                <Link href={`?page=${page - 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className="btn btn-ghost">
                  ◀ ก่อนหน้า
                </Link>
              )}
              {page < pages && (
                <Link href={`?page=${page + 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className="btn btn-ghost">
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
