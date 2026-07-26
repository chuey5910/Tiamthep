"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createRecord, deleteRecord, updateRecord } from "@/app/crud/actions";
import type { Field, Option } from "@/lib/crud";

const SPAN: Record<number, string> = {
  1: "lg:col-span-1",
  2: "lg:col-span-2",
  3: "lg:col-span-3",
  4: "lg:col-span-4",
};

export function CrudForm({
  resourceKey,
  fields,
  options,
  initial,
  editingId,
}: {
  resourceKey: string;
  fields: Field[];
  options: Record<string, Option[]>;
  initial?: Record<string, unknown>;
  editingId?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const editing = editingId != null;

  const onSubmit = (form: FormData) => {
    setError(null);
    start(async () => {
      const res = editing
        ? await updateRecord(resourceKey, editingId, form)
        : await createRecord(resourceKey, form);
      if (!res.ok) {
        setError(res.error ?? "บันทึกไม่สำเร็จ");
        return;
      }
      if (editing) router.push(`?`);
      else router.refresh();
    });
  };

  const shown = fields.filter((f) => !f.hideInForm);

  return (
    <form action={onSubmit} key={editingId ?? "new"}>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        {shown.map((f) => {
          const disabled = editing && f.immutable;
          const raw = initial?.[f.name];
          return (
            <div key={f.name} className={SPAN[f.span ?? 1]}>
              <label className="lbl" htmlFor={`f-${f.name}`}>
                {f.label}
                {f.required && <span className="ml-0.5 text-red-500">*</span>}
              </label>
              <FieldInput
                field={f}
                options={options[f.name] ?? []}
                value={raw}
                disabled={disabled || pending}
              />
              {f.help && <p className="mt-0.5 text-[11px] text-slate-400">{f.help}</p>}
            </div>
          );
        })}
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "กำลังบันทึก…" : editing ? "บันทึกการแก้ไข" : "+ เพิ่มข้อมูล"}
        </button>
        {editing && (
          <button type="button" className="btn btn-ghost" onClick={() => router.push("?")} disabled={pending}>
            ยกเลิก
          </button>
        )}
      </div>
    </form>
  );
}

function FieldInput({
  field,
  options,
  value,
  disabled,
}: {
  field: Field;
  options: Option[];
  value: unknown;
  disabled: boolean;
}) {
  const id = `f-${field.name}`;

  if (field.type === "checkbox") {
    const checked = value == null ? true : Boolean(value);
    return (
      <label className="flex h-[38px] items-center gap-2 text-sm text-slate-700">
        <input
          id={id}
          type="checkbox"
          name={field.name}
          defaultChecked={checked}
          disabled={disabled}
          className="h-4 w-4 rounded border-slate-300"
        />
        ใช่
      </label>
    );
  }

  if (field.type === "select") {
    const current = value == null ? "" : String(value);
    return (
      <select id={id} name={field.name} className="inp" defaultValue={current} disabled={disabled} required={field.required}>
        {(field.allowEmpty || !field.required) && <option value="">— ไม่ระบุ —</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {/* ค่าที่มีอยู่แต่ไม่อยู่ในรายการ (เช่น ข้อมูลเก่า) ต้องยังแสดงได้ */}
        {current && !options.some((o) => o.value === current) && (
          <option value={current}>{current} (ไม่อยู่ในรายการ)</option>
        )}
      </select>
    );
  }

  if (field.type === "textarea") {
    return (
      <textarea
        id={id}
        name={field.name}
        className="inp"
        rows={2}
        defaultValue={value == null ? "" : String(value)}
        disabled={disabled}
        placeholder={field.placeholder}
      />
    );
  }

  let defaultValue = "";
  if (value != null) {
    if (field.type === "date") {
      const d = value instanceof Date ? value : new Date(String(value));
      defaultValue = isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
    } else {
      defaultValue = String(value);
    }
  }

  return (
    <input
      id={id}
      name={field.name}
      type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
      step={field.step}
      className="inp"
      defaultValue={defaultValue}
      disabled={disabled}
      required={field.required}
      placeholder={field.placeholder}
    />
  );
}

export function DeleteButton({ resourceKey, id, label }: { resourceKey: string; id: string; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      className="btn btn-danger px-2 py-1 text-[12px]"
      disabled={pending}
      onClick={() => {
        if (!confirm(`ยืนยันลบ${label ? ` "${label}"` : "รายการนี้"}?\n\nการลบย้อนกลับไม่ได้`)) return;
        start(async () => {
          const res = await deleteRecord(resourceKey, id);
          if (!res.ok) alert(res.error ?? "ลบไม่สำเร็จ");
          else router.refresh();
        });
      }}
    >
      {pending ? "…" : "ลบ"}
    </button>
  );
}
