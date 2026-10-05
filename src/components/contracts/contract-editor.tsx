"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { CustomerSearchCombobox } from "@/components/customers/customer-search-combobox";

function formatMoney(value: any) {
  if (!value && value !== 0) return "-";
  return `¥${Number(value).toLocaleString("zh-CN")}`;
}

function productLabel(product: any) {
  return `${product.model} ${product.translations?.[0]?.name || product.category || ""}`;
}

function toDateInput(value: any) {
  if (!value) return "";
  return new Date(value).toISOString().split("T")[0];
}

async function readJson(res: Response) {
  return res.json().catch(() => ({}));
}

type ContractLine = {
  key: string;
  productId: string;
  itemType: "MAIN" | "OPTIONAL";
  contractPrice: string;
  quantity: string;
  estimatedShipmentDate: string;
};


function makeClientId() {
  const uuidFn = typeof crypto !== "undefined" ? (crypto as any)["randomUUID"] : undefined;
  if (typeof uuidFn === "function") return uuidFn.call(crypto);
  return `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

type Props = {
  mode: "new" | "edit";
  contractId?: string;
  quoteId?: string;
  initialCustomerId?: string;
};

export function ContractEditor({ mode, contractId, quoteId, initialCustomerId }: Props) {
  const router = useRouter();
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [form, setForm] = useState({
    contractNo: "",
    signedDate: new Date().toISOString().split("T")[0],
    estimatedShipmentDate: "",
    customerId: initialCustomerId || "",
    amount: "",
    contractStatus: "SIGNED",
    remark: "",
    attachmentUrl: "",
  });
  const [mainLines, setMainLines] = useState<ContractLine[]>([
    { key: "main", productId: "", itemType: "MAIN", contractPrice: "", quantity: "1", estimatedShipmentDate: "" },
  ]);
  const [optionalLines, setOptionalLines] = useState<ContractLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [lockedMessage, setLockedMessage] = useState("");

  const mainProducts = useMemo(() => products.filter((product) => product.productType !== "OPTIONAL"), [products]);
  const optionalProducts = useMemo(() => products.filter((product) => product.productType === "OPTIONAL"), [products]);

  const itemTotal = useMemo(() => {
    const main = mainLines.reduce((sum, line) => sum + Number(line.contractPrice || 0) * Math.max(1, Number(line.quantity || 1)), 0);
    const optional = optionalLines.reduce((sum, line) => sum + Number(line.contractPrice || 0) * Math.max(1, Number(line.quantity || 1)), 0);
    return main + optional;
  }, [mainLines, optionalLines]);

  useEffect(() => {
    setForm((prev) => ({ ...prev, amount: String(itemTotal) }));
  }, [itemTotal]);

  useEffect(() => {
    const loadBase = async () => {
      const productRes = await fetch("/api/products");
      const productData = await readJson(productRes);
      setProducts(Array.isArray(productData) ? productData : []);
    };

    const loadQuote = async () => {
      if (!quoteId || mode !== "new") return;
      const res = await fetch(`/api/customer-quotes/${quoteId}`);
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "读取报价失败");
      const items = data.items || [];
      setForm((prev) => ({
        ...prev,
        customerId: data.customerId,
        amount: data.quotedPrice ? String(Number(data.quotedPrice)) : "",
        remark: data.remark || "",
      }));
      const quoteMainItems = items.filter((item: any) => item.itemType === "MAIN");
      setMainLines((quoteMainItems.length ? quoteMainItems : [{ id: "main", productId: data.productId, quotedPrice: data.quotedPrice, quantity: 1 }]).map((item: any, index: number) => ({
        key: item.id || `main_${index}`,
        productId: item.productId || "",
        itemType: "MAIN",
        contractPrice: item.quotedPrice !== null && item.quotedPrice !== undefined ? String(Number(item.quotedPrice)) : "",
        quantity: String(item.quantity || 1),
        estimatedShipmentDate: "",
      })));
      setOptionalLines(items.filter((item: any) => item.itemType === "OPTIONAL").map((item: any) => ({
        key: item.id || makeClientId(),
        productId: item.productId,
        itemType: "OPTIONAL",
        contractPrice: item.quotedPrice ? String(Number(item.quotedPrice)) : "",
        quantity: String(item.quantity || 1),
        estimatedShipmentDate: "",
      })));
    };

    const loadContract = async () => {
      if (!contractId || mode !== "edit") return;
      const res = await fetch(`/api/contracts/${contractId}`);
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "读取合同失败");
      if (!data.canEdit) {
        setLockedMessage("当前合同已锁定，如需修改，请联系超级管理员审批。");
      }
      const items = data.items || [];
      setForm({
        contractNo: data.contractNo || "",
        signedDate: toDateInput(data.signedDate) || new Date().toISOString().split("T")[0],
        estimatedShipmentDate: toDateInput(data.estimatedShipmentDate),
        customerId: data.customerId || "",
        amount: data.amount ? String(Number(data.amount)) : "",
        contractStatus: data.contractStatus || "SIGNED",
        remark: data.remark || "",
        attachmentUrl: data.attachmentUrl || "",
      });
      setSelectedCustomer(data.customer || null);
      const contractMainItems = items.filter((item: any) => item.itemType === "MAIN");
      setMainLines((contractMainItems.length ? contractMainItems : [{ id: "main", productId: data.productId, contractPrice: data.amount, quantity: 1 }]).map((item: any, index: number) => ({
        key: item.id || `main_${index}`,
        productId: item.productId || "",
        itemType: "MAIN",
        contractPrice: item.contractPrice !== null && item.contractPrice !== undefined ? String(Number(item.contractPrice)) : "",
        quantity: String(item.quantity || 1),
        estimatedShipmentDate: toDateInput(item.estimatedShipmentDate),
      })));
      setOptionalLines(items.filter((item: any) => item.itemType === "OPTIONAL").map((item: any) => ({
        key: item.id || makeClientId(),
        productId: item.productId,
        itemType: "OPTIONAL",
        contractPrice: item.contractPrice ? String(Number(item.contractPrice)) : "",
        quantity: String(item.quantity || 1),
        estimatedShipmentDate: "",
      })));
    };

    setLoading(true);
    loadBase()
      .then(loadQuote)
      .then(loadContract)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [contractId, mode, quoteId]);

  const addOptionalLine = () => {
    setOptionalLines((lines) => [...lines, { key: makeClientId(), productId: "", itemType: "OPTIONAL", contractPrice: "", quantity: "1", estimatedShipmentDate: "" }]);
  };

  const addMainLine = () => {
    setMainLines((lines) => [...lines, { key: makeClientId(), productId: "", itemType: "MAIN", contractPrice: "", quantity: "1", estimatedShipmentDate: "" }]);
  };

  const updateMainLine = (key: string, patch: Partial<ContractLine>) => {
    setMainLines((lines) => lines.map((line) => line.key === key ? { ...line, ...patch } : line));
  };

  const removeMainLine = (key: string) => {
    setMainLines((lines) => lines.length > 1 ? lines.filter((line) => line.key !== key) : lines);
  };

  const updateOptionalLine = (key: string, patch: Partial<ContractLine>) => {
    setOptionalLines((lines) => lines.map((line) => line.key === key ? { ...line, ...patch } : line));
  };

  const removeOptionalLine = (key: string) => {
    setOptionalLines((lines) => lines.filter((line) => line.key !== key));
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/upload/contracts", { method: "POST", body: formData });
      const data = await readJson(res);
      if (!res.ok) {
        setError(data.error || "上传失败");
        return;
      }
      setForm((prev) => ({ ...prev, attachmentUrl: data.url }));
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (lockedMessage) return;
    if (!form.contractNo || !form.customerId || mainLines.some((line) => !line.productId || line.contractPrice === "")) {
      setError("合同编号、客户、主产品和合同金额为必填项");
      return;
    }

    setSaving(true);
    setError("");
    const items = [
      ...mainLines,
      ...optionalLines.filter((line) => line.productId),
    ].map((line, index) => ({
      productId: line.productId,
      itemType: line.itemType,
      contractPrice: line.contractPrice || 0,
      quantity: line.quantity || 1,
      estimatedShipmentDate: line.estimatedShipmentDate || null,
      sortOrder: index,
    }));

    try {
      const res = await fetch(mode === "new" ? "/api/contracts" : `/api/contracts/${contractId}`, {
        method: mode === "new" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          sourceQuoteId: mode === "new" ? quoteId || null : undefined,
          items,
        }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setError(data.error || "保存合同失败");
        return;
      }
      router.push(`/contracts/${data.id}`);
    } catch (err: any) {
      setError(err.message || "网络错误");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-center py-8 text-gray-500">加载中...</p>;

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">{mode === "new" ? "新增合同" : "编辑合同"}</h1>

      {lockedMessage && (
        <div className="mb-4 rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          {lockedMessage}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">合同编号 *</label>
            <input type="text" value={form.contractNo} disabled={!!lockedMessage} onChange={(event) => setForm({ ...form, contractNo: event.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">签订日期 *</label>
            <input type="date" value={form.signedDate} disabled={!!lockedMessage} onChange={(event) => setForm({ ...form, signedDate: event.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">预计发货日期</label>
            <input type="date" value={form.estimatedShipmentDate} disabled={!!lockedMessage} onChange={(event) => setForm({ ...form, estimatedShipmentDate: event.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">合同状态</label>
            <select value={form.contractStatus} disabled={!!lockedMessage} onChange={(event) => setForm({ ...form, contractStatus: event.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50">
              <option value="SIGNED">已签订</option>
              <option value="DRAFT">已做合同</option>
              <option value="CANCELLED">已取消</option>
              <option value="COMPLETED">已完成</option>
              <option value="ARCHIVED">已归档</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">客户 *</label>
            <CustomerSearchCombobox value={form.customerId} disabled={!!lockedMessage} selected={selectedCustomer} onChange={(customer) => { setSelectedCustomer(customer); setForm((current) => ({ ...current, customerId: customer?.id || "" })); }} />
            {selectedCustomer && <p className="text-xs text-gray-400 mt-1">{selectedCustomer.contactName} · {selectedCustomer.phone || "无电话"} · {[selectedCustomer.province, selectedCustomer.city].filter(Boolean).join(" ") || selectedCustomer.businessLine}</p>}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">合同产品明细</h2>
            <button onClick={addMainLine} disabled={!!lockedMessage}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
              <Plus className="w-3 h-3" />添加产品
            </button>
          </div>
          {mainLines.map((line, index) => {
            const selected = mainProducts.find((product) => product.id === line.productId);
            const subtotal = Number(line.contractPrice || 0) * Math.max(1, Number(line.quantity || 1));
            return (
              <div key={line.key} className="grid grid-cols-1 sm:grid-cols-[1fr_130px_80px_140px_100px_36px] gap-2 items-start">
                <div>
                  <select value={line.productId} disabled={!!lockedMessage} onChange={(event) => updateMainLine(line.key, { productId: event.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50">
                    <option value="">请选择产品 {index + 1}</option>
                    {mainProducts.map((product) => (<option key={product.id} value={product.id}>{productLabel(product)}</option>))}
                  </select>
                  {selected && <p className="text-xs text-gray-400 mt-1">出厂价：{formatMoney(selected.factoryPrice)}</p>}
                </div>
                <input type="number" min="0" value={line.contractPrice} disabled={!!lockedMessage} onChange={(event) => updateMainLine(line.key, { contractPrice: event.target.value })}
                  placeholder="合同价"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50" />
                <input type="number" min="1" value={line.quantity} disabled={!!lockedMessage} onChange={(event) => updateMainLine(line.key, { quantity: event.target.value })}
                  placeholder="数量"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50" />
                <input type="date" value={line.estimatedShipmentDate} disabled={!!lockedMessage} onChange={(event) => updateMainLine(line.key, { estimatedShipmentDate: event.target.value })} title="该合同明细独立交货日期；留空则使用合同表头日期" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50" />
                <div className="px-3 py-2 text-sm text-gray-700 bg-gray-50 rounded-lg">{formatMoney(subtotal)}</div>
                <button onClick={() => removeMainLine(line.key)} disabled={!!lockedMessage || mainLines.length === 1} title={mainLines.length === 1 ? "至少保留一个产品" : "删除产品"}
                  className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-30">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}

          <div className="flex items-center justify-between pt-2">
            <h3 className="text-xs font-medium text-gray-600">选配产品</h3>
            <button onClick={addOptionalLine} disabled={!!lockedMessage}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
              <Plus className="w-3 h-3" />添加选配
            </button>
          </div>
          {optionalLines.length === 0 ? <p className="text-xs text-gray-400">未添加选配产品</p> : optionalLines.map((line) => {
            const selected = optionalProducts.find((product) => product.id === line.productId);
            const subtotal = Number(line.contractPrice || 0) * Math.max(1, Number(line.quantity || 1));
            return (
              <div key={line.key} className="grid grid-cols-1 sm:grid-cols-[1fr_140px_90px_110px_36px] gap-2 items-start">
                <div>
                  <select value={line.productId} disabled={!!lockedMessage} onChange={(event) => updateOptionalLine(line.key, { productId: event.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50">
                    <option value="">请选择选配产品</option>
                    {optionalProducts.map((product) => (<option key={product.id} value={product.id}>{productLabel(product)}</option>))}
                  </select>
                  {selected && <p className="text-xs text-gray-400 mt-1">出厂价：{formatMoney(selected.factoryPrice)}</p>}
                </div>
                <input type="number" value={line.contractPrice} disabled={!!lockedMessage} onChange={(event) => updateOptionalLine(line.key, { contractPrice: event.target.value })}
                  placeholder="合同价"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50" />
                <input type="number" min="1" value={line.quantity} disabled={!!lockedMessage} onChange={(event) => updateOptionalLine(line.key, { quantity: event.target.value })}
                  placeholder="数量"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50" />
                <div className="px-3 py-2 text-sm text-gray-700 bg-gray-50 rounded-lg">{formatMoney(subtotal)}</div>
                <button onClick={() => removeOptionalLine(line.key)} disabled={!!lockedMessage} className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">明细合计</label>
            <div className="px-3 py-2 rounded-lg bg-gray-50 text-sm text-gray-700">{formatMoney(itemTotal)}</div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">合同总价 *</label>
            <div className="px-3 py-2 rounded-lg bg-gray-50 text-sm font-semibold text-gray-900">{formatMoney(itemTotal)}</div>
            <p className="text-xs text-gray-400 mt-1">合同总价由全部产品明细小计自动计算</p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">合同附件</label>
          <input type="file" disabled={!!lockedMessage} onChange={handleFileUpload} accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
            className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200 disabled:opacity-50" />
          {uploading && <p className="text-xs text-gray-400 mt-1">上传中...</p>}
          {form.attachmentUrl && <p className="text-xs text-green-600 mt-1">已上传 {form.attachmentUrl}</p>}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">备注</label>
          <textarea value={form.remark} disabled={!!lockedMessage} onChange={(event) => setForm({ ...form, remark: event.target.value })} rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none disabled:bg-gray-50" />
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

        <div className="flex gap-3">
          <button onClick={handleSubmit} disabled={saving || !!lockedMessage}
            className="px-6 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50">
            {saving ? "保存中..." : "保存合同"}
          </button>
          <button onClick={() => router.back()} className="px-6 py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
