"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CUSTOMER_STATUS_LABELS } from "@/lib/constants";

export default function RemindersPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((res) => res.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">加载中...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-gray-900">跟进提醒</h1>

      {/* 今日待跟进 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-orange-600 mb-4">
          今日待跟进 ({data?.todayFollowUpList?.length || 0})
        </h2>
        {data?.todayFollowUpList?.length === 0 ? (
          <p className="text-sm text-gray-500">今日暂无待跟进客户</p>
        ) : (
          <div className="space-y-3">
            {data?.todayFollowUpList?.map((c: any) => (
              <Link
                key={c.id}
                href={`/customers/${c.id}`}
                className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{c.companyName}</p>
                  <p className="text-xs text-gray-500">{c.contactName} · {c.phone}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-600">
                  {CUSTOMER_STATUS_LABELS[c.status]}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* 逾期未跟进 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-red-600 mb-4">
          逾期未跟进 ({data?.overdueList?.length || 0})
        </h2>
        {data?.overdueList?.length === 0 ? (
          <p className="text-sm text-gray-500">暂无逾期客户</p>
        ) : (
          <div className="space-y-3">
            {data?.overdueList?.map((c: any) => (
              <Link
                key={c.id}
                href={`/customers/${c.id}`}
                className="flex items-center justify-between p-3 rounded-lg border border-red-100 hover:bg-red-50 transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{c.companyName}</p>
                  <p className="text-xs text-gray-500">{c.contactName}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600">
                  逾期 {Math.ceil((Date.now() - new Date(c.nextFollowDate).getTime()) / 86400000)} 天
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
