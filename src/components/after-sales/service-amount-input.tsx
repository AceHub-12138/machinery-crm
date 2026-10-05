"use client";

import { adjustServiceAmount, normalizeServiceAmountInput } from "@/lib/after-sales-form";

type ServiceAmountInputProps = {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
};

export function ServiceAmountInput({ value, onChange, required = false }: ServiceAmountInputProps) {
  return (
    <div className="mt-1 flex overflow-hidden rounded border bg-white focus-within:ring-2 focus-within:ring-[var(--brand-orange)]">
      <input
        aria-label="服务金额"
        className="min-w-0 flex-1 p-2 outline-none"
        inputMode="decimal"
        min="0"
        onChange={(event) => onChange(normalizeServiceAmountInput(event.target.value))}
        placeholder="请输入金额"
        required={required}
        type="text"
        value={value}
      />
      <div className="flex w-9 shrink-0 flex-col border-l">
        <button
          aria-label="服务金额加 1"
          className="flex flex-1 items-center justify-center border-b text-xs hover:bg-gray-50"
          onClick={() => onChange(adjustServiceAmount(value, 1))}
          type="button"
        >
          ▲
        </button>
        <button
          aria-label="服务金额减 1"
          className="flex flex-1 items-center justify-center text-xs hover:bg-gray-50"
          onClick={() => onChange(adjustServiceAmount(value, -1))}
          type="button"
        >
          ▼
        </button>
      </div>
    </div>
  );
}
