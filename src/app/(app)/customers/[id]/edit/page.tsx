"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  CUSTOMER_LEVELS,
  CUSTOMER_SOURCES,
  CUSTOMER_STATUS_LABELS,
  CUSTOMER_TYPE_LABELS,
  INTEREST_TAGS,
} from "@/lib/constants";
import { BUSINESS_LINES } from "@/lib/region-data";
import { ProvinceCitySelect } from "@/components/common/province-city-select";

async function readJson(res: Response) {
  return res.json().catch(() => ({}));
}

export default function EditCustomerPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const userRole = (session?.user as any)?.role;
  const userViewScope = (session?.user as any)?.viewScope;
  const userTerritories = ((session?.user as any)?.territories ?? []) as { province: string; cities: string[] }[];
  const seeAll = userRole === "SUPER_ADMIN" || userViewScope === "ALL";

  const [form, setForm] = useState<any>(null);
  const [activeUsers, setActiveUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const [customerRes, usersRes] = await Promise.all([
          fetch(`/api/customers/${params.id}`),
          fetch("/api/users/active"),
        ]);
        const customerData = await readJson(customerRes);
        if (!customerRes.ok) throw new Error(customerData.error || "无权限或客户不存在");
        const usersData = await readJson(usersRes);
        if (!mounted) return;
        setActiveUsers(Array.isArray(usersData) ? usersData : []);
        setForm({
          companyName: customerData.companyName || "",
          contactName: customerData.contactName || "",
          phone: customerData.phone || "",
          wechat: customerData.wechat || "",
          whatsapp: customerData.whatsapp || "",
          email: customerData.email || "",
          country: customerData.country || "中国",
          province: customerData.province || "",
          city: customerData.city || "",
          region: customerData.region || "",
          businessLine: customerData.businessLine || "国内销售",
          address: customerData.address || "",
          customerSource: customerData.customerSource || "展会",
          customerType: customerData.customerType || "NEW",
          customerLevel: customerData.customerLevel || "B",
          status: customerData.status || "NEW_LEAD",
          interestTags: customerData.interestTags || [],
          assignedUserId: customerData.assignedUserId || "",
          remark: customerData.remark || "",
          nextFollowDate: customerData.nextFollowDate ? new Date(customerData.nextFollowDate).toISOString().split("T")[0] : "",
        });
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : "客户信息加载失败");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [params.id]);

  const handleChange = (field: string, value: any) => {
    setForm((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleTagToggle = (tag: string) => {
    setForm((prev: any) => ({
      ...prev,
      interestTags: prev.interestTags.includes(tag)
        ? prev.interestTags.filter((item: string) => item !== tag)
        : [...prev.interestTags, tag],
    }));
  };

  const handleSubmit = async () => {
    if (!form.companyName.trim() || !form.contactName.trim()) {
      setError("公司名称和联系人为必填项");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/customers/${params.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setError(data.error || "保存失败");
        return;
      }
      router.push(`/customers/${params.id}`);
    } catch {
      setError("网络错误");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-center py-8 text-gray-500">加载中...</p>;
  if (error && !form) return <p className="text-center py-8 text-red-600">{error}</p>;
  if (!form) return null;

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">编辑客户</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TextInput label="公司名称 *" value={form.companyName} onChange={(value) => handleChange("companyName", value)} />
          <TextInput label="联系人 *" value={form.contactName} onChange={(value) => handleChange("contactName", value)} />
          <TextInput label="电话" type="tel" value={form.phone} onChange={(value) => handleChange("phone", value)} />
          <TextInput label="微信" value={form.wechat} onChange={(value) => handleChange("wechat", value)} />
          <TextInput label="WhatsApp" value={form.whatsapp} onChange={(value) => handleChange("whatsapp", value)} />
          <TextInput label="邮箱" type="email" value={form.email} onChange={(value) => handleChange("email", value)} />
          <ProvinceCitySelect
            province={form.province}
            city={form.city}
            onChange={({ province, city }) => setForm((prev: any) => ({ ...prev, province, city }))}
            allowed={seeAll ? undefined : userTerritories}
            includeForeign={seeAll && form.businessLine === "外贸"}
          />

          {seeAll && (
            <SelectInput label="业务线" value={form.businessLine} onChange={(value) => handleChange("businessLine", value)}>
              {BUSINESS_LINES.map((item) => <option key={item} value={item}>{item}</option>)}
            </SelectInput>
          )}

          <SelectInput label="客户状态" value={form.status} onChange={(value) => handleChange("status", value)}>
            {Object.entries(CUSTOMER_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </SelectInput>

          <SelectInput label="客户等级" value={form.customerLevel} onChange={(value) => handleChange("customerLevel", value)}>
            {CUSTOMER_LEVELS.map((item) => <option key={item} value={item}>{item}级</option>)}
          </SelectInput>

          <SelectInput label="客户类型" value={form.customerType} onChange={(value) => handleChange("customerType", value)}>
            {Object.entries(CUSTOMER_TYPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </SelectInput>

          <SelectInput label="客户来源" value={form.customerSource} onChange={(value) => handleChange("customerSource", value)}>
            {CUSTOMER_SOURCES.map((item) => <option key={item} value={item}>{item}</option>)}
          </SelectInput>

          <SelectInput label="归属业务员/负责人" value={form.assignedUserId} onChange={(value) => handleChange("assignedUserId", value)}>
            <option value="">未分配</option>
            {activeUsers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </SelectInput>

          <TextInput label="下次跟进日期" type="date" value={form.nextFollowDate} onChange={(value) => handleChange("nextFollowDate", value)} />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">地址</label>
          <textarea value={form.address} onChange={(event) => handleChange("address", event.target.value)} rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">标签</label>
          <div className="flex flex-wrap gap-2">
            {INTEREST_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => handleTagToggle(tag)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  form.interestTags.includes(tag)
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">备注</label>
          <textarea value={form.remark} onChange={(event) => handleChange("remark", event.target.value)} rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <button onClick={handleSubmit} disabled={saving} className="px-6 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50">
            {saving ? "保存中..." : "保存"}
          </button>
          <button onClick={() => router.back()} className="px-6 py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">取消</button>
        </div>
      </div>
    </div>
  );
}

function TextInput({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
    </div>
  );
}

function SelectInput({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
        {children}
      </select>
    </div>
  );
}
