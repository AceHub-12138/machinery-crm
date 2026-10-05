import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const inventoryService = readFileSync(resolve(process.cwd(), "src/modules/erp/inventory/service.ts"), "utf8");
const inventoryDeleteRoute = readFileSync(resolve(process.cwd(), "src/app/api/erp/inventory/[id]/route.ts"), "utf8");
const inventoryPage = readFileSync(resolve(process.cwd(), "src/app/(app)/erp/inventory/page.tsx"), "utf8");

describe("库存台账：零库存结存行清除契约", () => {
  it("清除只允许数量为 0 的行，且删除条件原子复核数量", () => {
    expect(inventoryService).toContain("clearZeroInventoryRow");
    expect(inventoryService).toContain("canManageInventory(user)");
    expect(inventoryService).toContain("deleteMany({ where: { id: inventoryId, quantity: 0 } })");
    expect(inventoryService).toContain("清除未执行，请刷新后重试");
  });

  it("清除动作写入操作日志，历史单据不动", () => {
    expect(inventoryService).toContain("CLEAR_ZERO_INVENTORY_ROW");
    expect(inventoryService).not.toContain("stockInItem.delete");
    expect(inventoryService).not.toContain("stockOutItem.delete");
    expect(inventoryService).not.toContain("stockMovement.delete");
  });

  it("清除入口是 DELETE /api/erp/inventory/[id]，权限判定在服务层", () => {
    expect(inventoryDeleteRoute).toContain("export async function DELETE");
    expect(inventoryDeleteRoute).toContain("clearZeroInventoryRow(user, id)");
    expect(inventoryDeleteRoute).not.toContain("canManageInventory");
  });

  it("台账页面仅超管/仓库岗可见清除按钮，仅零库存行提供", () => {
    expect(inventoryPage).toContain('userRole === "SUPER_ADMIN" || userRole === "WAREHOUSE"');
    expect(inventoryPage).toContain("handleClearZeroRow");
    expect(inventoryPage).toContain("{isZero ? (");
  });
});
