import { createHash } from "node:crypto";

/** 公司级去重指纹：与现有 MCP lead_upsert 服务完全同款（保证与历史入池线索互相去重）。 */

export function normalizedCompanyName(companyName: string) {
  return companyName.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function companyDedupKey(companyName: string) {
  const company = normalizedCompanyName(companyName);
  return createHash("sha256").update(`lead-company-v1|${company}`).digest("hex");
}
