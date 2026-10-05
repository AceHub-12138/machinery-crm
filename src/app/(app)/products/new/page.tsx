"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PRODUCT_CATEGORIES, LANGUAGE_LABELS } from "@/lib/constants";
import { Upload, X, Image as ImageIcon, Film, FileText } from "lucide-react";
import { toProtectedUploadUrl } from "@/lib/upload-urls";

export default function NewProductPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    model: "", category: "数控插床", imageUrl: "", videoUrl: "", factoryPrice: "", currency: "CNY",
  });

  const [translations, setTranslations] = useState([
    { language: "ZH", name: "", description: "", specs: "", pdfUrl: "" },
  ]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploadStatus, setUploadStatus] = useState<Record<string, string>>({});

  const uploadFile = async (file: File, field: string, index?: number) => {
    const key = index !== undefined ? `${field}_${index}` : field;
    setUploadStatus(prev => ({ ...prev, [key]: "上传中..." }));

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload/products", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) { setUploadStatus(prev => ({ ...prev, [key]: `失败: ${data.error}` })); return; }

      if (field === "imageUrl") setForm(prev => ({ ...prev, imageUrl: data.url }));
      else if (field === "videoUrl") setForm(prev => ({ ...prev, videoUrl: data.url }));
      else if (field === "pdfUrl" && index !== undefined) {
        const updated = [...translations];
        updated[index].pdfUrl = data.url;
        setTranslations(updated);
      }
      setUploadStatus(prev => ({ ...prev, [key]: `已上传: ${data.fileName}` }));
    } catch {
      setUploadStatus(prev => ({ ...prev, [key]: "上传失败" }));
    }
  };

  const addTranslation = (lang: string) => {
    if (translations.find(t => t.language === lang)) return;
    setTranslations([...translations, { language: lang, name: "", description: "", specs: "", pdfUrl: "" }]);
  };

  const updateTranslation = (index: number, field: string, value: string) => {
    const updated = [...translations];
    (updated[index] as any)[field] = value;
    setTranslations(updated);
  };

  const removeTranslation = (index: number) => {
    setTranslations(translations.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!form.model || !form.category) { setError("产品型号和分类为必填项"); return; }
    setLoading(true); setError("");

    try {
      const payload = {
        ...form,
        productType: "MAIN",
        factoryPrice: form.factoryPrice || null,
        translations: translations.filter(t => t.name).map(t => ({
          language: t.language, name: t.name, description: t.description || null,
          specs: t.specs ? JSON.parse(t.specs) : null, pdfUrl: t.pdfUrl || null,
        })),
      };
      const res = await fetch("/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const d = await res.json(); setError(d.error || "创建失败"); return; }
      const data = await res.json();
      router.push(`/products/${data.id}`);
    } catch (e: any) { setError(e.message || "网络错误"); }
    finally { setLoading(false); }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">新增产品</h1>
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        {/* 基础信息 */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">产品基本信息</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">产品型号 *</label>
              <input type="text" value={form.model} onChange={e => setForm({...form, model: e.target.value})} placeholder="如：BK5030"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">产品分类 *</label>
              <select value={form.category} onChange={e => setForm({...form, category: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
                {PRODUCT_CATEGORIES.map(c => (<option key={c} value={c}>{c}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">出厂价格</label>
              <input type="number" value={form.factoryPrice} onChange={e => setForm({...form, factoryPrice: e.target.value})} placeholder="0.00"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              <p className="text-xs text-gray-400 mt-1">单位：元（CNY）</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">币种</label>
              <select value={form.currency} onChange={e => setForm({...form, currency: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
                <option value="CNY">CNY 人民币</option><option value="USD">USD 美元</option>
              </select>
            </div>
          </div>
        </div>

        {/* 产品图片上传 */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">产品图片</h2>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 cursor-pointer hover:bg-gray-50">
              <ImageIcon className="w-4 h-4" />选择图片
              <input type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden" onChange={e => { if (e.target.files?.[0]) uploadFile(e.target.files[0], "imageUrl"); }} />
            </label>
            {form.imageUrl && <img src={toProtectedUploadUrl(form.imageUrl)} alt="预览" className="w-16 h-16 object-cover rounded-lg border" />}
          </div>
          {uploadStatus.imageUrl && <p className="text-xs text-gray-500">{uploadStatus.imageUrl}</p>}
        </div>

        {/* 产品视频上传 */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">产品视频</h2>
          <label className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 cursor-pointer hover:bg-gray-50 w-fit">
            <Film className="w-4 h-4" />选择视频
            <input type="file" accept=".mp4,.mov,.avi,.webm" className="hidden" onChange={e => { if (e.target.files?.[0]) uploadFile(e.target.files[0], "videoUrl"); }} />
          </label>
          {uploadStatus.videoUrl && <p className="text-xs text-gray-500">{uploadStatus.videoUrl}</p>}
        </div>

        {/* 多语言资料 */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">多语言资料</h2>
            <div className="flex gap-2">
              {Object.entries(LANGUAGE_LABELS).map(([k, v]) => (
                <button key={k} type="button" onClick={() => addTranslation(k)} disabled={translations.some(t => t.language === k)}
                  className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">+ {v}</button>
              ))}
            </div>
          </div>

          {translations.map((t, index) => (
            <div key={t.language} className="border border-gray-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-700">{LANGUAGE_LABELS[t.language]}</span>
                {translations.length > 1 && <button type="button" onClick={() => removeTranslation(index)} className="text-xs text-red-500 hover:text-red-700">移除</button>}
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">产品名称</label>
                <input type="text" value={t.name} onChange={e => updateTranslation(index, "name", e.target.value)} placeholder="如：数控插床"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">产品描述</label>
                <textarea value={t.description} onChange={e => updateTranslation(index, "description", e.target.value)} rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">技术参数 (JSON)</label>
                <input type="text" value={t.specs} onChange={e => updateTranslation(index, "specs", e.target.value)} placeholder='{"最大插削长度":"300mm"}'
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">PDF/Word 资料</label>
                <label className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 cursor-pointer hover:bg-gray-50 w-fit">
                  <FileText className="w-4 h-4" />上传资料
                  <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={e => { if (e.target.files?.[0]) uploadFile(e.target.files[0], "pdfUrl", index); }} />
                </label>
                {uploadStatus[`pdfUrl_${index}`] && <p className="text-xs text-gray-500 mt-1">{uploadStatus[`pdfUrl_${index}`]}</p>}
                {t.pdfUrl && !uploadStatus[`pdfUrl_${index}`] && <p className="text-xs text-green-600 mt-1">已有资料: {t.pdfUrl}</p>}
              </div>
            </div>
          ))}
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

        <div className="flex gap-3">
          <button onClick={handleSubmit} disabled={loading}
            className="px-6 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50">
            {loading ? "保存中..." : "保存产品"}
          </button>
          <button onClick={() => router.back()}
            className="px-6 py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">取消</button>
        </div>
      </div>
    </div>
  );
}
