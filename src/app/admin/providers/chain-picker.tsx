"use client";

import { X } from "lucide-react";
import type { ChainPickerOption } from "./shared-types";

/**
 * Multi-select chain editor. Shows selected items as numbered pills,
 * unselected items as "+" add buttons. Used for LLM image/voice chains
 * and routing scope chains.
 */
export function ChainPicker({
  label,
  helpText,
  defaultLabel,
  available,
  value,
  onChange,
}: {
  label: string;
  helpText: string;
  defaultLabel: string;
  available: ChainPickerOption[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const selected = value.filter((v) => available.some((o) => o.value === v));
  const unselected = available.filter((o) => !selected.includes(o.value));

  return (
    <div className="rounded-md border bg-slate-50 p-3 text-sm">
      <div className="font-medium text-slate-800">{label}</div>
      <p className="mt-0.5 text-xs text-slate-600">
        {helpText}{" "}
        <span className="text-slate-500">Default: {defaultLabel}</span>
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 min-h-[28px]">
        {selected.length === 0 ? (
          <span className="text-xs italic text-slate-500">
            (using default)
          </span>
        ) : (
          selected.map((v, i) => {
            const opt = available.find((o) => o.value === v);
            return (
              <span
                key={v}
                className="inline-flex items-center gap-1 rounded-full border border-slate-900 bg-slate-900 px-2 py-0.5 text-xs font-medium text-white"
              >
                <span className="rounded-full bg-white/20 px-1 leading-none">
                  {i + 1}
                </span>
                {opt?.label ?? v}
                <button
                  type="button"
                  onClick={() => onChange(selected.filter((x) => x !== v))}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-white/15"
                  aria-label={`Remove ${opt?.label ?? v}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })
        )}
      </div>
      {unselected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-200 pt-2">
          <span className="text-xs text-slate-500">Add:</span>
          {unselected.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange([...selected, o.value])}
              className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:border-slate-900 hover:text-slate-900"
            >
              + {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
