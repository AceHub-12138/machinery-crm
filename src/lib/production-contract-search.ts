import { prisma } from "@/lib/db";

/** 只返回可用于生产选择的合同 ID；不向工单页面泄露任何客户资料。 */
export async function findProductionContractIds(search: string) {
  const keyword = search.trim();
  if (!keyword) return null;
  const rows = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      contractStatus: "SIGNED",
      OR: [
        { contractNo: { contains: keyword } },
        { customer: { companyName: { contains: keyword } } },
        { items: { some: { itemType: "MAIN", OR: [{ productNameSnapshot: { contains: keyword } }, { productModelSnapshot: { contains: keyword } }] } } },
      ],
    },
    select: { id: true },
    take: 50,
  });
  return rows.map((row) => row.id);
}
