"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";

function contractEquipmentLabel(contract: any) {
  const mainItems = contract?.items?.filter((item: any) => item.itemType === "MAIN") || [];
  if (mainItems.length) {
    return mainItems
      .map((item: any) => `${item.productNameSnapshot || ""} ${item.productModelSnapshot || ""}`.trim())
      .join("、");
  }
  return contract?.equipmentName || contract?.equipmentModel || "";
}

function optionLabel(contract: any) {
  const equip = contractEquipmentLabel(contract);
  return `${contract.contractNo} - ${contract.customer?.companyName || ""}${equip ? " · " + equip : ""}`;
}

/**
 * 可搜索的合同选择框（替代原生 <select>）。
 * 输入合同编号 / 客户名 / 联系人 / 设备 任意关键词即可实时筛选。
 * 不依赖任何第三方库。
 */
export function ContractCombobox({
  contracts,
  value,
  onChange,
  disabled,
  placeholder = "输入合同编号 / 客户 / 设备搜索",
  maxVisible = 50,
}: {
  contracts: any[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
  maxVisible?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => contracts.find((c) => c.id === value), [contracts, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contracts.slice(0, maxVisible);
    return contracts
      .filter((c) => {
        const hay = `${c.contractNo || ""} ${c.customer?.companyName || ""} ${c.customer?.contactName || ""} ${contractEquipmentLabel(c)} ${c.equipmentModel || ""}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, maxVisible);
  }, [contracts, query, maxVisible]);

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // 修改发货记录时不允许更换合同：显示为只读
  if (disabled) {
    return (
      <input
        readOnly
        value={selected ? optionLabel(selected) : ""}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 text-gray-600"
      />
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-left focus:outline-none focus:ring-2 focus:ring-gray-900"
      >
        <span className={selected ? "text-gray-900 truncate" : "text-gray-400"}>
          {selected ? optionLabel(selected) : "请选择合同"}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {selected && (
            <X
              className="w-3.5 h-3.5 text-gray-400 hover:text-gray-700"
              onClick={(event) => {
                event.stopPropagation();
                onChange("");
              }}
            />
          )}
          <ChevronDown className="w-4 h-4 text-gray-400" />
        </span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={placeholder}
                className="w-full pl-8 pr-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
          </div>
          <ul className="max-h-64 overflow-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-400">未找到匹配的合同</li>
            ) : (
              filtered.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(c.id);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${c.id === value ? "bg-gray-100 text-gray-900" : "text-gray-700"}`}
                  >
                    <span className="font-medium">{c.contractNo}</span>
                    <span className="text-gray-500"> · {c.customer?.companyName}</span>
                    {contractEquipmentLabel(c) && <span className="block text-xs text-gray-400">{contractEquipmentLabel(c)}</span>}
                  </button>
                </li>
              ))
            )}
          </ul>
          {contracts.length > maxVisible && !query.trim() && (
            <p className="px-3 py-1.5 text-xs text-gray-400 border-t border-gray-100">
              仅显示前 {maxVisible} 条，输入关键词可精确筛选
            </p>
          )}
        </div>
      )}
    </div>
  );
}
