"use client";

import { useParams } from "next/navigation";
import { ContractEditor } from "@/components/contracts/contract-editor";

export default function EditContractPage() {
  const params = useParams();
  return <ContractEditor mode="edit" contractId={String(params.id)} />;
}
