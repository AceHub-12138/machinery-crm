"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, X } from "lucide-react";

export type MaterialOption = {
  id: string;
  code?: string | null;
  name?: string | null;
  spec?: string | null;
  unit?: string | null;
};

function optionLabel(material: MaterialOption) {
  const spec = material.spec ? `(${material.spec})` : "";
  return `${material.code || ""} - ${material.name || ""}${spec}`.trim();
}

export function MaterialCombobox({
  materials,
  value,
  onChange,
  placeholder = "输入编码 / 名称 / 规格搜索",
  maxVisible = 80,
}: {
  materials: MaterialOption[];
  value: string;
  onChange: (materialId: string) => void;
  placeholder?: string;
  maxVisible?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 360, maxHeight: 320 });

  const selected = useMemo(
    () => materials.find((material) => material.id === value),
    [materials, value]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const source = q
      ? materials.filter((material) => {
          const haystack = `${material.code || ""} ${material.name || ""} ${material.spec || ""}`.toLowerCase();
          return haystack.includes(q);
        })
      : materials;
    return source.slice(0, maxVisible);
  }, [materials, query, maxVisible]);

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node) && !dropdownRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
        setActiveIndex(0);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportPadding = 8;
      const width = Math.min(Math.max(rect.width, 360), window.innerWidth - viewportPadding * 2);
      const left = Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - width - viewportPadding));
      const below = window.innerHeight - rect.bottom - viewportPadding;
      const above = rect.top - viewportPadding;
      const openAbove = below < 240 && above > below;
      const maxHeight = Math.max(180, Math.min(360, openAbove ? above : below));
      setPosition({ top: openAbove ? Math.max(viewportPadding, rect.top - maxHeight - 4) : rect.bottom + 4, left, width, maxHeight });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => { window.removeEventListener("resize", updatePosition); window.removeEventListener("scroll", updatePosition, true); };
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const choose = (materialId: string) => {
    onChange(materialId);
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  };

  const dropdown = <div ref={dropdownRef} style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }} className="fixed z-[100] flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl">
    <div className="border-b border-gray-100 p-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); if (filtered.length) setActiveIndex((idx) => Math.min(idx + 1, filtered.length - 1)); }
          else if (event.key === "ArrowUp") { event.preventDefault(); if (filtered.length) setActiveIndex((idx) => Math.max(idx - 1, 0)); }
          else if (event.key === "Enter" && filtered[activeIndex]) { event.preventDefault(); choose(filtered[activeIndex].id); }
          else if (event.key === "Escape") { setOpen(false); setQuery(""); setActiveIndex(0); }
        }} placeholder={placeholder} className="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
      </div>
    </div>
    <ul className="min-h-0 flex-1 overflow-auto py-1">
      {filtered.length === 0 ? <li className="px-3 py-2 text-sm text-gray-400">未找到匹配的物料</li> : filtered.map((material, index) => <li key={material.id}><button type="button" onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(material.id)} className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 ${material.id === value || index === activeIndex ? "bg-gray-100 text-gray-900" : "text-gray-700"}`}><span className="font-medium">{material.code}</span><span className="text-gray-600"> - {material.name}</span>{material.spec && <span className="block text-xs text-gray-400">{material.spec}</span>}</button></li>)}
    </ul>
    {materials.length > maxVisible && !query.trim() && <p className="border-t border-gray-100 px-3 py-1.5 text-xs text-gray-400">仅显示前 {maxVisible} 条，输入关键词可精确筛选</p>}
  </div>;

  return (
    <div ref={containerRef} className="relative min-w-0 w-full flex-1">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-left focus:outline-none focus:ring-2 focus:ring-gray-900"
      >
        <span className={selected ? "text-gray-900 truncate" : "text-gray-400"}>
          {selected ? optionLabel(selected) : "选择物料"}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {selected && (
            <X
              className="w-3.5 h-3.5 text-gray-400 hover:text-gray-700"
              onClick={(event) => {
                event.stopPropagation();
                choose("");
              }}
            />
          )}
          <ChevronDown className="w-4 h-4 text-gray-400" />
        </span>
      </button>

      {open && typeof document !== "undefined" && createPortal(dropdown, document.body)}
    </div>
  );
}
