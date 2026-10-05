"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { ArrowDown, ArrowUp, Boxes, ChevronDown, ChevronRight, Eye, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";

type BomLine = {
  clientKey: string;
  parentClientKey: string;
  materialId: string;
  quantity: string;
  level: string;
};

type CategoryNode = {
  id: string;
  name: string;
  code?: string | null;
  children?: CategoryNode[];
};

function makeLine(materialId = "", parentClientKey = ""): BomLine {
  return {
    clientKey: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    parentClientKey,
    materialId,
    quantity: "1",
    level: "1",
  };
}

function productLabel(product: any) {
  if (!product) return "未关联产品";
  const name = product.translations?.[0]?.name;
  return name ? `${product.model} - ${name}` : product.model || product.category || "未命名产品";
}

function productModel(product: any) {
  return product?.model || product?.category || "未命名产品";
}

function displayBomError(message: unknown) {
  return String(message || "整机用料清单保存失败").replaceAll("BOM", "整机用料清单");
}

function flattenCategories(cats: CategoryNode[], depth = 0): Array<CategoryNode & { label: string }> {
  const result: Array<CategoryNode & { label: string }> = [];
  for (const cat of cats) {
    result.push({ ...cat, label: "  ".repeat(depth) + cat.name });
    if (cat.children) result.push(...flattenCategories(cat.children, depth + 1));
  }
  return result;
}

function quantity(value: unknown) {
  return Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function isPackageMaterial(material: any) {
  return String(material?.category?.name || "").includes("零件包");
}

function orderTreeItems<T>(items: T[], idOf: (item: T) => string, parentOf: (item: T) => string) {
  const children = new Map<string, T[]>();
  for (const item of items) children.set(parentOf(item), [...(children.get(parentOf(item)) || []), item]);
  const ordered: T[] = [];
  const visited = new Set<string>();
  const visit = (item: T) => {
    const id = idOf(item);
    if (visited.has(id)) return;
    visited.add(id);
    ordered.push(item);
    for (const child of children.get(id) || []) visit(child);
  };
  for (const root of children.get("") || []) visit(root);
  for (const item of items) visit(item);
  return ordered;
}

export default function BomPage() {
  const { data: session } = useSession();
  const userRole = (session?.user as any)?.role;
  const canEdit = userRole === "SUPER_ADMIN" || userRole === "WAREHOUSE";

  const [boms, setBoms] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState("1");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 0 });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    productId: "",
    version: "v1.0",
    isActive: true,
    remark: "",
    items: [] as BomLine[],
  });
  const [saving, setSaving] = useState(false);
  const [showMaterialPicker, setShowMaterialPicker] = useState(false);
  const [materialSearch, setMaterialSearch] = useState("");
  const [materialCategoryId, setMaterialCategoryId] = useState("");
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
  const [selectedMaterialQuantities, setSelectedMaterialQuantities] = useState<Record<string, string>>({});
  const [pickerParentKey, setPickerParentKey] = useState("");
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());

  const materialMap = useMemo(
    () => new Map(materials.map((material) => [material.id, material])),
    [materials]
  );
  const orderedFormItems = useMemo(() => orderTreeItems(form.items, (item) => item.clientKey, (item) => item.parentClientKey), [form.items]);
  const orderedDetailItems = useMemo(() => orderTreeItems<any>(detail?.items || [], (item) => item.id, (item) => item.parentItemId || ""), [detail]);
  const addedInPickerTargetSet = useMemo(
    () => new Set(
      form.items
        .filter((item) => item.parentClientKey === pickerParentKey)
        .map((item) => item.materialId)
        .filter(Boolean)
    ),
    [form.items, pickerParentKey]
  );
  const filteredMaterials = useMemo(() => {
    const query = materialSearch.trim().toLowerCase();
    return materials.filter((material) => {
      if (materialCategoryId && material.categoryId !== materialCategoryId) return false;
      if (!query) return true;
      const haystack = `${material.code || ""} ${material.drawingNo || ""} ${material.name || ""} ${material.spec || ""} ${material.category?.name || ""}`.toLowerCase();
      return haystack.includes(query);
    }).sort((left, right) => {
      if (!query) return 0;
      const direct = (material: any) => `${material.code || ""} ${material.drawingNo || ""} ${material.name || ""}`.toLowerCase().includes(query) ? 0 : 1;
      return direct(left) - direct(right);
    });
  }, [materials, materialSearch, materialCategoryId]);
  const flatCategories = useMemo(() => flattenCategories(categories), [categories]);
  const pickerParentMaterial = useMemo(() => {
    const parentLine = form.items.find((item) => item.clientKey === pickerParentKey);
    return parentLine ? materialMap.get(parentLine.materialId) : null;
  }, [form.items, materialMap, pickerParentKey]);

  const loadBoms = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (active) params.set("active", active);
    params.set("page", String(page));
    params.set("pageSize", "20");
    const res = await fetch(`/api/erp/boms?${params.toString()}`);
    const data = await res.json();
    setBoms(data.items || []);
    setPagination(data.pagination || { page: 1, pageSize: 20, total: 0, totalPages: 0 });
    setLoading(false);
  };

  const loadDetail = async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    const res = await fetch(`/api/erp/boms/${id}`);
    const data = await res.json();
    setDetail(data);
    setDetailLoading(false);
  };

  useEffect(() => {
    fetch("/api/erp/products?productType=MAIN").then((r) => r.json()).then((d) => setProducts(Array.isArray(d) ? d : []));
    fetch("/api/erp/materials").then((r) => r.json()).then((d) => setMaterials(Array.isArray(d) ? d : []));
    fetch("/api/erp/material-categories").then((r) => r.json()).then((d) => setCategories(Array.isArray(d) ? d : []));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadBoms(); }, 250);
    return () => window.clearTimeout(timer);
  }, [search, active, page]);

  useEffect(() => {
    if (!selectedId && boms[0]?.id) {
      loadDetail(boms[0].id);
    }
  }, [boms, selectedId]);

  const openCreate = () => {
    setEditId(null);
    setShowMaterialPicker(false);
    setPickerParentKey("");
    setCollapsedKeys(new Set());
    setSelectedMaterialIds([]);
    setSelectedMaterialQuantities({});
    setForm({
      productId: products[0]?.id || "",
      version: "v1.0",
      isActive: true,
      remark: "",
      items: [],
    });
    setShowModal(true);
  };

  const openEdit = async (id: string) => {
    const res = await fetch(`/api/erp/boms/${id}`);
    const bom = await res.json();
    setEditId(id);
    setShowMaterialPicker(false);
    setPickerParentKey("");
    setCollapsedKeys(new Set());
    setSelectedMaterialIds([]);
    setSelectedMaterialQuantities({});
    setForm({
      productId: bom.productId || "",
      version: bom.version || "v1.0",
      isActive: bom.isActive !== false,
      remark: bom.remark || "",
      items: (bom.items || []).map((item: any) => ({
        clientKey: item.id,
        parentClientKey: item.parentItemId || "",
        materialId: item.materialId,
        quantity: String(item.quantity || "1"),
        level: String(item.level || "1"),
      })),
    });
    setShowModal(true);
  };

  const addSelectedMaterials = () => {
    setForm((current) => {
      const existing = new Set(
        current.items
          .filter((item) => item.parentClientKey === pickerParentKey)
          .map((item) => item.materialId)
          .filter(Boolean)
      );
      const nextLines = selectedMaterialIds
        .filter((materialId) => materialId && !existing.has(materialId))
        .map((materialId) => ({
          ...makeLine(materialId, pickerParentKey),
          quantity: selectedMaterialQuantities[materialId] || "1",
        }));
      return { ...current, items: [...current.items, ...nextLines] };
    });
    setSelectedMaterialIds([]);
    setSelectedMaterialQuantities({});
    setShowMaterialPicker(false);
  };

  const removeLine = (index: number) => {
    setForm((current) => {
      const target = current.items[index];
      const descendants = new Set<string>();
      const collect = (parentKey: string) => current.items.filter((item) => item.parentClientKey === parentKey).forEach((item) => { descendants.add(item.clientKey); collect(item.clientKey); });
      collect(target.clientKey);
      if (descendants.size > 0 && !confirm(`该零件包包含 ${descendants.size} 个子节点，删除后子节点也会移除，是否继续？`)) return current;
      return { ...current, items: current.items.filter((item) => item.clientKey !== target.clientKey && !descendants.has(item.clientKey)) };
    });
  };

  const updateLine = (index: number, field: keyof BomLine, value: string) => {
    setForm((current) => {
      const items = [...current.items];
      items[index] = { ...items[index], [field]: value };
      return { ...current, items };
    });
  };

  const openMaterialPicker = (parentClientKey = "", onlyPackages = false) => {
    setPickerParentKey(parentClientKey);
    setSelectedMaterialIds([]);
    setSelectedMaterialQuantities({});
    if (onlyPackages) {
      const packageCategory = flatCategories.find((category) => category.name.includes("零件包"));
      setMaterialCategoryId(packageCategory?.id || "");
    } else setMaterialCategoryId("");
    setShowMaterialPicker(true);
  };

  const togglePickerMaterial = (materialId: string, checked: boolean) => {
    setSelectedMaterialIds((current) => checked ? [...current, materialId] : current.filter((id) => id !== materialId));
    setSelectedMaterialQuantities((current) => {
      const next = { ...current };
      if (checked) next[materialId] = next[materialId] || "1";
      else delete next[materialId];
      return next;
    });
  };

  const moveLine = (index: number, direction: -1 | 1) => {
    setForm((current) => {
      const target = current.items[index];
      const siblingIndexes = current.items.map((item, itemIndex) => ({ item, itemIndex })).filter(({ item }) => item.parentClientKey === target.parentClientKey).map(({ itemIndex }) => itemIndex);
      const siblingPosition = siblingIndexes.indexOf(index);
      const swapIndex = siblingIndexes[siblingPosition + direction];
      if (swapIndex === undefined) return current;
      const items = [...current.items];
      [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
      return { ...current, items };
    });
  };

  const lineDepth = (line: BomLine) => {
    const byKey = new Map(form.items.map((item) => [item.clientKey, item]));
    let depth = 0;
    let parent = line.parentClientKey;
    const seen = new Set<string>();
    while (parent && byKey.has(parent) && !seen.has(parent)) { seen.add(parent); depth += 1; parent = byKey.get(parent)!.parentClientKey; }
    return depth;
  };

  const lineVisible = (line: BomLine) => {
    const byKey = new Map(form.items.map((item) => [item.clientKey, item]));
    let parent = line.parentClientKey;
    while (parent && byKey.has(parent)) { if (collapsedKeys.has(parent)) return false; parent = byKey.get(parent)!.parentClientKey; }
    return true;
  };

  const saveBom = async () => {
    if (!form.productId) return;
    const items = orderedFormItems
      .filter((item) => item.materialId && item.quantity)
      .map((item, index) => ({
        ...item,
        sortOrder: index * 10,
      }));
    if (items.length === 0) return;

    setSaving(true);
    const url = editId ? `/api/erp/boms/${editId}` : "/api/erp/boms";
    const method = editId ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, items }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      alert(displayBomError(data.error));
      return;
    }
    setShowModal(false);
    await loadBoms();
    await loadDetail(data.id || editId!);
  };

  const disableBom = async (id: string) => {
    if (!confirm("确定停用这个整机用料清单版本吗？")) return;
    await fetch(`/api/erp/boms/${id}`, { method: "DELETE" });
    await loadBoms();
    if (selectedId === id) {
      setDetail((current: any) => current ? { ...current, isActive: false } : current);
    }
  };

  return (
    <PageContainer variant="data" className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">整机用料清单</h1>
          <p className="text-sm text-gray-500 mt-1">用于维护每台机床生产所需的标准物料，原行业术语为 BOM。</p>
        </div>
        {canEdit && (
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--brand-orange)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-orange-hover)]"
          >
            <Plus className="w-4 h-4" />新建整机清单
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] p-4 shadow-[var(--shadow-card)]">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="搜索产品型号 / 名称..."
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
        </div>
        <select
          value={active}
          onChange={(event) => { setActive(event.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
        >
          <option value="1">仅启用</option>
          <option value="">全部版本</option>
          <option value="0">已停用</option>
        </select>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.05fr)_minmax(380px,0.95fr)] gap-4">
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] shadow-[var(--shadow-card)]">
          {loading ? (
            <p className="text-center py-8 text-sm text-gray-500">加载中...</p>
          ) : boms.length === 0 ? (
            <p className="text-center py-8 text-sm text-gray-500">暂无整机用料清单</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-[var(--border)] bg-[var(--surface-muted)]">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">产品</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">版本</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">物料数</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">状态</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">更新</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {boms.map((bom) => (
                    <tr
                      key={bom.id}
                      className={`h-12 cursor-pointer border-b border-[var(--border)] hover:bg-[var(--surface-hover)] ${selectedId === bom.id ? "bg-[var(--surface-muted)]" : ""}`}
                      onClick={() => loadDetail(bom.id)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{productLabel(bom.product)}</p>
                        <p className="text-xs text-gray-500">{bom.remark || "-"}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{bom.version}</td>
                      <td className="px-4 py-3 text-right">{bom.items?.length || 0}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${bom.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                          {bom.isActive ? "启用" : "停用"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{new Date(bom.updatedAt).toLocaleDateString("zh-CN")}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={(event) => { event.stopPropagation(); loadDetail(bom.id); }} className="text-gray-400 hover:text-gray-700">
                            <Eye className="w-4 h-4" />
                          </button>
                          {canEdit && (
                            <>
                              <button onClick={(event) => { event.stopPropagation(); openEdit(bom.id); }} className="text-gray-400 hover:text-gray-700">
                                <Pencil className="w-4 h-4" />
                              </button>
                              {bom.isActive && (
                                <button onClick={(event) => { event.stopPropagation(); disableBom(bom.id); }} className="text-gray-400 hover:text-red-600">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] p-4 shadow-[var(--shadow-card)]">
            {!selectedId ? (
              <p className="text-sm text-gray-500 text-center py-8">选择一张清单查看明细</p>
            ) : detailLoading ? (
              <p className="text-sm text-gray-500 text-center py-8">明细加载中...</p>
            ) : detail ? (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">{productModel(detail.product)} 用料清单</h2>
                    <p className="text-xs text-gray-500 mt-1">版本 {detail.version} · {detail.isActive ? "启用" : "停用"}</p>
                    <p className="mt-1 text-xs text-gray-500">零件包是分组；缩进的子物料数量会与零件包数量、生产台数相乘，用于工单缺料测算。</p>
                  </div>
                  <Boxes className="w-5 h-5 text-gray-400" />
                </div>

                <div className="max-h-[65vh] overflow-auto rounded-lg border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-gray-600">物料</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-600">单台用量</th>
                        <th className="text-center px-3 py-2 font-medium text-gray-600">结构</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderedDetailItems.map((item: any) => {
                        const hasChildren = detail.items.some((candidate: any) => candidate.parentItemId === item.id);
                        const depth = Math.max(Number(item.level || 1) - 1, 0);
                        return (
                        <tr key={item.id} className="border-b border-gray-100">
                          <td className="px-3 py-2" style={{ paddingLeft: 12 + depth * 20 }}>
                            <p className="font-medium text-gray-900">{item.material?.name}</p>
                            <p className="text-xs text-gray-500">{item.material?.code} {item.material?.spec || ""}</p>
                          </td>
                          <td className="px-3 py-2 text-right">{quantity(item.quantity)} {item.material?.unit}</td>
                          <td className="px-3 py-2 text-center"><span className={`rounded px-1.5 py-0.5 text-[11px] ${hasChildren ? "bg-blue-50 text-blue-700" : depth > 0 ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-600"}`}>{hasChildren ? "零件包" : depth > 0 ? "子物料" : "整机物料"}</span></td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>

        </div>
      </div>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40">上一页</button>
          <span className="text-sm text-gray-500">第 {page} / {pagination.totalPages} 页</span>
          <button onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))} disabled={page >= pagination.totalPages} className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40">下一页</button>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowModal(false)}>
          <div className="flex h-[82vh] max-h-[85vh] w-[80vw] max-w-[1100px] flex-col overflow-hidden rounded-xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 p-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{editId ? "编辑整机清单" : "新建整机清单"}</h2>
                <p className="text-xs text-gray-500 mt-1">先选择产品型号，再批量加入物料并填写单台用量。</p>
              </div>
              <button onClick={() => setShowModal(false)} className="text-sm text-gray-500 hover:text-gray-900">关闭</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">产品型号 *</label>
                  <select
                    value={form.productId}
                    onChange={(event) => setForm((current) => ({ ...current, productId: event.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="">请选择产品型号</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>{productLabel(product)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">版本 *</label>
                  <input
                    value={form.version}
                    onChange={(event) => setForm((current) => ({ ...current, version: event.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 pt-6">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
                    className="rounded border-gray-300"
                  />
                  设为启用版本
                </label>
              </div>

              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-600 mb-1">备注</label>
                <input
                  value={form.remark}
                  onChange={(event) => setForm((current) => ({ ...current, remark: event.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="例如：BK5030 标准配置"
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700">清单明细</h3>
                    <p className="text-xs text-gray-500 mt-0.5">已加入 {form.items.length} 项物料</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => openMaterialPicker("", true)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><Plus className="w-4 h-4" />新建零件包分组</button>
                    <button onClick={() => openMaterialPicker()} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><Plus className="w-4 h-4" />批量选择物料</button>
                  </div>
                </div>

                {form.items.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 py-10 text-center text-sm text-gray-500">
                    请选择产品型号后，点击“批量选择物料”加入清单。
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full min-w-[820px] text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">物料编号</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">物料名称</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">分类</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">规格</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">单位</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-600">
                            单台用量
                            <span className="block text-[11px] font-normal text-gray-400">生产一台整机需要消耗该物料的数量，默认 1。</span>
                          </th>
                          <th className="px-3 py-2 text-center font-medium text-gray-600">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orderedFormItems.map((item) => ({ item, index: form.items.findIndex((candidate) => candidate.clientKey === item.clientKey) })).filter(({ item }) => lineVisible(item)).map(({ item, index }) => {
                          const material = materialMap.get(item.materialId);
                          const children = form.items.filter((candidate) => candidate.parentClientKey === item.clientKey);
                          const isGroup = children.length > 0;
                          const canHaveChildren = isPackageMaterial(material);
                          const integerUnit = ["件", "个", "台", "套", "包", "组", "根"].includes(material?.unit || "件");
                          const depth = lineDepth(item);
                          return (
                            <tr key={item.clientKey} className="border-t border-gray-100">
                              <td className="px-3 py-2 font-mono text-xs">{material?.code || "-"}</td>
                              <td className="px-3 py-2 font-medium text-gray-900"><div className="flex items-center gap-1" style={{ paddingLeft: depth * 20 }}>{isGroup ? <button onClick={() => setCollapsedKeys((current) => { const next = new Set(current); if (next.has(item.clientKey)) next.delete(item.clientKey); else next.add(item.clientKey); return next; })}>{collapsedKeys.has(item.clientKey) ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button> : <span className="w-5" />}{material?.name || "未选择物料"}{isGroup && <span className="ml-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">虚拟零件包</span>}</div></td>
                              <td className="px-3 py-2 text-gray-600">{material?.category?.name || "-"}</td>
                              <td className="px-3 py-2 text-gray-600">{material?.spec || "-"}</td>
                              <td className="px-3 py-2 text-gray-600">{material?.unit || "件"}</td>
                              <td className="px-3 py-2 text-right">
                                <div className="inline-flex items-center overflow-hidden rounded-lg border border-gray-300"><button type="button" onClick={() => updateLine(index, "quantity", String(Math.max(1, Number(item.quantity || 1) - (integerUnit ? 1 : 0.01))))} className="px-2 py-2 hover:bg-gray-50">−</button><input type="number" min="1" step={integerUnit ? "1" : "0.01"} value={item.quantity} onChange={(event) => updateLine(index, "quantity", event.target.value)} className="w-20 border-x border-gray-300 px-2 py-2 text-right text-sm outline-none" /><button type="button" onClick={() => updateLine(index, "quantity", String(Number(item.quantity || 0) + (integerUnit ? 1 : 0.01)))} className="px-2 py-2 hover:bg-gray-50">+</button></div>
                              </td>
                              <td className="px-3 py-2 text-center">
                                <div className="inline-flex items-center gap-2"><button title="上移" onClick={() => moveLine(index, -1)} className="text-gray-400 hover:text-gray-900"><ArrowUp className="h-4 w-4" /></button><button title="下移" onClick={() => moveLine(index, 1)} className="text-gray-400 hover:text-gray-900"><ArrowDown className="h-4 w-4" /></button>{canHaveChildren && <button title="向零件包添加子物料" onClick={() => openMaterialPicker(item.clientKey)} className="text-blue-600 hover:text-blue-800"><Plus className="h-4 w-4" /></button>}<button title="删除" onClick={() => removeLine(index)} className="text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button></div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-200 p-4">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg">取消</button>
              <button
                onClick={saveBom}
                disabled={saving || !form.productId || form.items.filter((item) => item.materialId && item.quantity).length === 0}
                className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>

          {showMaterialPicker && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowMaterialPicker(false)}>
              <div className="flex h-[76vh] w-[78vw] max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
                <div className="flex items-start justify-between gap-4 border-b border-gray-200 p-5">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900">{pickerParentMaterial ? `向“${pickerParentMaterial.name}”添加子物料` : "批量选择物料"}</h3>
                    <p className="text-xs text-gray-500 mt-1">已选 {selectedMaterialIds.length} 项；同一层级不重复加入，同一子物料可用于不同零件包。</p>
                    {pickerParentMaterial && <p className="mt-1 text-xs text-amber-700">只有物料管理中独立存在的物料才能单独设置数量；零件包规格中的文字说明不会自动拆成子物料。</p>}
                  </div>
                  <button onClick={() => setShowMaterialPicker(false)} className="text-sm text-gray-500 hover:text-gray-900">关闭</button>
                </div>

                <div className="border-b border-gray-200 p-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_auto]">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                      <input
                        value={materialSearch}
                        onChange={(event) => setMaterialSearch(event.target.value)}
                        placeholder="按物料名称、编号/图号、规格搜索"
                        className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                      />
                    </div>
                    <select
                      value={materialCategoryId}
                      onChange={(event) => setMaterialCategoryId(event.target.value)}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                    >
                      <option value="">全部分类</option>
                      {flatCategories.map((category) => (
                        <option key={category.id} value={category.id}>{category.label}</option>
                      ))}
                    </select>
                    <button
                      onClick={() =>
                        setSelectedMaterialIds(
                          filteredMaterials
                            .filter((material) => !addedInPickerTargetSet.has(material.id))
                            .map((material) => material.id)
                        )
                      }
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      全选当前筛选结果
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">选择</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">物料编号</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">物料名称</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">分类</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">规格</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600">单位</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-600">加入数量</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMaterials.map((material) => {
                        const alreadyAdded = addedInPickerTargetSet.has(material.id);
                        const checked = selectedMaterialIds.includes(material.id);
                        return (
                          <tr key={material.id} className={`border-t border-gray-100 ${alreadyAdded ? "bg-gray-50 text-gray-400" : ""}`}>
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={alreadyAdded || checked}
                                disabled={alreadyAdded}
                                onChange={(event) => togglePickerMaterial(material.id, event.target.checked)}
                              />
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">{material.code}</td>
                            <td className="px-3 py-2 font-medium text-gray-900">{material.name}</td>
                            <td className="px-3 py-2">{material.category?.name || "-"}</td>
                            <td className="px-3 py-2">{material.spec || "-"}</td>
                            <td className="px-3 py-2">{material.unit || "件"}</td>
                            <td className="px-3 py-2 text-right"><input type="number" min={["件", "个", "台", "套", "包", "组", "根"].includes(material.unit || "件") ? "1" : "0.01"} step={["件", "个", "台", "套", "包", "组", "根"].includes(material.unit || "件") ? "1" : "0.01"} disabled={alreadyAdded || !checked} value={checked ? selectedMaterialQuantities[material.id] || "1" : ""} onChange={(event) => setSelectedMaterialQuantities((current) => ({ ...current, [material.id]: event.target.value }))} placeholder="1" className="w-24 rounded border px-2 py-1.5 text-right disabled:bg-gray-50" /></td>
                          </tr>
                        );
                      })}
                      {filteredMaterials.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-500">未找到独立物料。请先在“物料管理”中新建该物料，再返回添加并设置数量。</td></tr>}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-gray-200 p-4">
                  <button onClick={() => setShowMaterialPicker(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">取消</button>
                  <button
                    onClick={addSelectedMaterials}
                    disabled={selectedMaterialIds.length === 0 || selectedMaterialIds.some((materialId) => Number(selectedMaterialQuantities[materialId] || 1) <= 0)}
                    className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
                  >
                    加入清单
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}
