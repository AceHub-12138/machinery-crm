import type { Prisma, PrismaClient } from "@prisma/client";
/** 与已有客户严格同名（仅 trim 和括号互换），或原文电话一致。 */
export async function findExistingLeadCustomer(db: PrismaClient | Prisma.TransactionClient, companyName: string, phone: string | null) {
  const name = companyName.trim().replace(/（/g, "(").replace(/）/g, ")");
  const rows = await db.$queryRaw<Array<{ id: string; companyName: string }>>`
    SELECT id, companyName FROM customers
    WHERE deletedAt IS NULL AND (
      REPLACE(REPLACE(TRIM(companyName), '（', '('), '）', ')') = ${name}
      OR (${phone} IS NOT NULL AND phone = ${phone})
    ) LIMIT 1
  `;
  return rows[0] ?? null;
}
