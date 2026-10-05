import { describe, expect, it } from "vitest";
import { flattenBomLeafRequirements, normalizeBomWriteItems, parseBomQuantity } from "@/lib/bom-items";

describe("BOM quantities", () => {
  it("requires integers for count units while allowing decimal measured units", () => {
    expect(parseBomQuantity("1.5", "件")).toBeNull();
    expect(parseBomQuantity("2", "件")?.toString()).toBe("2");
    expect(parseBomQuantity("1.5", "kg")?.toString()).toBe("1.5");
    expect(parseBomQuantity("0.001", "kg")).toBeNull();
    expect(parseBomQuantity("0", "m")).toBeNull();
    expect(parseBomQuantity("NaN", "m")).toBeNull();
  });
});

describe("BOM write validation", () => {
  it("derives levels from parent links and rejects cycles", () => {
    const items = normalizeBomWriteItems([
      { clientKey: "package", materialId: "package", quantity: "1", sortOrder: 0 },
      { clientKey: "relay", parentClientKey: "package", materialId: "relay", quantity: "4", sortOrder: 10 },
    ], new Map([["package", "包"], ["relay", "个"]]), new Set(["package"]));
    expect(items.map((item) => [item.clientKey, item.level])).toEqual([["package", 1], ["relay", 2]]);

    expect(() => normalizeBomWriteItems([
      { clientKey: "a", parentClientKey: "b", materialId: "package", quantity: "1" },
      { clientKey: "b", parentClientKey: "a", materialId: "relay", quantity: "1" },
    ], new Map([["package", "包"], ["relay", "个"]]), new Set(["package", "relay"]))).toThrow("循环");
  });

  it("rejects turning a normal stock material into a virtual package", () => {
    expect(() => normalizeBomWriteItems([
      { clientKey: "motor", materialId: "motor", quantity: "1" },
      { clientKey: "bolt", parentClientKey: "motor", materialId: "bolt", quantity: "4" },
    ], new Map([["motor", "台"], ["bolt", "个"]]), new Set())).toThrow("零件包分类");
  });

  it("does not save an empty package as an inventory leaf", () => {
    expect(() => normalizeBomWriteItems([
      { clientKey: "package", materialId: "package", quantity: "1" },
    ], new Map([["package", "包"]]), new Set(["package"]))).toThrow("至少需要包含一个子物料");
  });

  it("rejects duplicate material under the same parent", () => {
    expect(() => normalizeBomWriteItems([
      { clientKey: "bolt-1", materialId: "bolt", quantity: "1" },
      { clientKey: "bolt-2", materialId: "bolt", quantity: "1" },
    ], new Map([["bolt", "个"]]), new Set())).toThrow("同一层级");
  });
});

describe("multi-level BOM expansion", () => {
  it("counts only leaf materials and multiplies every quantity on the path", () => {
    const result = flattenBomLeafRequirements([
      { id: "package", parentItemId: null, materialId: "virtual-package", quantity: "1", sortOrder: 0 },
      { id: "relay", parentItemId: "package", materialId: "relay", quantity: "4", sortOrder: 10 },
      { id: "cable", parentItemId: "package", materialId: "cable", quantity: "12", sortOrder: 20 },
    ], "3");

    expect(result.map((item) => [item.materialId, item.perUnitQuantity.toString(), item.requiredQuantity.toString()])).toEqual([
      ["relay", "4", "12"],
      ["cable", "12", "36"],
    ]);
  });

  it("merges the same leaf material reached through different paths", () => {
    const result = flattenBomLeafRequirements([
      { id: "a", parentItemId: null, materialId: "package-a", quantity: "2", sortOrder: 0 },
      { id: "a-relay", parentItemId: "a", materialId: "relay", quantity: "3", sortOrder: 10 },
      { id: "b", parentItemId: null, materialId: "package-b", quantity: "1", sortOrder: 20 },
      { id: "b-relay", parentItemId: "b", materialId: "relay", quantity: "4", sortOrder: 30 },
    ], "2");

    expect(result).toHaveLength(1);
    expect(result[0].perUnitQuantity.toString()).toBe("10");
    expect(result[0].requiredQuantity.toString()).toBe("20");
  });

  it("rejects cyclic parent relationships", () => {
    expect(() => flattenBomLeafRequirements([
      { id: "a", parentItemId: "b", materialId: "a", quantity: "1", sortOrder: 0 },
      { id: "b", parentItemId: "a", materialId: "b", quantity: "1", sortOrder: 10 },
    ], "1")).toThrow("循环");
  });
});
