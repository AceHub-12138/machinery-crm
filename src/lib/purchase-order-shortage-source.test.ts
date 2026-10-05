import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hasActiveShortageSourceClaim, hasShortageSourceMaterialMismatch, releaseShortageSource } from "./purchase-order-shortage-source";

const migrationPath = fileURLToPath(new URL("../../prisma/migrations/20260713120000_erp_phase4_shortage_purchase_source_guard/migration.sql", import.meta.url));
const sql = readFileSync(migrationPath, "utf8");

describe("purchase shortage source database guard", () => {
  it("uses kit check, material, and active marker as the unique database key", () => {
    const uniqueIndexName = "erp_po_shortage_src_kit_mat_active_uq";

    expect(uniqueIndexName.length).toBeLessThanOrEqual(64);
    expect(sql).toContain(
      `UNIQUE INDEX \`${uniqueIndexName}\`(\`kitCheckId\`, \`materialId\`, \`isActive\`)`,
    );
    expect(sql).toContain("`purchaseOrderItemId` VARCHAR(191) NOT NULL");
  });

  it("contains only additive DDL for the guard table", () => {
    expect(sql).toContain("CREATE TABLE `erp_purchase_order_shortage_sources`");
    expect(sql).not.toMatch(/^\s*(DROP|DELETE|TRUNCATE)\b/im);
  });

  it("blocks a second active claim but allows a released historical claim", () => {
    expect(hasActiveShortageSourceClaim([{ materialId: "material-a" }])).toBe(true);
    expect(hasActiveShortageSourceClaim([])).toBe(false);
    const releasedAt = new Date("2026-07-13T00:00:00.000Z");
    expect(releaseShortageSource(releasedAt)).toEqual({ isActive: null, releasedAt });
  });

  it("keeps source-draft materials stable while allowing quantity and price edits", () => {
    expect(hasShortageSourceMaterialMismatch(["a", "b"], ["b", "a"])).toBe(false);
    expect(hasShortageSourceMaterialMismatch(["a", "b"], ["a", "c"])).toBe(true);
    expect(hasShortageSourceMaterialMismatch(["a", "b"], ["a"])).toBe(true);
  });
});
