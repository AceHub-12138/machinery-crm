"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ServiceAmountInput } from "@/components/after-sales/service-amount-input";
import { PageContainer } from "@/components/layout/page-container";
import { AFTER_SALES_ORDER_TYPE_LABELS, AFTER_SALES_ORDER_TYPES } from "@/lib/after-sales";
import { filterAfterSalesPartOptions, scheduleAfterSalesContractSearch } from "@/lib/after-sales-form";

type ContractOption = {
  id: string;
  contractNo: string;
  equipmentModel: string;
  customer: { companyName: string };
  salesUser?: { name?: string | null } | null;
};

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function NewAfterSalesOrderPage() {
  const router = useRouter();
  const [contracts, setContracts] = useState<ContractOption[]>([]);
  const [contractId, setContractId] = useState("");
  const [selectedContract, setSelectedContract] = useState<ContractOption | null>(null);
  const [contractMenuOpen, setContractMenuOpen] = useState(false);
  const [contractLoading, setContractLoading] = useState(false);
  const [contractLoadError, setContractLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [partOptions, setPartOptions] = useState<string[]>([]);
  const [partInput, setPartInput] = useState("");
  const [partNames, setPartNames] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    orderType: "NEW_MACHINE_DEBUG",
    urgency: "NORMAL",
    dispatchDate: today(),
    assigneeNames: "",
    serviceAddress: "",
    description: "",
    serviceAmount: "",
  });

  const loadContracts = useCallback(async (keyword: string, signal: AbortSignal) => {
    setContractLoading(true);
    try {
      const response = await fetch(`/api/after-sales/contracts?q=${encodeURIComponent(keyword)}`, { signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "合同加载失败");
      if (!signal.aborted) {
        setContracts(Array.isArray(data.items) ? data.items : []);
        setContractLoadError("");
      }
    } catch {
      if (!signal.aborted) {
        setContracts([]);
        setContractLoadError("合同加载失败，请关闭后重新打开下拉列表重试");
      }
    } finally {
      if (!signal.aborted) setContractLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!contractMenuOpen) return;
    const controller = new AbortController();
    const keyword = query.trim();

    if (!keyword) {
      void loadContracts("", controller.signal);
      return () => controller.abort();
    }

    const timer = scheduleAfterSalesContractSearch(() => {
      void loadContracts(keyword, controller.signal);
    });
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [contractMenuOpen, loadContracts, query]);

  useEffect(() => {
    if (!contractId) {
      setPartOptions([]);
      return;
    }
    fetch(`/api/after-sales/parts?contractId=${encodeURIComponent(contractId)}`)
      .then((response) => response.json())
      .then((data) => setPartOptions(data.items || []))
      .catch(() => setPartOptions([]));
  }, [contractId]);

  const update = (field: string, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const matchingParts = filterAfterSalesPartOptions(partOptions, partInput);

  const closeContractMenu = () => {
    setContractMenuOpen(false);
    setQuery("");
  };

  const chooseContract = (contract: ContractOption) => {
    setContractId(contract.id);
    setSelectedContract(contract);
    closeContractMenu();
  };

  const addPart = async (saveSupplement = false) => {
    const name = partInput.trim();
    if (!name) return;
    if (saveSupplement) {
      const response = await fetch("/api/after-sales/supplement-parts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json();
      if (!response.ok && !String(data.error || "").includes("已存在")) {
        setError(data.error || "新增补充配件失败");
        return;
      }
      setPartOptions((current) => [...new Set([...current, name])].sort((left, right) => left.localeCompare(right, "zh-CN")));
    }
    setPartNames((current) => (current.includes(name) ? current : [...current, name]));
    setPartInput("");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!contractId) {
      setError("请选择当前权限内的合同");
      return;
    }
    setSaving(true);
    const response = await fetch("/api/after-sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        contractId,
        serviceAmount: form.orderType === "OUT_WARRANTY_PAID" ? form.serviceAmount : null,
        partNames,
      }),
    });
    const data = await response.json();
    setSaving(false);
    if (!response.ok) return setError(data.error || "创建售后工单失败");
    router.push(`/after-sales/${data.id}`);
  };

  const descriptionHint = form.orderType === "NEW_MACHINE_DEBUG"
    ? "请简要填写调试安排、现场条件与注意事项。"
    : "请填写故障现象、设备状态和客户诉求。";

  return (
    <PageContainer variant="data" className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">新建售后工单</h1>
        <p className="mt-1 text-sm text-gray-500">合同选择后会固化客户、合同编号和设备型号快照。</p>
      </div>
      {error && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <form onSubmit={submit} className="space-y-5 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-solid)] p-5 shadow-[var(--shadow-card)]">
        <section>
          <label className="text-sm font-medium" htmlFor="after-sales-contract-trigger">选择合同</label>
          <div className="relative mt-1">
            <button
              aria-controls="after-sales-contract-options"
              aria-expanded={contractMenuOpen}
              aria-haspopup="dialog"
              className="flex w-full items-center justify-between rounded border bg-white p-2 text-left text-sm"
              id="after-sales-contract-trigger"
              onClick={() => {
                if (contractMenuOpen) closeContractMenu();
                else setContractMenuOpen(true);
              }}
              type="button"
            >
              <span className={selectedContract ? "text-gray-900" : "text-gray-500"}>
                {selectedContract
                  ? `${selectedContract.contractNo} · ${selectedContract.customer.companyName} · ${selectedContract.equipmentModel}`
                  : "请选择当前权限内的合同"}
              </span>
              <span aria-hidden="true" className="ml-3 text-gray-500">⌄</span>
            </button>
            {contractMenuOpen && (
              <div aria-label="选择合同" className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded border bg-white shadow-lg" id="after-sales-contract-options" role="dialog">
                <div className="sticky top-0 z-10 border-b bg-white p-2 shadow-sm">
                  <input
                    autoFocus
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") closeContractMenu();
                    }}
                    placeholder="搜索合同编号、客户公司或设备型号"
                    value={query}
                    className="w-full rounded border p-2 text-sm"
                  />
                </div>
                {contractLoading && <p className="px-3 py-2 text-sm text-gray-500">正在加载合同…</p>}
                {!contractLoading && contractLoadError && <p className="px-3 py-2 text-sm text-red-700">{contractLoadError}</p>}
                {!contractLoading && !contractLoadError && contracts.length === 0 && <p className="px-3 py-2 text-sm text-gray-500">没有符合条件的合同</p>}
                {!contractLoading && contracts.map((contract) => (
                  <button
                    className="block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-orange-50"
                    key={contract.id}
                    onClick={() => chooseContract(contract)}
                    type="button"
                  >
                    {contract.contractNo} · {contract.customer.companyName} · {contract.equipmentModel}
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedContract && (
            <div className="mt-3 grid gap-2 rounded bg-gray-50 p-3 text-sm md:grid-cols-3">
              <span>客户：{selectedContract.customer.companyName}</span>
              <span>机型：{selectedContract.equipmentModel}</span>
              <span>销售：{selectedContract.salesUser?.name || "—"}</span>
            </div>
          )}
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm">工单类型
            <select value={form.orderType} onChange={(event) => update("orderType", event.target.value)} className="mt-1 w-full rounded border p-2">
              {AFTER_SALES_ORDER_TYPES.map((type) => <option key={type} value={type}>{AFTER_SALES_ORDER_TYPE_LABELS[type]}</option>)}
            </select>
          </label>
          <label className="text-sm">紧急程度
            <select value={form.urgency} onChange={(event) => update("urgency", event.target.value)} className="mt-1 w-full rounded border p-2">
              <option value="NORMAL">一般</option>
              <option value="URGENT">紧急</option>
            </select>
          </label>
          <label className="text-sm">派发时间
            <input required type="date" value={form.dispatchDate} onChange={(event) => update("dispatchDate", event.target.value)} className="mt-1 w-full rounded border p-2" />
          </label>
          <label className="text-sm">售后人员
            <input required value={form.assigneeNames} onChange={(event) => update("assigneeNames", event.target.value)} placeholder="例如：张三、李四" className="mt-1 w-full rounded border p-2" />
          </label>
          <label className="text-sm md:col-span-2">服务地址
            <input value={form.serviceAddress} maxLength={255} onChange={(event) => update("serviceAddress", event.target.value)} placeholder="选填，默认可留空" className="mt-1 w-full rounded border p-2" />
          </label>
          {form.orderType === "OUT_WARRANTY_PAID" && (
            <label className="text-sm">服务金额
              <ServiceAmountInput required value={form.serviceAmount} onChange={(value) => update("serviceAmount", value)} />
            </label>
          )}
        </div>

        <label className="block text-sm">工单说明
          <textarea required value={form.description} onChange={(event) => update("description", event.target.value)} placeholder={descriptionHint} className="mt-1 min-h-32 w-full rounded border p-2" />
        </label>

        <section>
          <label className="text-sm font-medium" htmlFor="after-sales-part-input">涉及配件</label>
          <div className="mt-1 flex flex-wrap gap-2">
            <div className="relative min-w-56 flex-1">
              <input
                id="after-sales-part-input"
                value={partInput}
                onChange={(event) => setPartInput(event.target.value)}
                placeholder="搜索或手输配件名称"
                className="w-full rounded border p-2"
              />
              {partInput.trim() && (
                <div className="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded border bg-white shadow-lg" role="listbox">
                  {matchingParts.length > 0 ? matchingParts.map((part) => (
                    <button
                      className="block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-orange-50"
                      key={part}
                      onClick={() => setPartInput(part)}
                      role="option"
                      type="button"
                    >
                      {part}
                    </button>
                  )) : <p className="px-3 py-2 text-sm text-gray-500">无匹配配件，可直接加入作为新名称</p>}
                </div>
              )}
            </div>
            <button type="button" onClick={() => void addPart(false)} className="rounded border px-3 py-2 text-sm">加入</button>
            <button type="button" onClick={() => void addPart(true)} className="rounded border px-3 py-2 text-sm">新增补充配件</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {partNames.map((part) => (
              <span key={part} className="rounded-full bg-orange-50 px-3 py-1 text-sm text-orange-700">
                {part}
                <button type="button" onClick={() => setPartNames((current) => current.filter((item) => item !== part))} className="ml-2">×</button>
              </span>
            ))}
          </div>
        </section>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => router.back()} className="rounded border px-4 py-2 text-sm">取消</button>
          <button disabled={saving} className="rounded bg-[var(--brand-orange)] px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? "创建中..." : "创建工单"}</button>
        </div>
      </form>
    </PageContainer>
  );
}
