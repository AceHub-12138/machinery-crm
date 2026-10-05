"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, FileText, Phone, Plus, Trash2 } from "lucide-react";

import { CustomerLifecycleBar } from "@/components/customers/customer-lifecycle-bar";
import { CUSTOMER_STATUS_LABELS } from "@/lib/constants";

function formatMoney(value: any) {
  if (value === null || value === undefined || value === "") return "-";
  return `¥${Number(value).toLocaleString("zh-CN")}`;
}

function productLabel(product: any) {
  return `${product.model} ${product.translations?.[0]?.name || product.category || ""}`.trim();
}

function quoteAmount(quote: any) {
  if (quote.items?.length) {
    return quote.items.reduce((sum: number, item: any) => sum + Number(item.quotedPrice || 0) * Number(item.quantity || 1), 0);
  }
  return Number(quote.quotedPrice || 0);
}

function contractEquipmentLabel(contract: any) {
  const mainItems = contract.items?.filter((item: any) => item.itemType === "MAIN") || [];
  if (mainItems.length) {
    return mainItems.map((item: any) => `${item.productNameSnapshot || ""} ${item.productModelSnapshot || ""}`.trim()).join("、");
  }
  return `${contract.equipmentName || ""} ${contract.equipmentModel || ""}`.trim() || "-";
}

const PAYMENT_STATUS: Record<string, { label: string; color: string }> = {
  UNPAID: { label: "未收款", color: "bg-red-50 text-red-700" },
  PARTIAL_PAID: { label: "部分收款", color: "bg-yellow-50 text-yellow-700" },
  PAID: { label: "已收款", color: "bg-green-50 text-green-700" },
};

type QuoteLine = { key: string; productId: string; quotedPrice: string; quantity: string };

async function readJson(res: Response) {
  return res.json().catch(() => ({}));
}

function makeClientId() {
  const uuidFn = typeof crypto !== "undefined" ? (crypto as any)["randomUUID"] : undefined;
  if (typeof uuidFn === "function") return uuidFn.call(crypto);
  return `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [customer, setCustomer] = useState<any>(null);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("follow");

  const [followForm, setFollowForm] = useState({ followType: "PHONE", content: "", result: "", address: "", nextFollowDate: "", newStatus: "" });
  const [followLoading, setFollowLoading] = useState(false);

  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [quoteRemark, setQuoteRemark] = useState("");
  const [mainLines, setMainLines] = useState<QuoteLine[]>([{ key: "main", productId: "", quotedPrice: "", quantity: "1" }]);
  const [optionalLines, setOptionalLines] = useState<QuoteLine[]>([]);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [transferQuote, setTransferQuote] = useState<any>(null);

  const mainProducts = useMemo(() => products.filter((product) => product.productType !== "OPTIONAL"), [products]);
  const optionalProducts = useMemo(() => products.filter((product) => product.productType === "OPTIONAL"), [products]);
  const quoteTotal = useMemo(() => [...mainLines, ...optionalLines].reduce(
    (sum, line) => sum + Number(line.quotedPrice || 0) * Math.max(1, Number(line.quantity || 1)),
    0
  ), [mainLines, optionalLines]);

  const fetchAll = () => {
    setLoading(true);
    fetch(`/api/customers/${params.id}`)
      .then(async (res) => {
        const data = await readJson(res);
        if (!res.ok) throw new Error(data.error || "无权访问或客户不存在");
        return data;
      })
      .then(setCustomer)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    fetch(`/api/customers/${params.id}/quotes`).then(readJson).then((data) => setQuotes(Array.isArray(data) ? data : []));
    fetch(`/api/customers/${params.id}/contracts`).then(readJson).then((data) => setContracts(Array.isArray(data) ? data : []));
    fetch("/api/products").then(readJson).then((data) => setProducts(Array.isArray(data) ? data : []));
  };

  useEffect(() => {
    fetchAll();
  }, [params.id]);

  const addMainLine = () => setMainLines((lines) => [...lines, { key: makeClientId(), productId: "", quotedPrice: "", quantity: "1" }]);
  const updateMainLine = (key: string, patch: Partial<QuoteLine>) => setMainLines((lines) => lines.map((line) => line.key === key ? { ...line, ...patch } : line));
  const removeMainLine = (key: string) => setMainLines((lines) => lines.length > 1 ? lines.filter((line) => line.key !== key) : lines);
  const addOptionalLine = () => setOptionalLines((lines) => [...lines, { key: makeClientId(), productId: "", quotedPrice: "", quantity: "1" }]);
  const updateOptionalLine = (key: string, patch: Partial<QuoteLine>) => setOptionalLines((lines) => lines.map((line) => line.key === key ? { ...line, ...patch } : line));
  const removeOptionalLine = (key: string) => setOptionalLines((lines) => lines.filter((line) => line.key !== key));

  const handleFollowSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!followForm.content) return;
    setFollowLoading(true);
    try {
      const res = await fetch("/api/follows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: params.id, ...followForm, newStatus: followForm.newStatus || undefined }),
      });
      if (res.ok) {
        setFollowForm({ followType: "PHONE", content: "", result: "", address: "", nextFollowDate: "", newStatus: "" });
        fetchAll();
      }
    } finally {
      setFollowLoading(false);
    }
  };

  const handleQuoteSubmit = async () => {
    setQuoteError("");
    if (mainLines.some((line) => !line.productId || line.quotedPrice === "")) {
      setQuoteError("请为每条主产品选择产品并填写报价");
      return;
    }
    setQuoteLoading(true);
    try {
      const optionalItems = optionalLines.filter((line) => line.productId);
      const res = await fetch("/api/customer-quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: params.id,
          remark: quoteRemark || null,
          items: [
            ...mainLines.map((line, index) => ({ productId: line.productId, itemType: "MAIN", quotedPrice: line.quotedPrice, quantity: line.quantity || 1, sortOrder: index })),
            ...optionalItems.map((line, index) => ({ productId: line.productId, itemType: "OPTIONAL", quotedPrice: line.quotedPrice || 0, quantity: line.quantity || 1, sortOrder: mainLines.length + index })),
          ],
        }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setQuoteError(data.error || "保存报价失败");
        return;
      }
      setQuoteRemark("");
      setMainLines([{ key: "main", productId: "", quotedPrice: "", quantity: "1" }]);
      setOptionalLines([]);
      setShowQuoteForm(false);
      setActiveTab("quotes");
      fetchAll();
    } catch {
      setQuoteError("网络错误，请稍后重试");
    } finally {
      setQuoteLoading(false);
    }
  };

  const handleTransferToContract = async (quote: any) => {
    const res = await fetch(`/api/customer-quotes/${quote.id}/contract`);
    const data = await readJson(res);
    if (!res.ok) {
      alert(data.error || "无法读取报价关联合同");
      return;
    }
    if (!data.contract) {
      router.push(`/contracts/new?quoteId=${quote.id}`);
      return;
    }
    if (data.locked) {
      alert("当前合同已锁定，如需修改，请联系超级管理员审批。");
      router.push(`/contracts/${data.contract.id}`);
      return;
    }
    setTransferQuote({ quote, contract: data.contract });
  };

  const updateContractFromQuote = async () => {
    if (!transferQuote) return;
    const res = await fetch(`/api/customer-quotes/${transferQuote.quote.id}/update-contract`, { method: "POST" });
    const data = await readJson(res);
    if (!res.ok) {
      alert(data.error || "更新合同失败");
      return;
    }
    setTransferQuote(null);
    router.push(`/contracts/${data.id}`);
  };

  if (loading) return <p className="text-center py-8 text-gray-500">加载中...</p>;
  if (error) return <div className="text-center py-8"><p className="text-red-600">{error}</p><button onClick={() => router.back()} className="text-sm text-gray-600 mt-2">返回</button></div>;
  if (!customer) return null;

  const isWon = customer.status === "WON" || contracts.some((contract) => contract.contractStatus === "SIGNED");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"><ArrowLeft className="w-4 h-4" /></button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-gray-900">{customer.companyName}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full ${isWon ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"}`}>{isWon ? "已成交" : "未成交"}</span>
          </div>
          <p className="text-sm text-gray-500">{customer.contactName} · {customer.province || customer.businessLine}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowQuoteForm(true)} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50"><Plus className="w-3 h-3" />新增报价</button>
          <Link href={`/contracts/new?customerId=${params.id}`} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50"><FileText className="w-3 h-3" />新增合同</Link>
        </div>
      </div>

      <CustomerLifecycleBar customerId={customer.id} status={customer.status} />

      <div className="flex gap-1 bg-white rounded-xl border border-gray-200 p-1">
        {[{ key: "follow", label: "跟进记录" }, { key: "quotes", label: "报价记录" }, { key: "contracts", label: "合同信息" }].map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === tab.key ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"}`}>{tab.label}</button>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">基本信息</h2>
            <dl className="space-y-2 text-sm">
              <div><dt className="text-xs text-gray-500">状态</dt><dd className="mt-0.5"><span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{CUSTOMER_STATUS_LABELS[customer.status] || customer.status}</span></dd></div>
              <div><dt className="text-xs text-gray-500">等级</dt><dd className="text-sm text-gray-900 mt-0.5">{customer.customerLevel} 级</dd></div>
              <div><dt className="text-xs text-gray-500">类型</dt><dd className="text-sm text-gray-900 mt-0.5">{customer.customerType}</dd></div>
              <div><dt className="text-xs text-gray-500">来源</dt><dd className="text-sm text-gray-900 mt-0.5">{customer.customerSource}</dd></div>
              {customer.phone && <div><dt className="text-xs text-gray-500">电话</dt><dd className="text-sm text-gray-900 mt-0.5 flex items-center gap-2">{customer.phone}<a href={`tel:${customer.phone}`} className="text-blue-600"><Phone className="w-3.5 h-3.5" /></a></dd></div>}
              {customer.email && <div><dt className="text-xs text-gray-500">邮箱</dt><dd className="text-sm text-gray-900 mt-0.5">{customer.email}</dd></div>}
              <div><dt className="text-xs text-gray-500">负责人</dt><dd className="text-sm text-gray-900 mt-0.5">{customer.assignedUser?.name || "未分配"}</dd></div>
              {customer.address && <div><dt className="text-xs text-gray-500">地址</dt><dd className="text-sm text-gray-900 mt-0.5">{customer.address}</dd></div>}
            </dl>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          {showQuoteForm && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700">新增报价</h2>
                <p className="text-sm font-semibold text-gray-900">合计：{formatMoney(quoteTotal)}</p>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-medium text-gray-600">产品明细</h3>
                  <button onClick={addMainLine} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50"><Plus className="w-3 h-3" />添加产品</button>
                </div>
                {mainLines.map((line, index) => {
                  const selected = mainProducts.find((product) => product.id === line.productId);
                  const subtotal = Number(line.quotedPrice || 0) * Math.max(1, Number(line.quantity || 1));
                  return (
                    <div key={line.key} className="grid grid-cols-1 sm:grid-cols-[1fr_130px_80px_110px_36px] gap-2 items-start">
                      <div>
                        <select value={line.productId} onChange={(event) => updateMainLine(line.key, { productId: event.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
                          <option value="">请选择产品 {index + 1}</option>
                          {mainProducts.map((product) => (<option key={product.id} value={product.id}>{productLabel(product)}</option>))}
                        </select>
                        {selected && <p className="text-xs text-gray-400 mt-1">出厂价：{formatMoney(selected.factoryPrice)}</p>}
                      </div>
                      <input type="number" min="0" value={line.quotedPrice} onChange={(event) => updateMainLine(line.key, { quotedPrice: event.target.value })} placeholder="产品报价"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                      <input type="number" min="1" value={line.quantity} onChange={(event) => updateMainLine(line.key, { quantity: event.target.value })} placeholder="数量"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                      <div className="px-3 py-2 text-sm text-gray-700 bg-gray-50 rounded-lg">{formatMoney(subtotal)}</div>
                      <button onClick={() => removeMainLine(line.key)} disabled={mainLines.length === 1} title={mainLines.length === 1 ? "至少保留一个产品" : "删除产品"}
                        className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-30"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  );
                })}
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-medium text-gray-600">选配产品</h3>
                  <button onClick={addOptionalLine} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50"><Plus className="w-3 h-3" />添加选配</button>
                </div>
                {optionalLines.length === 0 ? <p className="text-xs text-gray-400">未添加选配产品</p> : optionalLines.map((line) => {
                  const selected = optionalProducts.find((product) => product.id === line.productId);
                  const subtotal = Number(line.quotedPrice || 0) * Math.max(1, Number(line.quantity || 1));
                  return (
                    <div key={line.key} className="grid grid-cols-1 sm:grid-cols-[1fr_130px_80px_110px_36px] gap-2 items-start">
                      <div>
                        <select value={line.productId} onChange={(event) => updateOptionalLine(line.key, { productId: event.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
                          <option value="">请选择选配产品</option>
                          {optionalProducts.map((product) => (<option key={product.id} value={product.id}>{productLabel(product)}</option>))}
                        </select>
                        {selected && <p className="text-xs text-gray-400 mt-1">出厂价：{formatMoney(selected.factoryPrice)}</p>}
                      </div>
                      <input type="number" value={line.quotedPrice} onChange={(event) => updateOptionalLine(line.key, { quotedPrice: event.target.value })} placeholder="选配报价"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                      <input type="number" min="1" value={line.quantity} onChange={(event) => updateOptionalLine(line.key, { quantity: event.target.value })} placeholder="数量"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                      <div className="px-3 py-2 text-sm text-gray-700 bg-gray-50 rounded-lg">{formatMoney(subtotal)}</div>
                      <button onClick={() => removeOptionalLine(line.key)} className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  );
                })}
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">备注</label>
                <input type="text" value={quoteRemark} onChange={(event) => setQuoteRemark(event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
              {quoteError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{quoteError}</p>}
              <div className="flex gap-2">
                <button onClick={handleQuoteSubmit} disabled={quoteLoading} className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50">{quoteLoading ? "保存中..." : "保存报价"}</button>
                <button onClick={() => setShowQuoteForm(false)} className="px-4 py-2 text-gray-700 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
              </div>
            </div>
          )}

          {activeTab === "follow" && (
            <div className="space-y-4">
              <form onSubmit={handleFollowSubmit} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
                <h2 className="text-sm font-semibold text-gray-700">新增跟进</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <select value={followForm.followType} onChange={(event) => setFollowForm({ ...followForm, followType: event.target.value })}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
                    <option value="PHONE">电话</option>
                    <option value="WECHAT">微信</option>
                    <option value="EMAIL">邮件</option>
                    <option value="VISIT">拜访</option>
                    <option value="OTHER">其他</option>
                  </select>
                  <input type="date" value={followForm.nextFollowDate} onChange={(event) => setFollowForm({ ...followForm, nextFollowDate: event.target.value })}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                </div>
                <textarea value={followForm.content} onChange={(event) => setFollowForm({ ...followForm, content: event.target.value })} rows={3} placeholder="跟进内容"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
                <textarea value={followForm.result} onChange={(event) => setFollowForm({ ...followForm, result: event.target.value })} rows={2} placeholder="跟进结果"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
                <input type="text" value={followForm.address} onChange={(event) => setFollowForm({ ...followForm, address: event.target.value })} placeholder="地址(选填)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                <button type="submit" disabled={followLoading} className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50">{followLoading ? "保存中..." : "保存跟进"}</button>
              </form>
              <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
                <h2 className="text-sm font-semibold text-gray-700">跟进记录</h2>
                {!customer.followRecords?.length && <p className="text-sm text-gray-400">暂无跟进记录</p>}
                {customer.followRecords?.map((record: any) => (
                  <div key={record.id} className="border border-gray-100 rounded-lg p-3">
                    <p className="text-sm text-gray-900">{record.content}</p>
                    {record.result && <p className="text-xs text-gray-500 mt-1">{record.result}</p>}
                    {record.address && <p className="text-xs text-gray-400 mt-1">📍 {record.address}</p>}
                    <p className="text-xs text-gray-400 mt-2">{new Date(record.createdAt).toLocaleString("zh-CN")} · {record.user?.name || ""}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "quotes" && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
              <h2 className="text-sm font-semibold text-gray-700">报价记录</h2>
              {!quotes.length && <p className="text-sm text-gray-400">暂无报价记录</p>}
              {quotes.map((quote) => (
                <div key={quote.id} className="border border-gray-100 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{formatMoney(quoteAmount(quote))}</p>
                      <p className="text-xs text-gray-500 mt-1">{new Date(quote.createdAt).toLocaleString("zh-CN")} · {quote.createdBy?.name || ""}</p>
                      <div className="mt-2 space-y-1">
                        {(quote.items?.length ? quote.items : [{ itemType: "MAIN", productNameSnapshot: quote.product?.translations?.[0]?.name, productModelSnapshot: quote.product?.model, quotedPrice: quote.quotedPrice, quantity: 1, factoryPriceSnapshot: quote.factoryPriceSnapshot }]).map((item: any, index: number) => (
                          <p key={item.id || index} className="text-xs text-gray-600">
                            {item.itemType === "MAIN" ? "产品" : "选配"}：{item.productNameSnapshot || "-"} {item.productModelSnapshot || ""} · 单价 {formatMoney(item.quotedPrice)} × {item.quantity || 1} · 小计 {formatMoney(Number(item.quotedPrice || 0) * Number(item.quantity || 1))} · 出厂价 {formatMoney(item.factoryPriceSnapshot)}
                          </p>
                        ))}
                      </div>
                      {quote.remark && <p className="text-xs text-gray-500 mt-2">备注：{quote.remark}</p>}
                    </div>
                    <button onClick={() => handleTransferToContract(quote)} className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-800">一键转合同</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === "contracts" && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
              <h2 className="text-sm font-semibold text-gray-700">合同信息</h2>
              {!contracts.length && <p className="text-sm text-gray-400">暂无合同</p>}
              {contracts.map((contract) => (
                <Link key={contract.id} href={`/contracts/${contract.id}`} className="block border border-gray-100 rounded-lg p-3 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{contract.contractNo}</p>
                      <p className="text-xs text-gray-500 mt-1">{contractEquipmentLabel(contract)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-gray-900">{formatMoney(contract.amount)}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${PAYMENT_STATUS[contract.paymentStatus]?.color}`}>{PAYMENT_STATUS[contract.paymentStatus]?.label || contract.paymentStatus}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {transferQuote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-base font-semibold text-gray-900">该报价已生成合同，是否更新对应客户合同？</h2>
            <p className="text-sm text-gray-500">选择“是”会按当前报价更新来源合同，并重新校验锁定状态、合同金额和已收款金额。</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setTransferQuote(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">否</button>
              <button onClick={updateContractFromQuote} className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800">是</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
