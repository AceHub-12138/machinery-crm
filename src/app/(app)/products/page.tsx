"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Edit, Package, Plus } from "lucide-react";
import { PRODUCT_CATEGORIES, LANGUAGE_LABELS } from "@/lib/constants";
import { toProtectedUploadUrl } from "@/lib/upload-urls";

function formatMoney(value: any) {
  if (!value && value !== 0) return "暂未维护出厂价";
  return `¥${Number(value).toLocaleString("zh-CN")}`;
}

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  MAIN: "主产品",
  OPTIONAL: "选配产品",
};

export default function ProductsPage() {
  const { data: session } = useSession();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("");
  const [productType, setProductType] = useState("");

  const userRole = (session?.user as any)?.role;

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (productType) params.set("productType", productType);
    fetch(`/api/products?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => setProducts(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, [category, productType]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-gray-900">产品库</h1>
        {userRole === "SUPER_ADMIN" && (
          <div className="flex flex-wrap gap-2">
            <Link href="/products/new" className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800">
              <Plus className="w-4 h-4" />新增主产品
            </Link>
            <Link href="/products/new-optional" className="inline-flex items-center gap-1.5 px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">
              <Plus className="w-4 h-4" />新增选配产品
            </Link>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-3">
        <select value={productType} onChange={(event) => setProductType(event.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
          <option value="">全部类型</option>
          <option value="MAIN">主产品</option>
          <option value="OPTIONAL">选配产品</option>
        </select>
        <select value={category} onChange={(event) => setCategory(event.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
          <option value="">全部分类</option>
          {PRODUCT_CATEGORIES.map((item) => (<option key={item} value={item}>{item}</option>))}
        </select>
      </div>

      {loading ? (
        <p className="text-center py-8 text-sm text-gray-500">加载中...</p>
      ) : products.length === 0 ? (
        <p className="text-center py-8 text-sm text-gray-500">暂无产品</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((product) => (
            <Link key={product.id} href={`/products/${product.id}`}
              className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow">
              <div className="flex items-start gap-3">
                {product.imageUrl ? (
                  <img src={toProtectedUploadUrl(product.imageUrl)} alt={product.model} className="w-12 h-12 rounded-lg object-cover border" />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                    <Package className="w-6 h-6 text-gray-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-900 truncate">{product.model}</p>
                    <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                      {PRODUCT_TYPE_LABELS[product.productType] || "主产品"}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{product.translations?.[0]?.name || product.category}</p>
                  <p className="text-xs font-medium text-gray-700 mt-1">{formatMoney(product.factoryPrice)}</p>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex flex-wrap gap-1">
                      {product.translations?.map((translation: any) => (
                        <span key={translation.language} className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                          {LANGUAGE_LABELS[translation.language]}
                        </span>
                      ))}
                    </div>
                    {userRole === "SUPER_ADMIN" && (
                      <span className="text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1">
                        <Edit className="w-3 h-3" />编辑
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
