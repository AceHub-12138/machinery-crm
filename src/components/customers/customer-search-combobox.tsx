"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

type Customer = { id: string; companyName: string; contactName?: string | null; phone?: string | null; province?: string | null; city?: string | null; businessLine?: string | null };

export function CustomerSearchCombobox({ value, onChange, disabled, selected }: {
  value: string;
  onChange: (customer: Customer | null) => void;
  disabled?: boolean;
  selected?: Customer | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/customers?search=${encodeURIComponent(query.trim())}&pageSize=50`);
        const data = await response.json();
        setItems(response.ok ? data.customers || [] : []);
      } finally { setLoading(false); }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  useEffect(() => {
    const close = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const label = selected ? `${selected.companyName}（${selected.contactName || "未填写联系人"}）` : value ? "已选择客户" : "请选择客户";
  return <div ref={ref} className="relative">
    <button type="button" disabled={disabled} onClick={() => setOpen((current) => !current)} className="flex w-full items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-left text-sm disabled:bg-gray-50">
      <Search className="h-4 w-4 shrink-0 text-gray-400" /><span className={value ? "flex-1 truncate text-gray-900" : "flex-1 text-gray-400"}>{label}</span>
      {value && !disabled && <X className="h-4 w-4 text-gray-400 hover:text-gray-700" onClick={(event) => { event.stopPropagation(); onChange(null); }} />}
    </button>
    {open && !disabled && <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
      <div className="border-b p-2"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索客户名称、联系人、电话或邮箱" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></div>
      <ul className="max-h-64 overflow-auto py-1">
        {loading ? <li className="px-3 py-2 text-sm text-gray-400">搜索中...</li> : items.length ? items.map((customer) => <li key={customer.id}><button type="button" onClick={() => { onChange(customer); setOpen(false); setQuery(""); }} className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"><span className="font-medium">{customer.companyName}</span><span className="text-gray-500"> · {customer.contactName || "未填写联系人"}</span><span className="block text-xs text-gray-400">{[customer.phone, [customer.province, customer.city].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}</span></button></li>) : <li className="px-3 py-2 text-sm text-gray-400">未找到匹配客户</li>}
      </ul>
    </div>}
  </div>;
}
