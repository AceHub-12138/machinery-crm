import { z } from "zod";
import { DomainError } from "@/modules/shared/domain-error";

export const SALES_SCREEN_SETTING_KEY = "salesScreen";

export type SalesScreenConfig = {
  version: 1;
  enabled: boolean;
  modules: {
    operatingKpis: boolean;
    deliveryMap: boolean;
    collection: boolean;
    deliveryAlerts: boolean;
    deliveryMilestones: boolean;
  };
  multipliers: {
    amount: number;
    customerCount: number;
    contractCount: number;
    shipmentCount: number;
  };
  privacy: {
    contractNumberMode: "masked" | "hidden";
    addressLevel: "province" | "provinceCity";
    showDisplayNotice: boolean;
  };
};

export const DEFAULT_SALES_SCREEN_CONFIG: SalesScreenConfig = {
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

export function normalizeSalesScreenConfig(value: unknown): SalesScreenConfig {
  const defaults = DEFAULT_SALES_SCREEN_CONFIG;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return JSON.parse(JSON.stringify(defaults));
  }

  const input = value as Record<string, unknown>;

  const safeBoolean = (val: unknown, fallback: boolean): boolean => {
    return typeof val === "boolean" ? val : fallback;
  };

  const safeNumber = (val: unknown, fallback: number): number => {
    if (typeof val !== "number" || !Number.isFinite(val)) {
      return fallback;
    }
    // 倍率必须是 1～100 的整数
    if (val < 1 || val > 100 || !Number.isInteger(val)) {
      return fallback;
    }
    return val;
  };

  const safeEnum = <T extends string>(val: unknown, allowed: readonly T[], fallback: T): T => {
    return typeof val === "string" && allowed.includes(val as T) ? (val as T) : fallback;
  };

  const modules = typeof input.modules === "object" && input.modules !== null && !Array.isArray(input.modules)
    ? (input.modules as Record<string, unknown>)
    : {};

  const multipliers = typeof input.multipliers === "object" && input.multipliers !== null && !Array.isArray(input.multipliers)
    ? (input.multipliers as Record<string, unknown>)
    : {};

  const privacy = typeof input.privacy === "object" && input.privacy !== null && !Array.isArray(input.privacy)
    ? (input.privacy as Record<string, unknown>)
    : {};

  const normalizedModules = {
    operatingKpis: safeBoolean(modules.operatingKpis, defaults.modules.operatingKpis),
    deliveryMap: safeBoolean(modules.deliveryMap, defaults.modules.deliveryMap),
    collection: safeBoolean(modules.collection, defaults.modules.collection),
    deliveryAlerts: safeBoolean(modules.deliveryAlerts, defaults.modules.deliveryAlerts),
    deliveryMilestones: safeBoolean(modules.deliveryMilestones, defaults.modules.deliveryMilestones),
  };

  // 如果五个板块全部为 false，恢复为安全默认值（全部启用）
  const hasEnabledModule = Object.values(normalizedModules).some((enabled) => enabled);
  const finalModules = hasEnabledModule ? normalizedModules : defaults.modules;

  return {
    version: 1,
    enabled: safeBoolean(input.enabled, defaults.enabled),
    modules: finalModules,
    multipliers: {
      amount: safeNumber(multipliers.amount, defaults.multipliers.amount),
      customerCount: safeNumber(multipliers.customerCount, defaults.multipliers.customerCount),
      contractCount: safeNumber(multipliers.contractCount, defaults.multipliers.contractCount),
      shipmentCount: safeNumber(multipliers.shipmentCount, defaults.multipliers.shipmentCount),
    },
    privacy: {
      contractNumberMode: safeEnum(privacy.contractNumberMode, ["masked", "hidden"] as const, defaults.privacy.contractNumberMode),
      addressLevel: safeEnum(privacy.addressLevel, ["province", "provinceCity"] as const, defaults.privacy.addressLevel),
      showDisplayNotice: safeBoolean(privacy.showDisplayNotice, defaults.privacy.showDisplayNotice),
    },
  };
}

export function parseSalesScreenConfig(value: unknown): SalesScreenConfig {
  // 预校验：确保是对象
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("配置必须是对象", 400);
  }

  const input = value as Record<string, unknown>;

  // 预校验倍率字段：拒绝字符串、NaN、Infinity
  if (input.multipliers && typeof input.multipliers === "object" && !Array.isArray(input.multipliers)) {
    const mults = input.multipliers as Record<string, unknown>;
    for (const field of ["amount", "customerCount", "contractCount", "shipmentCount"]) {
      const val = mults[field];
      if (val !== undefined) {
        if (typeof val === "string") {
          throw new DomainError(`倍率必须是数字，不接受字符串`, 400);
        }
        if (typeof val === "number" && (Number.isNaN(val) || !Number.isFinite(val))) {
          throw new DomainError("倍率不能是 NaN 或 Infinity", 400);
        }
      }
    }
  }

  // Zod 严格校验
  const multiplierSchema = z.number()
    .int({ message: "倍率必须是整数" })
    .min(1, { message: "倍率必须在 1～100 之间" })
    .max(100, { message: "倍率必须在 1～100 之间" });

  const schema = z.object({
    version: z.literal(1),
    enabled: z.boolean(),
    modules: z.object({
      operatingKpis: z.boolean(),
      deliveryMap: z.boolean(),
      collection: z.boolean(),
      deliveryAlerts: z.boolean(),
      deliveryMilestones: z.boolean(),
    })
      .strict()
      .refine(
        (modules) => Object.values(modules).some((enabled) => enabled),
        { message: "至少需要启用一个板块" }
      ),
    multipliers: z.object({
      amount: multiplierSchema,
      customerCount: multiplierSchema,
      contractCount: multiplierSchema,
      shipmentCount: multiplierSchema,
    }).strict(),
    privacy: z.object({
      contractNumberMode: z.enum(["masked", "hidden"]),
      addressLevel: z.enum(["province", "provinceCity"]),
      showDisplayNotice: z.boolean(),
    }).strict(),
  }).strict();

  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstIssue = error.issues[0];

      // 将所有 Zod 错误码映射为中文错误消息
      if (firstIssue?.code === "unrecognized_keys") {
        throw new DomainError("配置包含未知字段", 400);
      }

      // 优先使用自定义错误消息（如倍率验证的具体消息）
      if (firstIssue?.message && !firstIssue.message.startsWith("Expected") && !firstIssue.message.startsWith("Invalid") && !firstIssue.message.startsWith("Unrecognized")) {
        throw new DomainError(firstIssue.message, 400);
      }

      if (firstIssue?.code === "invalid_type") {
        const path = firstIssue.path.join(".");
        throw new DomainError(`字段 ${path} 的类型不正确`, 400);
      }
      // Zod 4：枚举与字面量不匹配统一为 invalid_value（v3 的 invalid_enum_value / invalid_literal 已移除）
      if (firstIssue?.code === "invalid_value") {
        const path = firstIssue.path.join(".");
        throw new DomainError(`字段 ${path} 的值不在允许的选项中`, 400);
      }
      if (firstIssue?.code === "invalid_union") {
        const path = firstIssue.path.join(".");
        throw new DomainError(`字段 ${path} 的格式不正确`, 400);
      }
      if (firstIssue?.code === "too_small") {
        const path = firstIssue.path.join(".");
        throw new DomainError(`字段 ${path} 的值过小`, 400);
      }
      if (firstIssue?.code === "too_big") {
        const path = firstIssue.path.join(".");
        throw new DomainError(`字段 ${path} 的值过大`, 400);
      }

      // 最后兜底：检查消息内容
      throw new DomainError("配置格式无效", 400);
    }
    throw new DomainError("配置格式无效", 400);
  }
}
