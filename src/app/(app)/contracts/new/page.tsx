"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ContractEditor } from "@/components/contracts/contract-editor";

function NewContractContent() {
  const searchParams = useSearchParams();
  return (
    <ContractEditor
      mode="new"
      quoteId={searchParams.get("quoteId") || undefined}
      initialCustomerId={searchParams.get("customerId") || undefined}
    />
  );
}

export default function NewContractPage() {
  return (
    <Suspense fallback={<div className="text-center py-8 text-gray-500">加载中...</div>}>
      <NewContractContent />
    </Suspense>
  );
}
