"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, Download, Edit, Package, Trash2 } from "lucide-react";
import { LANGUAGE_LABELS } from "@/lib/constants";
import { toProtectedUploadUrl } from "@/lib/upload-urls";

function formatMoney(value: any) {
  if (!value && value !== 0) return "暂未维护出厂价";
  return `¥${Number(value).toLocaleString("zh-CN")}`;
}

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  MAIN: "主产品",
  OPTIONAL: "选配产品",
};

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeLang, setActiveLang] = useState("ZH");
  const [deleting, setDeleting] = useState(false);

  const userRole = (session?.user as any)?.role;

  useEffect(() => {
    fetch(`/api/products/${params.id}`)
      .then((res) => res.json())
      .then((data) => {
        setProduct(data);
        if (data.translations?.length > 0) setActiveLang(data.translations[0].language);
      })
      .finally(() => setLoading(false));
  }, [params.id]);

  const handleDelete = async () => {
    if (!confirm("确定要删除该产品吗？")) return;
    setDeleting(true);
    await fetch(`/api/products/${params.id}`, { method: "DELETE" });
    router.push("/products");
  };

  if (loading) return <p className="text-center py-8 text-gray-500">加载中...</p>;
  if (!product) return <p className="text-center py-8 text-red-600">产品不存在</p>;

  const activeTranslation = product.translations?.find((item: any) => item.language === activeLang);
  const isMainProduct = product.productType !== "OPTIONAL";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-gray-900">{product.model}</h1>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
              {PRODUCT_TYPE_LABELS[product.productType] || "主产品"}
            </span>
          </div>
          <p className="text-sm text-gray-500">{product.category}</p>
        </div>
        {userRole === "SUPER_ADMIN" && (
          <div className="flex gap-2">
            <Link href={`/products/${params.id}/edit`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
              <Edit className="w-3.5 h-3.5" />编辑产品
            </Link>
            <button onClick={handleDelete} disabled={deleting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50">
              <Trash2 className="w-3.5 h-3.5" />删除
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-2">基本信息</h2>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-gray-500">型号</dt><dd className="text-gray-900 font-medium">{product.model}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">分类</dt><dd className="text-gray-900">{product.category}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">类型</dt><dd className="text-gray-900">{PRODUCT_TYPE_LABELS[product.productType] || "主产品"}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">出厂价格</dt><dd className="text-gray-900 font-semibold">{formatMoney(product.factoryPrice)}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">币种</dt><dd className="text-gray-900">{product.currency || "CNY"}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">状态</dt><dd>{product.isActive ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700">启用</span> : <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600">停用</span>}</dd></div>
              </dl>
              {product.remark && <p className="mt-3 text-sm text-gray-600">{product.remark}</p>}
            </div>
            {isMainProduct && product.videoUrl && (
              <div>
                <h3 className="text-xs font-medium text-gray-500 mb-1">产品视频</h3>
                <a href={toProtectedUploadUrl(product.videoUrl)} target="_blank" className="text-sm text-blue-600 hover:underline flex items-center gap-1"><Download className="w-3.5 h-3.5" />查看视频</a>
              </div>
            )}
          </div>
          <div>
            {isMainProduct && product.imageUrl ? (
              <img src={toProtectedUploadUrl(product.imageUrl)} alt={product.model} className="w-full max-w-xs rounded-lg border object-cover" />
            ) : (
              <div className="w-full max-w-xs h-48 rounded-lg bg-gray-100 flex items-center justify-center">
                <Package className="w-12 h-12 text-gray-300" />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex gap-2 mb-6 border-b border-gray-200 pb-4">
          {Object.entries(LANGUAGE_LABELS).map(([key, label]) => {
            const hasTranslation = product.translations?.some((item: any) => item.language === key);
            return (
              <button key={key} onClick={() => setActiveLang(key)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${activeLang === key ? "bg-gray-900 text-white" : hasTranslation ? "bg-gray-100 text-gray-700 hover:bg-gray-200" : "bg-gray-50 text-gray-400"}`}>
                {label}
              </button>
            );
          })}
        </div>

        {activeTranslation ? (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">{activeTranslation.name}</h2>
            {activeTranslation.description && (
              <div><h3 className="text-sm font-medium text-gray-700 mb-1">产品描述</h3><p className="text-sm text-gray-600">{activeTranslation.description}</p></div>
            )}
            {isMainProduct && activeTranslation.specs && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">技术参数</h3>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-100">
                    {Object.entries(activeTranslation.specs as Record<string, string>).map(([key, value]) => (
                      <tr key={key}><td className="py-2 pr-4 text-gray-500 font-medium w-1/3">{key}</td><td className="py-2 text-gray-900">{value}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {isMainProduct && activeTranslation.pdfUrl && (
              <a href={toProtectedUploadUrl(activeTranslation.pdfUrl)} target="_blank" className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800">
                <Download className="w-4 h-4" />下载 PDF 资料
              </a>
            )}
          </div>
        ) : (
          <div className="text-center py-8">
            <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">该语言资料暂未维护</p>
          </div>
        )}
      </div>
    </div>
  );
}
