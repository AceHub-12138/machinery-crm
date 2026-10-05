"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, ClipboardCheck, PackageMinus, PackagePlus, Save, ShoppingCart, Trash2 } from "lucide-react";

import { MotionPage } from "@/components/motion/MotionPage";
import { isReducedMotionPreferred, useReducedMotion } from "@/hooks/useReducedMotion";
import { MOTION_DURATION, MOTION_EASE } from "@/lib/motion/config";

gsap.registerPlugin(useGSAP);

const KIT_CHECK_REPLAY_LIMIT = 50;
const KIT_CHECK_ROW_STAGGER = 0.08;
const KIT_CHECK_REPLAY_MAX_DURATION = 1.5;
const KIT_CHECK_ROW_DURATION = MOTION_DURATION.normal;

const statusLabel: Record<string, string> = { DRAFT: "草稿", ISSUED: "待齐套检查", CHANGE_PENDING: "变更待审批", CANCELLED: "已作废" };
const day = (value?: string | null) => value ? new Date(value).toISOString().slice(0, 10) : "";

type Form = { orderNo: string; contractId: string; contractItemId: string; productId: string; quantity: string; bomId: string; warehouseId: string; plannedDate: string; responsibleId: string; specialRequirements: string; remark: string };
const emptyForm: Form = { orderNo: "", contractId: "", contractItemId: "", productId: "", quantity: "1", bomId: "", warehouseId: "", plannedDate: "", responsibleId: "", specialRequirements: "", remark: "" };

export default function ProductionOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;
  const canPublish = role === "SUPER_ADMIN";
  const canInventory = role === "SUPER_ADMIN" || role === "WAREHOUSE";
  const canPurchase = role === "SUPER_ADMIN" || role === "PURCHASE" || role === "WAREHOUSE";
  const canKitCheck = role === "SUPER_ADMIN" || role === "WAREHOUSE";
  const id = params.id;
  const isNew = id === "new";
  const [detail, setDetail] = useState<any>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [products, setProducts] = useState<any[]>([]);
  const [boms, setBoms] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [issueQty, setIssueQty] = useState<Record<string, string>>({});
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [kitCheckReplayRun, setKitCheckReplayRun] = useState(0);
  const [purchaseHighlightRun, setPurchaseHighlightRun] = useState(0);
  const [draftRequestKey] = useState(() => crypto.randomUUID());
  const kitCheckRowsRef = useRef<HTMLTableSectionElement>(null);
  const handledKitCheckReplayRunRef = useRef(0);
  const purchaseHighlightRef = useRef<HTMLSpanElement>(null);
  const handledPurchaseHighlightRunRef = useRef(0);
  const purchaseHighlightCompleteRef = useRef<((completed: boolean) => void) | null>(null);
  const reducedMotion = useReducedMotion();

  const finishPurchaseHighlight = (completed: boolean) => {
    purchaseHighlightCompleteRef.current?.(completed);
    purchaseHighlightCompleteRef.current = null;
  };

  const json = async (url: string, init?: RequestInit) => {
    const response = await fetch(url, init); const data = await response.json();
    if (!response.ok) throw new Error(data.error || "操作失败");
    return data;
  };
  const loadReferences = async () => {
    const requestedContractId = isNew ? new URLSearchParams(window.location.search).get("contractId") || "" : "";
    const contractSourceUrl = isNew ? "/api/erp/production-contracts" : `/api/erp/production-contracts?excludeOrderId=${encodeURIComponent(id)}`;
    const [p, b, w, c, u, requestedContracts] = await Promise.all([json("/api/erp/products?productType=MAIN&pageSize=50"), json("/api/erp/boms?pageSize=200"), json("/api/erp/warehouses?pageSize=200"), json(contractSourceUrl), json("/api/erp/production-users"), requestedContractId ? json(`/api/erp/production-contracts?contractId=${encodeURIComponent(requestedContractId)}`) : Promise.resolve([])]);
    const recentContracts = Array.isArray(c) ? c : c.items || c.data || [];
    const selectedContracts = Array.isArray(requestedContracts) ? requestedContracts : requestedContracts.items || requestedContracts.data || [];
    const contractList = [...new Map([...selectedContracts, ...recentContracts].map((contract: any) => [contract.id, contract])).values()];
    setProducts(Array.isArray(p) ? p : p.items || p.data || []); setBoms(Array.isArray(b) ? b : b.items || b.data || []); setWarehouses(Array.isArray(w) ? w : w.items || w.data || []); setContracts(contractList); setUsers(Array.isArray(u) ? u : u.items || []);
    if (isNew) {
      const contract = contractList.find((item: any) => item.id === requestedContractId);
      if (contract) setForm((current) => ({ ...current, contractId: contract.id, plannedDate: day(contract.estimatedShipmentDate) || current.plannedDate }));
    }
  };
  const load = async () => {
    if (!isNew) {
      const data = await json(`/api/erp/production-orders/${id}`); setDetail(data);
      setForm({ orderNo: data.orderNo || "", contractId: data.contractId || "", contractItemId: data.contractItemId || "", productId: data.productId || "", quantity: String(data.quantity || 1), bomId: data.bomId || "", warehouseId: data.warehouseId || "", plannedDate: day(data.plannedDate), responsibleId: data.responsibleId || "", specialRequirements: data.configuration?.specialRequirements || "", remark: data.remark || "" });
    }
  };
  useEffect(() => {
    if (!role) return;
    if (role === "SUPER_ADMIN") void loadReferences();
    void load();
  }, [id, role]);

  useGSAP(
    () => {
      const rows = Array.from(
        kitCheckRowsRef.current?.querySelectorAll<HTMLTableRowElement>("[data-kit-check-row]") ?? [],
      );
      if (rows.length === 0) return;

      if (
        kitCheckReplayRun === 0
        || kitCheckReplayRun === handledKitCheckReplayRunRef.current
      ) {
        gsap.set(rows, { clearProps: "opacity,transform" });
        return;
      }

      handledKitCheckReplayRunRef.current = kitCheckReplayRun;
      if (
        reducedMotion
        || isReducedMotionPreferred()
        || rows.length > KIT_CHECK_REPLAY_LIMIT
      ) {
        gsap.set(rows, { clearProps: "opacity,transform" });
        return;
      }

      const stagger = rows.length <= 1
        ? 0
        : Math.min(
            KIT_CHECK_ROW_STAGGER,
            (KIT_CHECK_REPLAY_MAX_DURATION - KIT_CHECK_ROW_DURATION) / (rows.length - 1),
          );

      gsap.fromTo(
        rows,
        { opacity: 0, y: 12 },
        {
          duration: KIT_CHECK_ROW_DURATION,
          ease: MOTION_EASE.enter,
          opacity: 1,
          stagger,
          y: 0,
          onComplete: () => gsap.set(rows, { clearProps: "opacity,transform" }),
        },
      );
    },
    {
      dependencies: [kitCheckReplayRun, reducedMotion],
      revertOnUpdate: true,
      scope: kitCheckRowsRef,
    },
  );

  useGSAP(
    () => {
      const highlight = purchaseHighlightRef.current;
      if (!highlight) {
        finishPurchaseHighlight(false);
        return;
      }

      if (
        purchaseHighlightRun === 0
        || purchaseHighlightRun === handledPurchaseHighlightRunRef.current
      ) {
        gsap.set(highlight, { opacity: 0 });
        return;
      }

      handledPurchaseHighlightRunRef.current = purchaseHighlightRun;
      if (reducedMotion || isReducedMotionPreferred()) {
        gsap.set(highlight, { opacity: 0 });
        finishPurchaseHighlight(true);
        return;
      }

      const tween = gsap.fromTo(
        highlight,
        { opacity: 1 },
        {
          duration: MOTION_DURATION.process,
          ease: MOTION_EASE.decel,
          opacity: 0,
          onComplete: () => finishPurchaseHighlight(true),
        },
      );

      return () => {
        tween.kill();
        finishPurchaseHighlight(false);
      };
    },
    {
      dependencies: [purchaseHighlightRun, reducedMotion],
      revertOnUpdate: true,
      scope: purchaseHighlightRef,
    },
  );

  const persistDraft = async () => {
    const data = await json(isNew ? "/api/erp/production-orders" : `/api/erp/production-orders/${id}`, { method: isNew ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isNew ? { ...form, requestKey: draftRequestKey } : form) });
    return data;
  };
  const saveDraft = async () => {
    try {
      setSaving(true); const data = await persistDraft();
      router.replace(`/erp/production-orders/${data.id || id}`);
    } catch (error) { alert(error instanceof Error ? error.message : "保存失败"); } finally { setSaving(false); }
  };
  const publish = async () => {
    try {
      setSaving(true);
      const stockDraft = !form.contractId;
      if (stockDraft && !window.confirm("这是备货工单。确认发布后将生成正式工单号并固化物料快照，是否继续？")) return;
      const saved = await persistDraft();
      const orderId = saved.id || id;
      if (isNew) router.replace(`/erp/production-orders/${orderId}`);
      const issued = await json(`/api/erp/production-orders/${orderId}/issue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(stockDraft ? { confirmStockOrder: true } : {}) });
      router.replace(`/erp/production-orders/${orderId}`);
      setDetail(issued);
      if (window.confirm("工单已发布，是否立即执行齐套检查？")) {
        await json(`/api/erp/production-orders/${orderId}/kit-check`, { method: "POST" });
        if (!isNew) await load();
        else router.refresh();
      }
    } catch (error) { alert(error instanceof Error ? error.message : "发布失败"); } finally { setSaving(false); }
  };
  const kitCheck = async () => {
    try {
      setChecking(true);
      await json(`/api/erp/production-orders/${id}/kit-check`, { method: "POST" });
      await load();
      setKitCheckReplayRun((current) => current + 1);
    } catch (error) {
      alert(error instanceof Error ? error.message : "检查失败");
    } finally {
      setChecking(false);
    }
  };
  const cancelOrder = async () => { if (!window.confirm("确认取消工单？存在未退生产领料时服务端会拒绝。")) return; try { const data = await json(`/api/erp/production-orders/${id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "CANCELLED" }) }); setDetail(data); } catch (error) { alert(error instanceof Error ? error.message : "取消失败"); } };
  const removeDraft = async () => { if (!window.confirm("确认删除此草稿工单？此操作仅软删除草稿。")) return; try { await json(`/api/erp/production-orders/${id}`, { method: "DELETE" }); router.replace("/erp/production-orders"); } catch (error) { alert(error instanceof Error ? error.message : "删除失败"); } };
  const materialMovement = async (kind: "issue" | "return") => {
    const source = kind === "issue" ? issueQty : returnQty; const items = Object.entries(source).filter(([, quantity]) => Number(quantity) > 0).map(([materialId, quantity]) => ({ materialId, quantity }));
    if (!items.length) return alert("请至少填写一项数量");
    const payload: any = { productionOrderId: id, warehouseId: detail.warehouseId, type: kind === "issue" ? "PRODUCTION" : "RETURN", items };
    if (kind === "issue" && items.some((item) => Number(item.quantity) > Number(detail.materialSummary?.find((summary: any) => summary.materialId === item.materialId)?.remainingQty || 0))) {
      if (!window.confirm("领料超过剩余需求量。仅超级管理员填写原因并确认后可提交，是否继续？")) return;
      payload.confirmOverIssue = true; payload.overIssueReason = window.prompt("请填写超领原因") || "";
    }
    try { await json(kind === "issue" ? "/api/erp/stock-out" : "/api/erp/stock-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); setIssueQty({}); setReturnQty({}); await load(); } catch (error) { alert(error instanceof Error ? error.message : "领退料失败"); }
  };
  const generatePurchase = async (check: any) => {
    if (!window.confirm(`将根据本次齐套检查的 ${check.shortageCount || 0} 项缺料批量生成采购需求，不会直接生成采购订单。是否继续？`)) return;
    try {
      const data = await json(`/api/erp/production-orders/${id}/purchase-demands`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kitCheckId: check.id }) });
      const highlightFinished = new Promise<boolean>((resolve) => {
        purchaseHighlightCompleteRef.current = resolve;
      });
      setPurchaseHighlightRun((current) => current + 1);
      const highlightCompleted = await highlightFinished;
      if (!highlightCompleted) return;
      const go = window.confirm(`已生成或更新 ${data.created?.length || 0} 项采购需求${data.skipped?.length ? `，${data.skipped.length} 项已被库存、在途或现有需求覆盖` : ""}。是否前往采购需求页面？`);
      if (go) router.push("/erp/purchase-demands");
    } catch (error) { alert(error instanceof Error ? error.message : "生成采购需求失败"); }
  };

  const activeBoms = form.productId ? boms.filter((bom) => bom.productId === form.productId && bom.isActive !== false) : [];
  const batchCreate = async (lines: any[], requestKey: string) => {
    try {
      setSaving(true);
      const data = await json("/api/erp/production-orders/from-contract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, lines, requestKey }) });
      alert(`已生成 ${data.items?.length || 0} 张生产工单草稿。`);
      router.replace("/erp/production-orders");
    } catch (error) { alert(error instanceof Error ? error.message : "批量生成失败"); } finally { setSaving(false); }
  };
  const purchaseButton = (check: Parameters<typeof generatePurchase>[0]) => <div className="relative isolate mt-3 inline-flex"><span aria-hidden className="pointer-events-none absolute -inset-1 rounded-lg bg-[var(--brand-orange-soft)] opacity-0" data-assignment-highlight="purchase-demand" ref={purchaseHighlightRef} /><button onClick={() => generatePurchase(check)} className="relative inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm"><ShoppingCart className="h-4 w-4" />生成采购需求</button></div>;
  if (!role) return <p className="py-8 text-center text-sm text-gray-500">加载中...</p>;
  if (role === "PURCHASE") {
    if (!detail) return <p className="py-8 text-center text-sm text-gray-500">加载中...</p>;
    return <div className="space-y-4"><Link href="/erp/production-orders" className="inline-flex items-center gap-1 text-sm text-gray-600"><ArrowLeft className="h-4 w-4" />返回生产工单</Link><section className="rounded-xl border bg-white p-5"><h1 className="text-xl font-semibold">{detail.orderNo}</h1><div className="mt-4 grid gap-2 text-sm sm:grid-cols-3"><p>设备型号：{detail.productModelSnapshot}</p><p>生产数量：{Number(detail.quantity)}</p><p>计划完工日期：{day(detail.plannedDate) || "—"}</p></div></section><section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">缺料物料</h2>{detail.shortageItems?.length ? <><div className="mt-3 overflow-auto"><table className="w-full min-w-[600px] text-sm"><thead><tr className="text-left text-gray-500"><th>物料编号</th><th>物料名称</th><th>规格 / 图号</th><th>缺少数量</th></tr></thead><tbody>{detail.shortageItems.map((item: any) => <tr key={item.materialId} className="border-t"><td className="py-2">{item.code}</td><td>{item.name}</td><td>{item.spec || "—"}</td><td className="text-red-600">{item.shortageQty} {item.unit}</td></tr>)}</tbody></table></div>{purchaseButton(detail.latestKitCheckResult)}</> : <p className="mt-2 text-sm text-gray-500">当前没有缺料结果。</p>}</section></div>;
  }
  if ((isNew || detail?.status === "DRAFT") && canPublish) return <DraftForm form={form} setForm={setForm} products={products} boms={activeBoms} warehouses={warehouses} contracts={contracts} users={users} saving={saving} isNew={isNew} onSave={saveDraft} onPublish={publish} onBatchCreate={batchCreate} onDelete={isNew ? undefined : removeDraft} />;
  if ((isNew || detail?.status === "DRAFT") && role) return <p className="py-8 text-center text-red-600">当前角色无权创建、编辑或发布生产工单。</p>;
  if (!detail) return <p className="py-8 text-center text-sm text-gray-500">加载中...</p>;
  const latest = detail.latestKitCheckResult;
  const displayStatusLabel = detail.status === "ISSUED"
    ? latest?.status === "SUFFICIENT" ? "齐套" : latest?.status === "SHORTAGE" ? "缺料" : "待齐套检查"
    : statusLabel[detail.status] || detail.status;
  return <MotionPage className="space-y-4">
    <Link href="/erp/production-orders" className="inline-flex items-center gap-1 text-sm text-gray-600"><ArrowLeft className="h-4 w-4" />返回生产工单</Link>
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap justify-between gap-3"><div><h1 className="text-xl font-semibold">{detail.orderNo}</h1><p className="mt-1 text-sm text-gray-500">{detail.productModelSnapshot} · {detail.contractNoSnapshot || "备货生产"} · 当前版本 V{detail.version}</p></div><span className="rounded-full bg-blue-100 px-2 py-1 text-sm text-blue-700">{displayStatusLabel}</span></div>
      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3"><p>生产数量：{Number(detail.quantity)}</p><p>仓库：{detail.warehouse?.name}</p><p>BOM：{detail.bomVersionSnapshot}</p><p>交货日期快照：{day(detail.deliveryDateSnapshot) || "—"}（只读）</p><p>计划完工日期：{day(detail.plannedDate) || "—"}</p><p>齐套状态：{detail.kitCheckRequired ? "待复检" : detail.kitCheckStatus}</p><p>工单创建时间：{new Date(detail.createdAt).toLocaleString("zh-CN")}</p><p>合同负责人：{detail.contractMeta?.salesUser?.name || detail.contractMeta?.salesUser?.email || "—"}</p><p>生产负责人：{detail.productionResponsible?.name || detail.productionResponsible?.email || "—"}</p></div>
      {detail.configuration?.specialRequirements && <p className="mt-3 whitespace-pre-wrap rounded bg-gray-50 p-3 text-sm">特殊配置 / 生产要求：{detail.configuration.specialRequirements}</p>}
      <div className="mt-4 flex flex-wrap gap-2">{detail.status === "ISSUED" && canPublish && <><Link href={`/erp/production-orders/${id}/change`} className="rounded-lg border px-3 py-2 text-sm">申请变更</Link><button onClick={cancelOrder} className="rounded-lg border px-3 py-2 text-sm text-red-700">取消工单</button></>}{detail.status === "ISSUED" && canKitCheck && <button onClick={kitCheck} disabled={checking} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm disabled:opacity-40"><ClipboardCheck className="h-4 w-4" />{checking ? "检查中…" : "执行齐套检查"}</button>}</div>
    </section>
    <section className="rounded-xl border border-gray-200 bg-white p-5"><div className="flex justify-between"><h2 className="font-semibold">齐套检查记录</h2><Link href="/erp/kit-check-results" className="text-sm text-blue-700">查看汇总</Link></div>{latest ? <><p className="mt-2 text-sm">最近结果：{latest.status === "SUFFICIENT" ? "库存齐套" : `缺料 ${latest.shortageCount} 项`}；采购需求会统一汇总，确认后才会生成采购订单草稿。</p><div className="mt-3 overflow-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="text-left text-gray-500"><th>物料编号</th><th>物料名称</th><th>规格 / 图号</th><th>单台用量</th><th>工单数量</th><th>总需求量</th><th>剩余需求量</th><th>当前库存</th><th>缺少数量</th><th>结果</th></tr></thead><tbody ref={kitCheckRowsRef}>{(latest.detail || []).map((item: any) => <tr data-kit-check-row key={item.materialId} className="border-t"><td className="py-2">{item.code}</td><td>{item.name}</td><td>{item.spec || "—"}</td><td>{item.perUnitQty ?? "—"}</td><td>{item.orderQty ?? Number(detail.quantity)}</td><td>{item.totalRequiredQty ?? item.requiredQty}</td><td>{item.remainingRequiredQty ?? item.requiredQty}</td><td>{item.availableQty}</td><td className="text-red-600">{item.shortageQty}</td><td>{Number(item.shortageQty) > 0 ? "缺料" : "齐套"}</td></tr>)}</tbody></table></div>{latest.status === "SHORTAGE" && canPurchase && purchaseButton(latest)}</> : <p className="mt-2 text-sm text-gray-500">尚未执行齐套检查。</p>}</section>
    <section className="rounded-xl border border-gray-200 bg-white p-5"><h2 className="font-semibold">工单物料快照与生产领退料</h2><div className="mt-3 overflow-auto"><table className="w-full min-w-[900px] text-sm"><thead><tr className="text-left text-gray-500"><th>物料</th><th>计划</th><th>累计领料</th><th>累计退料</th><th>净领料</th><th>剩余需求</th><th>当前库存</th>{canInventory && <><th>本次领料</th><th>本次退料</th></>}</tr></thead><tbody>{detail.materials.map((item: any) => { const sum = detail.materialSummary?.find((value: any) => value.materialId === item.materialId) || {}; return <tr key={item.id} className="border-t"><td className="py-2">{item.materialCodeSnapshot} {item.materialNameSnapshot}</td><td>{sum.plannedQty}</td><td>{sum.issuedQty}</td><td>{sum.returnedQty}</td><td>{sum.netIssuedQty}</td><td>{sum.remainingQty}</td><td>{sum.inventoryQty}</td>{canInventory && <><td><input type="number" min="0" step="0.01" value={issueQty[item.materialId] || ""} onChange={(event) => setIssueQty({ ...issueQty, [item.materialId]: event.target.value })} className="w-20 rounded border p-1" /></td><td><input type="number" min="0" step="0.01" value={returnQty[item.materialId] || ""} onChange={(event) => setReturnQty({ ...returnQty, [item.materialId]: event.target.value })} className="w-20 rounded border p-1" /></td></>}</tr>; })}</tbody></table></div>{canInventory && <div className="mt-3 flex gap-2"><button onClick={() => materialMovement("issue")} disabled={detail.status !== "ISSUED"} className="inline-flex items-center gap-1 rounded-lg bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-40"><PackageMinus className="h-4 w-4" />确认领料</button><button onClick={() => materialMovement("return")} disabled={detail.status === "CANCELLED"} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm disabled:opacity-40"><PackagePlus className="h-4 w-4" />确认退料</button></div>}</section>
    <section className="rounded-xl border border-gray-200 bg-white p-5"><h2 className="font-semibold">版本与变更审批记录</h2><div className="mt-2 text-sm">{(detail.versionHistory || []).map((item: any) => <span key={item.id} className="mr-3">V{item.version} {item.orderNo} {item.isCurrent ? "（当前）" : ""}</span>)}</div><div className="mt-3 space-y-2 text-sm">{(detail.changeRequests || []).map((item: any) => <div key={item.id} className="rounded border p-2">{item.status}：{item.reason}{item.approvalRemark ? `；审批说明：${item.approvalRemark}` : ""}</div>)}</div></section>
  </MotionPage>;
}

function DraftForm({ form, setForm, products, boms, warehouses, contracts, users, saving, isNew, onSave, onPublish, onBatchCreate, onDelete }: any) {
  const [batchRequestKey] = useState(() => crypto.randomUUID());
  const [contractQuery, setContractQuery] = useState("");
  const [contractOptions, setContractOptions] = useState<any[]>(contracts);
  const [productQuery, setProductQuery] = useState("");
  const [productOptions, setProductOptions] = useState<any[]>(products);
  const [selectedLines, setSelectedLines] = useState<Record<string, { orderNo: string; quantity: string; bomId: string }>>(() =>
    form.contractItemId ? { [form.contractItemId]: { orderNo: form.orderNo, quantity: form.quantity, bomId: form.bomId } } : {}
  );
  useEffect(() => { setContractOptions(contracts); }, [contracts]);
  useEffect(() => { setProductOptions(products); }, [products]);
  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const response = await fetch(`/api/erp/production-contracts?search=${encodeURIComponent(contractQuery.trim())}`);
      const data = await response.json();
      if (response.ok) setContractOptions(Array.isArray(data) ? data : data.items || []);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [contractQuery]);
  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const response = await fetch(`/api/erp/products?productType=MAIN&pageSize=50&search=${encodeURIComponent(productQuery.trim())}`);
      const data = await response.json();
      if (response.ok) setProductOptions(Array.isArray(data) ? data : data.items || []);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [productQuery]);
  const selectedContract = [...contracts, ...contractOptions].find((contract: any) => contract.id === form.contractId);
  const contractItems = selectedContract?.items || [];
  const field = (key: keyof Form, value: string) => setForm((current: Form) => ({ ...current, [key]: value }));
  const chooseContract = (contractId: string) => {
    const contract = [...contracts, ...contractOptions].find((item: any) => item.id === contractId);
    setSelectedLines({});
    setForm((current: Form) => ({
      ...current,
      contractId,
      contractItemId: "",
      productId: "",
      quantity: "1",
      bomId: "",
      plannedDate: contract?.estimatedShipmentDate ? day(contract.estimatedShipmentDate) : current.plannedDate,
    }));
  };
  const toggleItem = (item: any, checked: boolean) => {
    setSelectedLines((current) => {
      if (!checked) {
        const next = { ...current };
        delete next[item.id];
        return next;
      }
      return { ...current, [item.id]: { orderNo: "", quantity: String(item.remainingQuantity), bomId: item.boms?.[0]?.id || "" } };
    });
    if (checked) {
      setForm((current: Form) => ({
        ...current,
        contractItemId: item.id,
        productId: item.productId,
        orderNo: "", quantity: String(item.remainingQuantity),
        bomId: item.boms?.[0]?.id || "",
      }));
    }
  };
  const batchLines = Object.entries(selectedLines).map(([contractItemId, value]: any) => {
    const item = contractItems.find((candidate: any) => candidate.id === contractItemId);
    return { contractItemId, productId: item?.productId, orderNo: value.orderNo, quantity: value.quantity, bomId: value.bomId };
  });
  const selectedCount = batchLines.length;

  return <div className="mx-auto max-w-5xl space-y-4">
    <Link href="/erp/production-orders" className="inline-flex items-center gap-1 text-sm text-gray-600"><ArrowLeft className="h-4 w-4" />返回生产工单</Link>
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <h1 className="text-xl font-semibold">{isNew ? "新建生产工单" : "编辑草稿工单"}</h1>
      <p className="mt-1 text-sm text-gray-500">合同明细只带入生产信息，不显示任何客户资料。未选仓库时优先使用启用的 Dachuan 仓库。</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm">工单编号 *<input value={form.orderNo} onChange={(event) => field("orderNo", event.target.value)} placeholder="请输入工单编号" className="mt-1 w-full rounded border p-2" /></label>
        <label className="text-sm">关联合同
          <input value={contractQuery} onChange={(event) => setContractQuery(event.target.value)} placeholder="按合同编号、客户或产品搜索" className="mt-1 w-full rounded border p-2" />
          <select value={form.contractId} onChange={(event) => chooseContract(event.target.value)} className="mt-1 w-full rounded border p-2">
            <option value="">备货生产</option>{contractOptions.map((item: any) => <option key={item.id} value={item.id}>{item.contractNo}</option>)}
          </select>
        </label>
        {selectedContract && <label className="text-sm">合同负责人（只读）<input readOnly value={selectedContract.salesUser?.name || selectedContract.salesUser?.email || "—"} className="mt-1 w-full rounded border bg-gray-50 p-2" /></label>}
      </div>

      {selectedContract && <div className="mt-4 overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[1040px] text-sm"><thead className="bg-gray-50"><tr><th className="p-3 text-left">选择</th><th className="text-left">合同明细</th><th className="text-left">设备型号</th><th className="text-left">工单编号</th><th className="text-right">合同数量</th><th className="text-right">已生成</th><th className="text-right">本次数量</th><th className="p-3 text-left">整机用料清单</th></tr></thead>
          <tbody>{contractItems.map((item: any) => {
            const selected = selectedLines[item.id];
            return <tr key={item.id} className="border-t">
              <td className="p-3"><input type="checkbox" checked={Boolean(selected)} disabled={!item.canGenerate && !selected} onChange={(event) => toggleItem(item, event.target.checked)} /></td>
              <td>{item.productNameSnapshot}</td><td>{item.productModelSnapshot}</td><td>{selected ? <input value={selected.orderNo} onChange={(event) => { const orderNo = event.target.value; setSelectedLines({ ...selectedLines, [item.id]: { ...selected, orderNo } }); if (form.contractItemId === item.id) field("orderNo", orderNo); }} className="w-36 rounded border p-1" placeholder="必填" /> : "—"}</td><td className="text-right">{item.quantity}</td><td className="text-right">{item.generatedQuantity}</td>
              <td className="text-right">{selected ? <input type="number" min="0.01" max={item.remainingQuantity} step="0.01" value={selected.quantity} onChange={(event) => { const quantity = event.target.value; setSelectedLines({ ...selectedLines, [item.id]: { ...selected, quantity } }); if (form.contractItemId === item.id) field("quantity", quantity); }} className="w-24 rounded border p-1 text-right" /> : item.remainingQuantity}</td>
              <td className="p-3">{selected ? <select value={selected.bomId} onChange={(event) => { const bomId = event.target.value; setSelectedLines({ ...selectedLines, [item.id]: { ...selected, bomId } }); if (form.contractItemId === item.id) field("bomId", bomId); }} className="rounded border p-1"><option value="">请选择</option>{(item.boms || []).map((bom: any) => <option key={bom.id} value={bom.id}>{bom.version}</option>)}</select> : item.disabledReason || `${item.boms?.length || 0} 个生效版本`}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>}

      {!selectedContract && <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm">设备型号<input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="按型号或名称搜索" className="mt-1 w-full rounded border p-2" /><select value={form.productId} onChange={(event) => { field("productId", event.target.value); field("bomId", ""); }} className="mt-1 w-full rounded border p-2"><option value="">请选择</option>{productOptions.map((item: any) => <option key={item.id} value={item.id}>{item.model}{item.translations?.[0]?.name ? ` · ${item.translations[0].name}` : ""}</option>)}</select></label>
        <label className="text-sm">生产数量<input type="number" min="0.01" step="0.01" value={form.quantity} onChange={(event) => field("quantity", event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
        <label className="text-sm">整机用料清单<select value={form.bomId} disabled={!form.productId} onChange={(event) => field("bomId", event.target.value)} className="mt-1 w-full rounded border p-2 disabled:bg-gray-50"><option value="">{form.productId ? "请选择" : "请先选择设备型号"}</option>{boms.map((item: any) => <option key={item.id} value={item.id}>{item.version}</option>)}</select></label>
      </div>}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm">生产仓库<select value={form.warehouseId} onChange={(event) => field("warehouseId", event.target.value)} className="mt-1 w-full rounded border p-2"><option value="">默认 Dachuan 仓库</option>{warehouses.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-sm">生产负责人<select value={form.responsibleId} onChange={(event) => field("responsibleId", event.target.value)} className="mt-1 w-full rounded border p-2"><option value="">暂不指定</option>{users.map((item: any) => <option key={item.id} value={item.id}>{item.name || item.email || item.id}</option>)}</select></label>
        {selectedContract && <label className="text-sm">合同交货日期（只读）<input readOnly value={day(selectedContract.estimatedShipmentDate) || "未填写"} className="mt-1 w-full rounded border bg-gray-50 p-2" /></label>}
        <label className="text-sm">计划完工日期<input type="date" max={day(selectedContract?.estimatedShipmentDate) || undefined} value={form.plannedDate} onChange={(event) => field("plannedDate", event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
        <label className="text-sm sm:col-span-2">特殊配置 / 生产要求<textarea value={form.specialRequirements} onChange={(event) => field("specialRequirements", event.target.value)} rows={3} className="mt-1 w-full rounded border p-2" placeholder="例如：西门子系统、特殊电压、加装第四轴、非标颜色" /></label>
        <label className="text-sm sm:col-span-2">备注<textarea value={form.remark} onChange={(event) => field("remark", event.target.value)} rows={3} className="mt-1 w-full rounded border p-2" /></label>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div>{onDelete && <button onClick={onDelete} className="inline-flex items-center gap-1 rounded border border-red-200 px-3 py-2 text-sm text-red-700"><Trash2 className="h-4 w-4" />删除草稿</button>}</div>
        <div className="flex flex-wrap gap-2">
          {isNew && selectedContract && <button onClick={() => onBatchCreate(batchLines, batchRequestKey)} disabled={saving || selectedCount === 0 || batchLines.some((line: any) => !line.orderNo || !line.bomId || Number(line.quantity) <= 0)} className="rounded border px-4 py-2 text-sm disabled:opacity-40">批量生成草稿（{selectedCount}）</button>}
          <button onClick={onSave} disabled={saving || !form.orderNo.trim() || (selectedContract && selectedCount !== 1)} className="inline-flex items-center gap-1 rounded border px-4 py-2 text-sm disabled:opacity-40"><Save className="h-4 w-4" />保存草稿</button>
          <button onClick={onPublish} disabled={saving || !form.orderNo.trim() || (selectedContract && selectedCount !== 1)} className="rounded bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-40">发布工单</button>
        </div>
      </div>
    </div>
  </div>;
}
