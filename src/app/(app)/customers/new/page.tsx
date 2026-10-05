"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  CUSTOMER_SOURCES,
  INTEREST_TAGS,
  CUSTOMER_LEVELS,
} from "@/lib/constants";
import { BUSINESS_LINES } from "@/lib/region-data";
import { ProvinceCitySelect } from "@/components/common/province-city-select";

function formatMoney(v: any) {
  if (!v) return "暂未维护";
  return `¥${Number(v).toLocaleString("zh-CN")}`;
}

export default function NewCustomerPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const userRole = (session?.user as any)?.role;
  const userRegion = (session?.user as any)?.region;
  const userViewScope = (session?.user as any)?.viewScope;
  const userTerritories = ((session?.user as any)?.territories ?? []) as { province: string; cities: string[] }[];
  const seeAll = userRole === "SUPER_ADMIN" || userViewScope === "ALL";

  const [form, setForm] = useState({
    companyName: "", contactName: "", phone: "", wechat: "", whatsapp: "", email: "",
    country: "中国", province: "", city: "",
    businessLine: "国内销售",
    address: "", customerSource: "展会", customerType: "NEW" as string,
    customerLevel: "B" as string, interestTags: [] as string[], assignedUserId: "", remark: "", nextFollowDate: "",
  });

  // 产品报价
  const [products, setProducts] = useState<any[]>([]);
  const [activeUsers, setActiveUsers] = useState<any[]>([]);
  const [quoteProductId, setQuoteProductId] = useState("");
  const [quotePrice, setQuotePrice] = useState("");
  const [quoteRemark, setQuoteRemark] = useState("");
  const [selectedProductPrice, setSelectedProductPrice] = useState<any>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState<any>(null);

  useEffect(() => {
    fetch("/api/products?productType=MAIN")
      .then((response) => response.json())
      .then((data) => setProducts(Array.isArray(data) ? data : []));
  }, []);

  useEffect(() => {
    if (userRole !== "SUPER_ADMIN") {
      setActiveUsers([]);
      return;
    }
    fetch("/api/users/active")
      .then((response) => response.json())
      .then((data) => setActiveUsers(Array.isArray(data) ? data : []))
      .catch(() => setActiveUsers([]));
  }, [userRole]);

  useEffect(() => {
    if (quoteProductId) {
      const p = products.find((p: any) => p.id === quoteProductId);
      setSelectedProductPrice(p?.factoryPrice || null);
    } else {
      setSelectedProductPrice(null);
    }
  }, [quoteProductId, products]);

  const handleChange = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleTagToggle = (tag: string) => {
    setForm((prev) => ({
      ...prev,
      interestTags: prev.interestTags.includes(tag)
        ? prev.interestTags.filter((t) => t !== tag)
        : [...prev.interestTags, tag],
    }));
  };

  const handleSubmit = async (forceCreate = false) => {
    setError("");
    setLoading(true);

    if (!form.companyName || !form.contactName) {
      setError("公司名称和联系人为必填项");
      setLoading(false);
      return;
    }

    try {
      // Step 1: Create customer
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, _forceCreate: forceCreate }),
      });

      const data = await res.json();

      if (res.status === 409 && data.warning) {
        setDuplicateWarning(data);
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setError(data.error || "创建失败");
        setLoading(false);
        return;
      }

      // Step 2: If quote filled, create CustomerQuote
      if (quoteProductId && quotePrice) {
        await fetch("/api/customer-quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerId: data.id,
            productId: quoteProductId,
            quotedPrice: quotePrice,
            remark: quoteRemark || null,
          }),
        });
      }

      // Step 3: Navigate to customer detail
      router.push(`/customers/${data.id}`);
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">新增客户</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        {/* 基础信息 */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">基础信息</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">公司名称 *</label>
              <input type="text" value={form.companyName} onChange={(e) => handleChange("companyName", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">联系人 *</label>
              <input type="text" value={form.contactName} onChange={(e) => handleChange("contactName", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">电话</label>
              <input type="tel" value={form.phone} onChange={(e) => handleChange("phone", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">微信</label>
              <input type="text" value={form.wechat} onChange={(e) => handleChange("wechat", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">WhatsApp</label>
              <input type="text" value={form.whatsapp} onChange={(e) => handleChange("whatsapp", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">邮箱</label>
              <input type="email" value={form.email} onChange={(e) => handleChange("email", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
          </div>
        </div>

        {/* 区域信息 */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">区域信息</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {seeAll && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">业务线 *</label>
                <select value={form.businessLine} onChange={(e) => handleChange("businessLine", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
                  {BUSINESS_LINES.map((b) => (<option key={b} value={b}>{b}</option>))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">国家</label>
              <input type="text" value={form.country} onChange={(e) => handleChange("country", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <ProvinceCitySelect
              province={form.province}
              city={form.city}
              onChange={({ province, city }) => setForm((f) => ({ ...f, province, city }))}
              allowed={seeAll ? undefined : userTerritories}
              includeForeign={seeAll && form.businessLine === "外贸"}
            />
          </div>
        </div>

        {/* 业务属性 */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">业务属性</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">客户来源</label>
              <select value={form.customerSource} onChange={(e) => handleChange("customerSource", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
                {CUSTOMER_SOURCES.map((s) => (<option key={s} value={s}>{s}</option>))}
              </select>
            </div>
            {userRole === "SUPER_ADMIN" && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">归属业务员 / 负责人</label>
                <select value={form.assignedUserId} onChange={(e) => handleChange("assignedUserId", e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
                  <option value="">未分配</option>
                  {activeUsers.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}（{item.region}）</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">客户类型</label>
              <select value={form.customerType} onChange={(e) => handleChange("customerType", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
                <option value="NEW">新客户</option><option value="OLD">老客户</option><option value="AGENT">代理商</option><option value="END_USER">终端用户</option><option value="DISTRIBUTOR">经销商</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">客户等级</label>
              <select value={form.customerLevel} onChange={(e) => handleChange("customerLevel", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
                {CUSTOMER_LEVELS.map((l) => (<option key={l} value={l}>{l}级</option>))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">下次跟进日期</label>
              <input type="date" value={form.nextFollowDate} onChange={(e) => handleChange("nextFollowDate", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
          </div>
        </div>

        {/* 产品兴趣标签 */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">产品兴趣标签</h2>
          <div className="flex flex-wrap gap-2">
            {INTEREST_TAGS.map((tag) => (
              <button key={tag} type="button" onClick={() => handleTagToggle(tag)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${form.interestTags.includes(tag) ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"}`}>
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* 产品报价 */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">产品报价（可选）</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">选择产品</label>
              <select value={quoteProductId} onChange={(e) => setQuoteProductId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
                <option value="">请选择产品</option>
                {products.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.model} {p.translations?.[0]?.name || p.category}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">报价金额</label>
              <input type="number" value={quotePrice} onChange={(e) => setQuotePrice(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              {quoteProductId && (
                <p className="text-xs text-gray-400 mt-1">
                  出厂价：{formatMoney(selectedProductPrice)}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">报价备注</label>
              <input type="text" value={quoteRemark} onChange={(e) => setQuoteRemark(e.target.value)}
                placeholder="如：含安装调试"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
          </div>
        </div>

        {/* 备注 */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">备注</label>
          <textarea value={form.remark} onChange={(e) => handleChange("remark", e.target.value)} rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
        </div>

        {/* 重复警告 */}
        {duplicateWarning && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-sm text-yellow-800">{duplicateWarning.message}</p>
            <div className="flex gap-3 mt-3">
              <button onClick={() => handleSubmit(true)} className="px-3 py-1.5 bg-yellow-600 text-white text-xs rounded-lg hover:bg-yellow-700">确认保存</button>
              <button onClick={() => setDuplicateWarning(null)} className="px-3 py-1.5 bg-white text-gray-700 text-xs rounded-lg border border-gray-300 hover:bg-gray-50">取消</button>
            </div>
          </div>
        )}

        {error && (<p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>)}

        {/* 提交按钮 */}
        <div className="flex gap-3">
          <button onClick={() => handleSubmit(false)} disabled={loading}
            className="px-6 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50">
            {loading ? "保存中..." : "保存客户"}
          </button>
          <button onClick={() => router.back()}
            className="px-6 py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors">
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
