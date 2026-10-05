"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileDown, Upload, X } from "lucide-react";
import { MaterialCombobox } from "@/components/erp/material-combobox";

type CategoryNode = {
  id: string;
  name: string;
  code?: string | null;
  warningThreshold?: unknown;
  children?: CategoryNode[];
};

type MaterialOption = {
  id: string;
  code: string;
  name: string;
  category?: { name?: string | null };
  spec?: string | null;
  materialType?: string | null;
  unit?: string | null;
};

type PreviewRow = {
  rowNumber: number;
  code: string;
  name: string;
  categoryId: string;
  categoryName: string;
  spec: string;
  materialType: string;
  unit: string;
  standardPrice: string;
  safetyStock: string;
  remark: string;
  isActive: boolean;
  status: "CREATE" | "UPDATE" | "MISSING_CODE" | "ERROR";
  actionLabel: string;
  error: string;
  existingMaterialId: string;
  suggestedMatches: MaterialOption[];
};

type Resolution = {
  action?: "UPDATE_EXISTING" | "AUTO_CODE_CREATE" | "SKIP";
  materialId?: string;
  categoryId?: string;
};

type Summary = {
  create: number;
  update: number;
  missingCode: number;
  error: number;
  total: number;
};

type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  revived?: number;
  errorMessages: string[];
  generatedCodes: Array<{ rowNumber: number; code: string }>;
};

const TEMPLATE_HEADERS = [
  "物料编号/图号",
  "物料名称",
  "物料分类",
  "规格型号",
  "材质",
  "单位",
  "标准单价",
  "安全库存",
  "备注",
  "是否启用",
];

export function flattenMaterialCategories(cats: CategoryNode[], depth = 0): Array<CategoryNode & { label: string }> {
  const result: Array<CategoryNode & { label: string }> = [];
  for (const cat of cats) {
    result.push({ ...cat, label: "  ".repeat(depth) + cat.name });
    if (cat.children) result.push(...flattenMaterialCategories(cat.children, depth + 1));
  }
  return result;
}

export async function downloadMaterialImportTemplate() {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS,
    ["JSCJ-0001", "底座", "机身铸件", "HT250", "铸铁", "件", 0, 0, "示例行，可删除", "是"],
    ["", "缺少图号示例", "外购件", "M12", "45钢", "件", 0, 0, "预览时需选择处理方式", "是"],
  ]);
  sheet["!cols"] = TEMPLATE_HEADERS.map(() => ({ wch: 18 }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "物料导入模板");
  XLSX.writeFile(workbook, "物料导入模板.xlsx");
}

function statusClass(status: PreviewRow["status"]) {
  if (status === "CREATE") return "bg-green-100 text-green-700";
  if (status === "UPDATE") return "bg-blue-100 text-blue-700";
  if (status === "MISSING_CODE") return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

function nextResolution(value: string, row: PreviewRow): Resolution {
  if (value.startsWith("update:")) {
    return { action: "UPDATE_EXISTING", materialId: value.slice("update:".length) };
  }
  if (value.startsWith("auto:")) {
    return { action: "AUTO_CODE_CREATE", categoryId: value.slice("auto:".length) || row.categoryId };
  }
  if (value === "skip") return { action: "SKIP" };
  return {};
}

function uniqueMaterials(materials: MaterialOption[]) {
  const seen = new Set<string>();
  return materials.filter((material) => {
    if (seen.has(material.id)) return false;
    seen.add(material.id);
    return true;
  });
}

export function MaterialImportDialog({
  open,
  categories,
  onClose,
  onImported,
}: {
  open: boolean;
  categories: CategoryNode[];
  onClose: () => void;
  onImported: () => Promise<void> | void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  const flatCategories = useMemo(() => flattenMaterialCategories(categories), [categories]);
  const unresolvedMissingRows = rows.filter((row) => row.status === "MISSING_CODE" && !resolutions[String(row.rowNumber)]?.action);

  useEffect(() => {
    if (!open) return;
    fetch("/api/erp/materials")
      .then((res) => res.json())
      .then((data) => setMaterials(Array.isArray(data) ? data : []));
  }, [open]);

  if (!open) return null;

  const preview = async () => {
    if (!file) return;
    setLoading(true);
    setMessage("");
    setResult(null);
    try {
      const data = new FormData();
      data.append("intent", "preview");
      data.append("file", file);
      const res = await fetch("/api/erp/materials/import", { method: "POST", body: data });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "预览失败");
      setRows(payload.rows || []);
      setSummary(payload.summary || null);
      setResolutions({});
    } catch (error: any) {
      setMessage(error?.message || "预览失败");
    } finally {
      setLoading(false);
    }
  };

  const confirmImport = async () => {
    setConfirming(true);
    setMessage("");
    try {
      const res = await fetch("/api/erp/materials/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "confirm", rows, resolutions }),
      });
      const payload = await res.json();
      if (!res.ok && res.status !== 207) throw new Error(payload.error || "导入失败");
      setResult(payload);
      await onImported();
    } catch (error: any) {
      setMessage(error?.message || "导入失败");
    } finally {
      setConfirming(false);
    }
  };

  const resetAndClose = () => {
    setFile(null);
    setRows([]);
    setSummary(null);
    setResolutions({});
    setMessage("");
    setResult(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={resetAndClose}>
      <div className="flex h-[82vh] w-[90vw] max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 p-5">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Excel 导入物料</h2>
            <p className="mt-1 text-xs text-gray-500">只导入物料基础信息，不修改库存数量，不生成出入库流水。</p>
          </div>
          <button onClick={resetAndClose} className="text-gray-400 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <label className="flex min-w-[260px] flex-1 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              <Upload className="h-4 w-4 text-gray-400" />
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
                className="min-w-0 flex-1 text-sm"
              />
            </label>
            <button
              onClick={downloadMaterialImportTemplate}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <FileDown className="h-4 w-4" />下载模板
            </button>
            <button
              onClick={preview}
              disabled={!file || loading}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {loading ? "预览中..." : "预览导入"}
            </button>
          </div>

          {message && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4" />
              {message}
            </div>
          )}

          {summary && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <div className="rounded-lg border border-gray-200 p-3 text-sm">
                <p className="text-xs text-gray-500">新增</p>
                <p className="mt-1 font-semibold text-gray-900">{summary.create}</p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3 text-sm">
                <p className="text-xs text-gray-500">更新</p>
                <p className="mt-1 font-semibold text-gray-900">{summary.update}</p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3 text-sm">
                <p className="text-xs text-gray-500">缺少图号待处理</p>
                <p className="mt-1 font-semibold text-amber-700">{summary.missingCode}</p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3 text-sm">
                <p className="text-xs text-gray-500">错误</p>
                <p className="mt-1 font-semibold text-red-700">{summary.error}</p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3 text-sm">
                <p className="text-xs text-gray-500">总行数</p>
                <p className="mt-1 font-semibold text-gray-900">{summary.total}</p>
              </div>
            </div>
          )}

          {rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full min-w-[1100px] text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">行号</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">处理结果</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">图号/编号</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">名称</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">分类</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">规格</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">单位</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">待处理方式</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">错误原因</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const materialChoices = uniqueMaterials([...(row.suggestedMatches || []), ...materials]);
                    return (
                      <tr key={row.rowNumber} className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-500">{row.rowNumber}</td>
                        <td className="px-3 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs ${statusClass(row.status)}`}>
                            {row.actionLabel}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{row.code || "-"}</td>
                        <td className="px-3 py-2 font-medium text-gray-900">{row.name || "-"}</td>
                        <td className="px-3 py-2 text-gray-600">{row.categoryName || "-"}</td>
                        <td className="px-3 py-2 text-gray-600">{row.spec || "-"}</td>
                        <td className="px-3 py-2 text-gray-600">{row.unit || "-"}</td>
                        <td className="px-3 py-2">
                          {row.status === "MISSING_CODE" ? (
                            <div className="min-w-[340px] space-y-2">
                              <MaterialCombobox materials={materialChoices} value={resolutions[String(row.rowNumber)]?.action === "UPDATE_EXISTING" ? resolutions[String(row.rowNumber)]?.materialId || "" : ""} onChange={(materialId) => setResolutions((current) => ({ ...current, [String(row.rowNumber)]: materialId ? { action: "UPDATE_EXISTING", materialId } : {} }))} placeholder="搜索并选择要更新的已有物料" />
                              <div className="flex gap-2"><button type="button" onClick={() => setResolutions((current) => ({ ...current, [String(row.rowNumber)]: nextResolution(`auto:${row.categoryId}`, row) }))} className="rounded border px-2 py-1 text-xs">按分类自动编号并新增</button><button type="button" onClick={() => setResolutions((current) => ({ ...current, [String(row.rowNumber)]: nextResolution("skip", row) }))} className="rounded border px-2 py-1 text-xs">跳过该行</button></div>
                            </div>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="px-3 py-2 text-red-600">{row.error || "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {result && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="h-4 w-4" />
                导入完成：新增 {result.created}，更新 {result.updated}，跳过 {result.skipped}，错误 {result.errors}
                {Number(result.revived || 0) > 0 && <span>（其中 {result.revived} 行为恢复已删除物料）</span>}
              </div>
              {result.generatedCodes.length > 0 && (
                <p className="mt-1 text-xs">
                  自动生成图号：{result.generatedCodes.map((item) => `第${item.rowNumber}行 ${item.code}`).join("；")}
                </p>
              )}
              {result.errorMessages.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-700">
                  {result.errorMessages.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {flatCategories.length === 0 && (
            <p className="text-sm text-amber-700">请先维护物料分类后再导入需要自动编号的物料。</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 p-4">
          {unresolvedMissingRows.length > 0 && (
            <span className="mr-auto text-xs text-amber-700">还有 {unresolvedMissingRows.length} 行缺少图号/编号需要选择处理方式</span>
          )}
          <button onClick={resetAndClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">关闭</button>
          <button
            onClick={confirmImport}
            disabled={rows.length === 0 || unresolvedMissingRows.length > 0 || confirming}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {confirming ? "导入中..." : "确认导入"}
          </button>
        </div>
      </div>
    </div>
  );
}
