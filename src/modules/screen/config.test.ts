import { describe, expect, it } from "vitest";
import { normalizeSalesScreenConfig, parseSalesScreenConfig } from "./config";

describe("screen config normalization", () => {
  it("returns safe default config when value is undefined", () => {
    const result = normalizeSalesScreenConfig(undefined);
    expect(result).toEqual({
      version: 1,
      enabled: false,
      modules: {
        operatingKpis: true,
        deliveryMap: true,
        collection: true,
        deliveryAlerts: true,
        deliveryMilestones: true,
      },
      multipliers: {
        amount: 1,
        customerCount: 1,
        contractCount: 1,
        shipmentCount: 1,
      },
      privacy: {
        contractNumberMode: "masked",
        addressLevel: "provinceCity",
        showDisplayNotice: true,
      },
    });
  });

  it("does not share mutable reference with default constant", () => {
    const first = normalizeSalesScreenConfig(undefined);
    first.enabled = true;
    first.multipliers.amount = 99;

    const second = normalizeSalesScreenConfig(undefined);
    expect(second.enabled).toBe(false);
    expect(second.multipliers.amount).toBe(1);
  });

  it("preserves valid fields, uses defaults for missing/invalid fields, removes unknown fields, and does not mutate input", () => {
    const input = {
      version: 1,
      enabled: true,
      modules: {
        operatingKpis: false,
        deliveryMap: true,
        // collection 缺失
        deliveryAlerts: "invalid", // 非布尔值
        deliveryMilestones: true,
      },
      multipliers: {
        amount: 5,
        // customerCount 缺失
        contractCount: "not a number", // 非数字
        shipmentCount: 10,
      },
      privacy: {
        contractNumberMode: "masked",
        addressLevel: "province",
        showDisplayNotice: false,
      },
      unknownField: "should be removed",
    };

    const result = normalizeSalesScreenConfig(input);

    // 合法字段被保留
    expect(result.enabled).toBe(true);
    expect(result.modules.operatingKpis).toBe(false);
    expect(result.modules.deliveryMap).toBe(true);
    expect(result.multipliers.amount).toBe(5);
    expect(result.multipliers.shipmentCount).toBe(10);
    expect(result.privacy.contractNumberMode).toBe("masked");
    expect(result.privacy.addressLevel).toBe("province");
    expect(result.privacy.showDisplayNotice).toBe(false);

    // 缺失字段使用默认值
    expect(result.modules.collection).toBe(true);
    expect(result.multipliers.customerCount).toBe(1);

    // 非法字段使用默认值
    expect(result.modules.deliveryAlerts).toBe(true);
    expect(result.multipliers.contractCount).toBe(1);

    // 未知字段被移除
    expect("unknownField" in result).toBe(false);

    // 原始输入对象不被修改
    expect(input.modules.deliveryAlerts).toBe("invalid");
    expect(input.unknownField).toBe("should be removed");
  });

  it("resets invalid multipliers to safe defaults during normalization", () => {
    const testCases = [
      { input: { multipliers: { amount: 0, customerCount: 1, contractCount: 1, shipmentCount: 1 } }, field: "amount", reason: "zero" },
      { input: { multipliers: { amount: 101, customerCount: 1, contractCount: 1, shipmentCount: 1 } }, field: "amount", reason: "over 100" },
      { input: { multipliers: { amount: -5, customerCount: 1, contractCount: 1, shipmentCount: 1 } }, field: "amount", reason: "negative" },
      { input: { multipliers: { amount: 5.5, customerCount: 1, contractCount: 1, shipmentCount: 1 } }, field: "amount", reason: "decimal" },
      { input: { multipliers: { amount: NaN, customerCount: 1, contractCount: 1, shipmentCount: 1 } }, field: "amount", reason: "NaN" },
      { input: { multipliers: { amount: Infinity, customerCount: 1, contractCount: 1, shipmentCount: 1 } }, field: "amount", reason: "Infinity" },
    ];

    testCases.forEach(({ input, field, reason }) => {
      const result = normalizeSalesScreenConfig(input);
      expect(result.multipliers.amount).toBe(1); // 非法值回退到默认值 1
    });
  });

  it("ensures at least one module is enabled during normalization when all are false", () => {
    const input = {
      modules: {
        operatingKpis: false,
        deliveryMap: false,
        collection: false,
        deliveryAlerts: false,
        deliveryMilestones: false,
      },
    };

    const result = normalizeSalesScreenConfig(input);

    // 至少一个板块必须为 true
    const enabledCount = Object.values(result.modules).filter(Boolean).length;
    expect(enabledCount).toBeGreaterThan(0);
  });
});

describe("screen config parsing (strict validation)", () => {
  it("accepts complete valid config", () => {
    const input = {
      version: 1,
      enabled: true,
      modules: {
        operatingKpis: false,
        deliveryMap: true,
        collection: false,
        deliveryAlerts: true,
        deliveryMilestones: true,
      },
      multipliers: {
        amount: 5,
        customerCount: 2,
        contractCount: 3,
        shipmentCount: 10,
      },
      privacy: {
        contractNumberMode: "hidden",
        addressLevel: "province",
        showDisplayNotice: false,
      },
    };

    const result = parseSalesScreenConfig(input);
    expect(result).toEqual(input);
  });

  it("returns config with only allowed fields", () => {
    const input = {
      version: 1,
      enabled: false,
      modules: {
        operatingKpis: true,
        deliveryMap: true,
        collection: true,
        deliveryAlerts: true,
        deliveryMilestones: true,
      },
      multipliers: {
        amount: 1,
        customerCount: 1,
        contractCount: 1,
        shipmentCount: 1,
      },
      privacy: {
        contractNumberMode: "masked",
        addressLevel: "provinceCity",
        showDisplayNotice: true,
      },
    };

    const result = parseSalesScreenConfig(input);
    expect(Object.keys(result)).toEqual(["version", "enabled", "modules", "multipliers", "privacy"]);
    expect(Object.keys(result.modules)).toEqual(["operatingKpis", "deliveryMap", "collection", "deliveryAlerts", "deliveryMilestones"]);
    expect(Object.keys(result.multipliers)).toEqual(["amount", "customerCount", "contractCount", "shipmentCount"]);
    expect(Object.keys(result.privacy)).toEqual(["contractNumberMode", "addressLevel", "showDisplayNotice"]);
  });
});

describe("multiplier validation", () => {
  const validBase = {
    version: 1,
    enabled: false,
    modules: { operatingKpis: true, deliveryMap: true, collection: true, deliveryAlerts: true, deliveryMilestones: true },
    privacy: { contractNumberMode: "masked" as const, addressLevel: "provinceCity" as const, showDisplayNotice: true },
  };

  it("accepts multiplier value 1", () => {
    const config = { ...validBase, multipliers: { amount: 1, customerCount: 1, contractCount: 1, shipmentCount: 1 } };
    expect(() => parseSalesScreenConfig(config)).not.toThrow();
  });

  it("accepts multiplier value 100", () => {
    const config = { ...validBase, multipliers: { amount: 100, customerCount: 100, contractCount: 100, shipmentCount: 100 } };
    expect(() => parseSalesScreenConfig(config)).not.toThrow();
  });

  it("rejects multiplier value 0", () => {
    const config = { ...validBase, multipliers: { amount: 0, customerCount: 1, contractCount: 1, shipmentCount: 1 } };
    expect(() => parseSalesScreenConfig(config)).toThrow("倍率必须在 1～100 之间");
  });

  it("rejects multiplier value 101", () => {
    const config = { ...validBase, multipliers: { amount: 101, customerCount: 1, contractCount: 1, shipmentCount: 1 } };
    expect(() => parseSalesScreenConfig(config)).toThrow("倍率必须在 1～100 之间");
  });

  it("rejects negative multiplier", () => {
    const config = { ...validBase, multipliers: { amount: -5, customerCount: 1, contractCount: 1, shipmentCount: 1 } };
    expect(() => parseSalesScreenConfig(config)).toThrow("倍率必须在 1～100 之间");
  });

  it("rejects decimal multiplier", () => {
    const config = { ...validBase, multipliers: { amount: 5.5, customerCount: 1, contractCount: 1, shipmentCount: 1 } };
    expect(() => parseSalesScreenConfig(config)).toThrow("倍率必须是整数");
  });

  it("rejects numeric string multiplier", () => {
    const config = { ...validBase, multipliers: { amount: "5" as any, customerCount: 1, contractCount: 1, shipmentCount: 1 } };
    expect(() => parseSalesScreenConfig(config)).toThrow();
  });

  it("rejects NaN multiplier", () => {
    const config = { ...validBase, multipliers: { amount: NaN, customerCount: 1, contractCount: 1, shipmentCount: 1 } };
    expect(() => parseSalesScreenConfig(config)).toThrow();
  });

  it("rejects Infinity multiplier", () => {
    const config = { ...validBase, multipliers: { amount: Infinity, customerCount: 1, contractCount: 1, shipmentCount: 1 } };
    expect(() => parseSalesScreenConfig(config)).toThrow();
  });
});

describe("module and enum validation", () => {
  const validBase = {
    version: 1,
    enabled: false,
    multipliers: { amount: 1, customerCount: 1, contractCount: 1, shipmentCount: 1 },
    privacy: { contractNumberMode: "masked" as const, addressLevel: "provinceCity" as const, showDisplayNotice: true },
  };

  it("rejects when all modules are disabled", () => {
    const config = {
      ...validBase,
      modules: { operatingKpis: false, deliveryMap: false, collection: false, deliveryAlerts: false, deliveryMilestones: false },
    };
    expect(() => parseSalesScreenConfig(config)).toThrow("至少需要启用一个板块");
  });

  it("rejects when a module field is missing", () => {
    const config = {
      ...validBase,
      modules: { operatingKpis: true, deliveryMap: true, collection: true, deliveryAlerts: true },
    };
    expect(() => parseSalesScreenConfig(config)).toThrow();
  });

  it("rejects when a module field is not boolean", () => {
    const config = {
      ...validBase,
      modules: { operatingKpis: "yes" as any, deliveryMap: true, collection: true, deliveryAlerts: true, deliveryMilestones: true },
    };
    expect(() => parseSalesScreenConfig(config)).toThrow();
  });

  it("rejects invalid contractNumberMode", () => {
    const config = {
      ...validBase,
      modules: { operatingKpis: true, deliveryMap: true, collection: true, deliveryAlerts: true, deliveryMilestones: true },
      privacy: { contractNumberMode: "visible" as any, addressLevel: "provinceCity", showDisplayNotice: true },
    };
    expect(() => parseSalesScreenConfig(config)).toThrow();
  });

  it("rejects invalid addressLevel", () => {
    const config = {
      ...validBase,
      modules: { operatingKpis: true, deliveryMap: true, collection: true, deliveryAlerts: true, deliveryMilestones: true },
      privacy: { contractNumberMode: "masked", addressLevel: "city" as any, showDisplayNotice: true },
    };
    expect(() => parseSalesScreenConfig(config)).toThrow();
  });

  it("rejects when showDisplayNotice is not boolean", () => {
    const config = {
      ...validBase,
      modules: { operatingKpis: true, deliveryMap: true, collection: true, deliveryAlerts: true, deliveryMilestones: true },
      privacy: { contractNumberMode: "masked", addressLevel: "provinceCity", showDisplayNotice: "true" as any },
    };
    expect(() => parseSalesScreenConfig(config)).toThrow();
  });

  it("rejects unknown top-level field", () => {
    const config = {
      ...validBase,
      modules: { operatingKpis: true, deliveryMap: true, collection: true, deliveryAlerts: true, deliveryMilestones: true },
      unknownField: "should not be here",
    };
    expect(() => parseSalesScreenConfig(config)).toThrow("配置包含未知字段");
  });

  it("rejects unknown field in nested modules object", () => {
    const config = {
      ...validBase,
      modules: { operatingKpis: true, deliveryMap: true, collection: true, deliveryAlerts: true, deliveryMilestones: true, hackerField: true as any },
    };
    expect(() => parseSalesScreenConfig(config)).toThrow("配置包含未知字段");
  });

  it("rejects unknown field in nested multipliers object", () => {
    const config = {
      ...validBase,
      modules: { operatingKpis: true, deliveryMap: true, collection: true, deliveryAlerts: true, deliveryMilestones: true },
      multipliers: { amount: 1, customerCount: 1, contractCount: 1, shipmentCount: 1, extraField: 99 as any },
    };
    expect(() => parseSalesScreenConfig(config)).toThrow("配置包含未知字段");
  });

  it("rejects unknown field in nested privacy object", () => {
    const config = {
      ...validBase,
      modules: { operatingKpis: true, deliveryMap: true, collection: true, deliveryAlerts: true, deliveryMilestones: true },
      privacy: { contractNumberMode: "masked" as const, addressLevel: "provinceCity" as const, showDisplayNotice: true, leak: "data" as any },
    };
    expect(() => parseSalesScreenConfig(config)).toThrow("配置包含未知字段");
  });
});
