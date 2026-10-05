"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AFTER_SALES_ORDER_TYPE_LABELS } from "@/lib/after-sales";

function formatDate(value?: string | Date | null) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value))
    : "";
}

function isDebug(orderType: string) {
  return orderType === "NEW_MACHINE_DEBUG";
}

export default function AfterSalesPrintPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<any>(null);
  const [info, setInfo] = useState({ companyName: "", contactAddress: "", footerNote: "" });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [orderResponse, printInfoResponse] = await Promise.all([
      fetch(`/api/after-sales/${id}`, { cache: "no-store" }),
      fetch("/api/after-sales/print-info", { cache: "no-store" }),
    ]);
    const order = await orderResponse.json();
    const printInfo = printInfoResponse.ok ? await printInfoResponse.json() : null;
    if (!orderResponse.ok) setError(order.error || "工单加载失败");
    else setItem(order);
    if (printInfo) setInfo((current) => ({ ...current, ...printInfo }));
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <main className="p-6 text-red-700">{error}</main>;
  if (!item) return <main className="p-6 text-gray-500">加载打印内容...</main>;

  const descriptionLabel = isDebug(item.orderType) ? "工单说明" : "客户反馈";
  const footerText = [info.companyName, info.contactAddress, info.footerNote].filter(Boolean).join("\n");
  const orderTypeLabel = AFTER_SALES_ORDER_TYPE_LABELS[item.orderType as keyof typeof AFTER_SALES_ORDER_TYPE_LABELS] || "未识别工单类型";

  return (
    <main className="mx-auto max-w-[210mm] bg-white p-4 text-slate-900 print:p-0">
      <style jsx global>{`
        @page { size: A4 portrait; margin: 10mm; }
        .after-sales-print { box-sizing:border-box; display:flex; flex-direction:column; width:190mm; height:277mm; margin:0 auto; border:1px solid #1f2937; font-size:11pt; line-height:1.45; }
        .after-sales-print-header { display:flex; align-items:center; gap:8mm; flex-shrink:0; border-bottom:1px solid #1f2937; padding:6mm; }
        .after-sales-print-title { flex:1; text-align:center; font-size:18pt; font-weight:700; }
        .after-sales-print-number { max-width:52mm; overflow-wrap:anywhere; text-align:right; font-size:9pt; }
        .after-sales-print-section { flex-shrink:0; border-bottom:1px solid #1f2937; padding:4mm 6mm; }
        .after-sales-print-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:2mm 5mm; }
        .after-sales-print-field { display:grid; grid-template-columns:26mm minmax(0,1fr); align-items:start; min-width:0; }
        .after-sales-print-label { color:#374151; white-space:nowrap; }
        .after-sales-print-value { min-width:0; overflow-wrap:anywhere; word-break:break-word; white-space:pre-wrap; }
        .after-sales-print-full { margin-top:2mm; }
        .after-sales-print-handwrite { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:2mm 5mm; margin-top:3mm; }
        .after-sales-print-handwrite-field { display:grid; grid-template-columns:26mm minmax(0,1fr); align-items:end; min-width:0; }
        .after-sales-print-handwrite-line { min-height:6mm; border-bottom:1px solid #374151; }
        .after-sales-print-work { display:flex; min-height:56mm; flex:1 1 auto; flex-direction:column; padding:4mm 6mm; border-bottom:1px solid #1f2937; }
        .after-sales-print-signatures { flex-shrink:0; padding:4mm 6mm 3mm; }
        .after-sales-print-signature-lines { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8mm; }
        .after-sales-print-signature { display:grid; grid-template-columns:auto minmax(0,1fr); align-items:end; min-width:0; }
        .after-sales-print-signature-line { min-height:7mm; border-bottom:1px solid #374151; }
        .after-sales-print-date { margin:4mm 0 0; }
        .after-sales-print-satisfaction { display:grid; flex-shrink:0; grid-template-columns:auto repeat(3,minmax(0,1fr)); gap:4mm; align-items:center; border-top:1px solid #1f2937; border-bottom:1px solid #1f2937; padding:3mm 6mm; }
        .after-sales-print-satisfaction-option { white-space:nowrap; }
        .after-sales-print-footer { flex-shrink:0; min-height:10mm; padding:3mm 6mm 4mm; font-size:9pt; white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word; }
        @media print { body { background:white; } .print-controls { display:none !important; } .after-sales-print { border-color:#111827; } }
      `}</style>
      <div className="print-controls mb-4 flex justify-end">
        <button onClick={() => window.print()} className="rounded bg-orange-600 px-4 py-2 text-sm text-white">浏览器打印</button>
      </div>
      <article className="after-sales-print">
        <header className="after-sales-print-header">
          <img src="/logo.png" alt="大川重工机床" className="h-auto w-28 object-contain" />
          <h1 className="after-sales-print-title">售后服务工单</h1>
          <div className="after-sales-print-number">编号 {item.orderNo}</div>
        </header>
        <section className="after-sales-print-section">
          <div className="after-sales-print-grid">
            <Field label="客户公司" value={item.customerNameSnapshot} />
            <Field label="合同编号" value={item.contractNoSnapshot} />
            <Field label="设备型号" value={item.equipmentModelSnapshot} />
            <Field label="派发时间" value={formatDate(item.dispatchDate)} />
            <Field label="工单类型" value={orderTypeLabel} />
            <Field label="售后人员" value={item.assigneeNames} />
          </div>
          <div className="after-sales-print-full"><Field label="服务地址" value={item.serviceAddress} /></div>
          <div className="after-sales-print-handwrite">
            <HandwriteField label="开始时间" />
            <HandwriteField label="结束时间" />
          </div>
          <div className="after-sales-print-full"><Field label={descriptionLabel} value={item.description} /></div>
        </section>
        <section className="after-sales-print-work">
          <strong>工作结果</strong>
        </section>
        <section className="after-sales-print-signatures">
          <div className="after-sales-print-signature-lines">
            <div className="after-sales-print-signature"><span>客户签字：</span><span className="after-sales-print-signature-line" /></div>
            <div className="after-sales-print-signature"><span>售后人员签字：</span><span className="after-sales-print-signature-line" /></div>
          </div>
          <div className="after-sales-print-date"><span>日期：</span></div>
        </section>
        <section className="after-sales-print-satisfaction">
          <span>满意度调查：</span>
          <span className="after-sales-print-satisfaction-option">☐ 满意</span>
          <span className="after-sales-print-satisfaction-option">☐ 一般</span>
          <span className="after-sales-print-satisfaction-option">☐ 不满意</span>
        </section>
        <footer className="after-sales-print-footer">{footerText}</footer>
      </article>
    </main>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return <div className="after-sales-print-field"><span className="after-sales-print-label">{label}：</span><span className="after-sales-print-value">{value || ""}</span></div>;
}

function HandwriteField({ label }: { label: string }) {
  return <div className="after-sales-print-handwrite-field"><span className="after-sales-print-label">{label}：</span><span className="after-sales-print-handwrite-line" /></div>;
}
