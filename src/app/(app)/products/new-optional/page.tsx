"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PRODUCT_CATEGORIES } from "@/lib/constants";

export default function NewOptionalProductPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    model: "",
    category: PRODUCT_CATEGORIES[PRODUCT_CATEGORIES.length - 1],
    name: "",
    description: "",
    factoryPrice: "",
    currency: "CNY",
    remark: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!form.model || !form.category || !form.name) {
      setError("产品名称、型号和分类为必填项");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: form.model,
          category: form.category,
          productType: "OPTIONAL",
          factoryPrice: form.factoryPrice || null,
          currency: form.currency,
          remark: form.remark || null,
          translations: [{
            language: "ZH",
            name: form.name,
            description: form.description || null,
            specs: null,
            pdfUrl: null,
          }],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "创建选配产品失败");
        return;
      }
      router.push(`/products/${data.id}`);
    } catch (err: any) {
      setError(err.message || "网络错误");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">新增选配产品</h1>
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">产品名称 *</label>
            <input type="text" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">型号 *</label>
            <input type="text" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">分类 *</label>
            <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as any })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
              {PRODUCT_CATEGORIES.map((category) => (<option key={category} value={category}>{category}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">出厂价</label>
            <input type="number" value={form.factoryPrice} onChange={(event) => setForm({ ...form, factoryPrice: event.target.value })}
              placeholder="0.00"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">币种</label>
            <select value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
              <option value="CNY">CNY 人民币</option>
              <option value="USD">USD 美元</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">描述</label>
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">备注</label>
            <textarea value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
          </div>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

        <div className="flex gap-3">
          <button onClick={handleSubmit} disabled={loading}
            className="px-6 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50">
            {loading ? "保存中..." : "保存选配产品"}
          </button>
          <button onClick={() => router.back()}
            className="px-6 py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
