"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { FileText, Film, Image as ImageIcon } from "lucide-react";
import { LANGUAGE_LABELS, PRODUCT_CATEGORIES } from "@/lib/constants";
import { toProtectedUploadUrl } from "@/lib/upload-urls";

function toInputMoney(value: any) {
  if (!value && value !== 0) return "";
  return String(Number(value));
}

export default function EditProductPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const userRole = (session?.user as any)?.role;
  const [form, setForm] = useState({
    model: "",
    category: PRODUCT_CATEGORIES[0],
    productType: "MAIN",
    imageUrl: "",
    videoUrl: "",
    factoryPrice: "",
    currency: "CNY",
    remark: "",
  });
  const [translations, setTranslations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uploadStatus, setUploadStatus] = useState<Record<string, string>>({});

  useEffect(() => {
    if (userRole && userRole !== "SUPER_ADMIN") {
      router.push("/products");
      return;
    }
    fetch(`/api/products/${params.id}`)
      .then((res) => res.json())
      .then((data) => {
        setForm({
          model: data.model || "",
          category: data.category || PRODUCT_CATEGORIES[0],
          productType: data.productType || "MAIN",
          imageUrl: data.imageUrl || "",
          videoUrl: data.videoUrl || "",
          factoryPrice: toInputMoney(data.factoryPrice),
          currency: data.currency || "CNY",
          remark: data.remark || "",
        });
        setTranslations((data.translations || []).map((item: any) => ({
          language: item.language,
          name: item.name || "",
          description: item.description || "",
          specs: item.specs ? JSON.stringify(item.specs) : "",
          pdfUrl: item.pdfUrl || "",
        })));
      })
      .catch(() => setError("加载失败"))
      .finally(() => setLoading(false));
  }, [params.id, router, userRole]);

  const uploadFile = async (file: File, field: string, index?: number) => {
    const key = index !== undefined ? `${field}_${index}` : field;
    setUploadStatus((prev) => ({ ...prev, [key]: "上传中..." }));
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/upload/products", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setUploadStatus((prev) => ({ ...prev, [key]: `失败: ${data.error}` }));
        return;
      }
      if (field === "imageUrl") setForm((prev) => ({ ...prev, imageUrl: data.url }));
      if (field === "videoUrl") setForm((prev) => ({ ...prev, videoUrl: data.url }));
      if (field === "pdfUrl" && index !== undefined) {
        setTranslations((prev) => prev.map((item, i) => i === index ? { ...item, pdfUrl: data.url } : item));
      }
      setUploadStatus((prev) => ({ ...prev, [key]: `已上传 ${data.fileName}` }));
    } catch {
      setUploadStatus((prev) => ({ ...prev, [key]: "上传失败" }));
    }
  };

  const addTranslation = (language: string) => {
    if (translations.some((item) => item.language === language)) return;
    setTranslations([...translations, { language, name: "", description: "", specs: "", pdfUrl: "" }]);
  };

  const updateTranslation = (index: number, field: string, value: string) => {
    setTranslations((prev) => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };

  const removeTranslation = (index: number) => {
    setTranslations((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!form.model || !form.category) {
      setError("产品型号和分类为必填项");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/products/${params.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          imageUrl: form.productType === "MAIN" ? form.imageUrl : null,
          videoUrl: form.productType === "MAIN" ? form.videoUrl : null,
          factoryPrice: form.factoryPrice || null,
          translations: translations.filter((item) => item.name).map((item) => ({
            language: item.language,
            name: item.name,
            description: item.description || null,
            specs: item.specs ? JSON.parse(item.specs) : null,
            pdfUrl: form.productType === "MAIN" ? (item.pdfUrl || null) : null,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "保存失败");
        return;
      }
      router.push(`/products/${params.id}`);
    } catch (err: any) {
      setError(err.message || "网络错误");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-center py-8 text-gray-500">加载中...</p>;
  if (userRole !== "SUPER_ADMIN") return <p className="text-center py-8 text-red-600">无权编辑产品</p>;

  const isMainProduct = form.productType === "MAIN";

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">编辑产品</h1>
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">产品基本信息</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">产品类型</label>
              <select value={form.productType} onChange={(event) => setForm({ ...form, productType: event.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
                <option value="MAIN">主产品</option>
                <option value="OPTIONAL">选配产品</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">产品型号 *</label>
              <input type="text" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">产品分类 *</label>
              <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as any })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
                {PRODUCT_CATEGORIES.map((category) => (<option key={category} value={category}>{category}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">出厂价格</label>
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
              <label className="block text-xs font-medium text-gray-600 mb-1">备注</label>
              <textarea value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
            </div>
          </div>
        </div>

        {isMainProduct && (
          <>
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-700">产品图片</h2>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 cursor-pointer hover:bg-gray-50">
                  <ImageIcon className="w-4 h-4" />{form.imageUrl ? "更换图片" : "选择图片"}
                  <input type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden" onChange={(event) => { if (event.target.files?.[0]) uploadFile(event.target.files[0], "imageUrl"); }} />
                </label>
                {form.imageUrl && <img src={toProtectedUploadUrl(form.imageUrl)} alt="预览" className="w-16 h-16 object-cover rounded-lg border" />}
              </div>
              {uploadStatus.imageUrl && <p className="text-xs text-gray-500">{uploadStatus.imageUrl}</p>}
            </div>

            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-700">产品视频</h2>
              <label className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 cursor-pointer hover:bg-gray-50 w-fit">
                <Film className="w-4 h-4" />{form.videoUrl ? "更换视频" : "选择视频"}
                <input type="file" accept=".mp4,.mov,.avi,.webm" className="hidden" onChange={(event) => { if (event.target.files?.[0]) uploadFile(event.target.files[0], "videoUrl"); }} />
              </label>
              {uploadStatus.videoUrl && <p className="text-xs text-gray-500">{uploadStatus.videoUrl}</p>}
            </div>
          </>
        )}

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">多语言资料</h2>
            <div className="flex gap-2">
              {Object.entries(LANGUAGE_LABELS).map(([key, label]) => (
                <button key={key} type="button" onClick={() => addTranslation(key)} disabled={translations.some((item) => item.language === key)}
                  className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">
                  + {label}
                </button>
              ))}
            </div>
          </div>

          {translations.map((item, index) => (
            <div key={item.language} className="border border-gray-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-700">{LANGUAGE_LABELS[item.language]}</span>
                {translations.length > 1 && <button type="button" onClick={() => removeTranslation(index)} className="text-xs text-red-500 hover:text-red-700">移除</button>}
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">产品名称</label>
                <input type="text" value={item.name} onChange={(event) => updateTranslation(index, "name", event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">产品描述</label>
                <textarea value={item.description} onChange={(event) => updateTranslation(index, "description", event.target.value)} rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
              </div>
              {isMainProduct && (
                <>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">技术参数(JSON)</label>
                    <input type="text" value={item.specs} onChange={(event) => updateTranslation(index, "specs", event.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">PDF/Word 资料</label>
                    <label className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 cursor-pointer hover:bg-gray-50 w-fit">
                      <FileText className="w-4 h-4" />{item.pdfUrl ? "更换资料" : "上传资料"}
                      <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(event) => { if (event.target.files?.[0]) uploadFile(event.target.files[0], "pdfUrl", index); }} />
                    </label>
                    {uploadStatus[`pdfUrl_${index}`] && <p className="text-xs text-gray-500 mt-1">{uploadStatus[`pdfUrl_${index}`]}</p>}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

        <div className="flex gap-3">
          <button onClick={handleSubmit} disabled={saving}
            className="px-6 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50">
            {saving ? "保存中..." : "保存修改"}
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
