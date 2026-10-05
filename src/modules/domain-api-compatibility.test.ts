import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("阶段 2 兼容路由", () => {
  it("客户旧、新 URL 复用同一领域服务", () => {
    for (const path of ["src/app/api/customers/route.ts", "src/app/api/crm/customers/route.ts"]) {
      expect(read(path)).toContain("@/modules/crm/customers/service");
      expect(read(path)).toContain("listCustomers");
      expect(read(path)).toContain("createCustomer");
    }
  });

  it("审计旧、新 URL 复用同一领域服务，库存 URL 保持不变", () => {
    for (const path of ["src/app/api/operation-logs/route.ts", "src/app/api/system/audit/route.ts"]) {
      expect(read(path)).toContain("@/modules/system/audit/service");
      expect(read(path)).toContain("listOperationLogs");
    }
    expect(read("src/app/api/erp/inventory/route.ts")).toContain("@/modules/erp/inventory/service");
  });
});
