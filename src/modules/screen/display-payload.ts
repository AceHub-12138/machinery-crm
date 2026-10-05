/**
 * 展示层转换模块（纯函数）
 *
 * 输入是第 4 步服务器入口构造好的 SalesScreenSourceData：
 * - 汇总是显式全量字段（真实 dashboard 列表查询带 take 截断，列表只能当样本）；
 * - province/city 已经过 location.ts 校验；
 * 本模块只负责：倍率、白名单投影兜底、受控取样、确定性 key、比率重算。
 *
 * 纯函数约束：不读取时钟、不使用随机数、不访问 IO；
 * 同一输入（含 options.generatedAt）恒定产生同一输出，
 * 60 秒轮询刷新时列表 key 保持稳定。
 */

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { SalesScreenConfig } from "./config";
import type {
  PublicSalesScreenPayload,
  PublicRouteSample,
  PublicReminderSample,
  PublicMilestoneSample,
} from "./public-types";
import type {
  SalesScreenSourceData,
  SalesScreenRouteSource,
  SalesScreenReminderSource,
} from "./source-data";
import { getProvinceCenter } from "./province-centers";
import { getCityCenter } from "./city-centers";
import { isValidLocation } from "./location";

// 受控样本上限（任务书口径：地图路线最多若干条、里程碑最多 5 条、每组提醒最多 2 条）
const ROUTE_SAMPLE_LIMIT = 80;
const REMINDER_SAMPLE_LIMIT = 2;
const MILESTONE_SAMPLE_LIMIT = 5;

export type TransformOptions = {
  /** payload 生成时间（ISO 字符串），由调用方提供以保证纯函数语义 */
  generatedAt: string;
};

function safeInteger(value: unknown, multiplier: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  const result = Math.floor(value * multiplier);
  return Number.isSafeInteger(result) ? result : 0;
}

function applyAmountMultiplier(value: unknown, multiplier: number): string {
  let normalized: string;

  // 处理 Prisma.Decimal 等结构化兼容对象
  if (value && typeof value === "object" && "toFixed" in value) {
    normalized = (value as { toFixed: () => string }).toFixed();
  } else if (typeof value === "number") {
    normalized = String(value);
  } else if (typeof value === "string") {
    const testDecimal = parseFloat(value);
    if (!Number.isFinite(testDecimal)) {
      return "0.00";
    }
    normalized = value;
  } else {
    return "0.00";
  }

  let decimal: Prisma.Decimal;
  try {
    decimal = new Prisma.Decimal(normalized);
  } catch {
    return "0.00";
  }

  if (!decimal.isFinite() || decimal.lt(0)) {
    return "0.00";
  }

  const result = decimal.mul(multiplier);
  return result.toFixed(2);
}

function toSafeRate(rate: Prisma.Decimal, max: number): number {
  if (!rate.isFinite() || rate.lt(0)) {
    return 0;
  }
  if (rate.gt(max)) {
    return max;
  }
  return rate.toDecimalPlaces(1).toNumber();
}

function calculateCollectionRate(paid: string, total: string): number {
  const paidDecimal = new Prisma.Decimal(paid);
  const totalDecimal = new Prisma.Decimal(total);

  if (!totalDecimal.isFinite() || totalDecimal.lte(0)) {
    return 0;
  }

  const rate = paidDecimal.div(totalDecimal).mul(100);
  return toSafeRate(rate, 100);
}

/**
 * 内容派生的确定性 UUID（SHA-256 哈希取段，按 RFC 4122 版本 5 形态格式化）
 * 不是数据库 ID；同内容恒定同 key，列表在 60 秒轮询间保持稳定
 */
function deterministicKey(seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex");
  const variant = ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    `${variant}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

/**
 * key 派生器（单次转换内共享同内容序号计数）：
 * - 输入必须是"已构造完成的最终公开样本"（不含 key 本身），种子即其 JSON 规范化序列化——
 *   key 因此不可能编码任何未公开字段（倍率前台数、隐藏省市、未输出状态、原始合同号）；
 * - JSON 序列化无歧义，字段值含 "|" 等分隔符不会产生碰撞；
 * - 不含数组位置索引——前插或删除其他条目不影响既有 key，轮询稳定；
 * - 完全同内容的条目按出现顺序分配序号，保证 key 唯一。
 */
function createKeyBuilder() {
  const ordinals = new Map<string, number>();
  return (publicSample: object): string => {
    const base = JSON.stringify(publicSample);
    const ordinal = ordinals.get(base) ?? 0;
    ordinals.set(base, ordinal + 1);
    return deterministicKey(`${base}#${ordinal}`);
  };
}

/**
 * 脱敏合同号
 * masked 模式：限制最多显示 4 位尾数字，其余用星号替换
 * hidden 模式：返回 null
 */
function maskContractNumber(contractNo: string | null | undefined, mode: "masked" | "hidden"): string | null {
  if (mode === "hidden") {
    return null;
  }

  if (!contractNo || typeof contractNo !== "string" || contractNo.length === 0) {
    return null;
  }

  // 提取末尾连续数字
  const digits = contractNo.match(/\d+$/);
  if (!digits) {
    return null;
  }

  const tailDigits = digits[0];
  const visibleTail = tailDigits.slice(-4);
  const hiddenLength = contractNo.length - visibleTail.length;
  const stars = "*".repeat(Math.max(1, hiddenLength));

  return stars + visibleTail;
}

/** 防御性解析城市：只接受通过校验的标准城市，provinceCity 模式之外一律 null */
function resolveDisplayCity(province: string, city: unknown, addressLevel: "province" | "provinceCity"): string | null {
  if (addressLevel !== "provinceCity" || !city || typeof city !== "string") {
    return null;
  }
  return isValidLocation(province, city) ? city : null;
}

// 最终公开样本的草稿形态（即不含 key 的输出样本，字段与公开输出一一对应）
type PublicRouteDraft = Omit<PublicRouteSample, "key">;
type PublicReminderDraft = Omit<PublicReminderSample, "key">;
type PublicMilestoneDraft = Omit<PublicMilestoneSample, "key">;

/** 为草稿补上内容派生 key，得到最终公开样本 */
function withKey<T extends object>(draft: T, buildKey: (sample: object) => string): T & { key: string } {
  return { ...draft, key: buildKey(draft) };
}

export function transformToPublicPayload(
  source: SalesScreenSourceData,
  config: SalesScreenConfig,
  options: TransformOptions
): PublicSalesScreenPayload {
  const { multipliers } = config;
  const addressLevel = config.privacy.addressLevel;
  const contractMode = config.privacy.contractNumberMode;
  const buildKey = createKeyBuilder();

  // 以下分组均做防御性兜底：上游字段缺失或被夹带垃圾时安全归零
  const kpis = (source.kpis ?? {}) as Partial<SalesScreenSourceData["kpis"]>;
  const amounts = (source.amounts ?? {}) as Partial<SalesScreenSourceData["amounts"]>;
  const totals = (source.deliveryTotals ?? {}) as Partial<SalesScreenSourceData["deliveryTotals"]>;

  // KPI 金额应用倍率
  const periodContractAmount = applyAmountMultiplier(amounts.periodContractAmount, multipliers.amount);
  const periodPaidAmount = applyAmountMultiplier(amounts.periodPaidAmount, multipliers.amount);
  const periodUnpaidAmount = applyAmountMultiplier(amounts.periodUnpaidAmount, multipliers.amount);
  const totalContractAmount = applyAmountMultiplier(amounts.totalContractAmount, multipliers.amount);
  const totalPaidAmount = applyAmountMultiplier(amounts.totalPaidAmount, multipliers.amount);
  const totalUnpaidAmount = applyAmountMultiplier(amounts.totalUnpaidAmount, multipliers.amount);

  // 回款率从扩大后的展示值重新计算
  const collectionRate = calculateCollectionRate(totalPaidAmount, totalContractAmount);

  // 销售目标处理
  const targetInput = source.target && typeof source.target === "object" ? source.target : null;
  let collectionTarget = {
    targetAmount: "0.00",
    actualAmount: "0.00",
    targetRate: 0,
    targetVisualRate: 0,
    remainingAmount: "0.00",
    exceededAmount: "0.00",
    exceeded: false,
  };

  if (targetInput) {
    const targetAmount = applyAmountMultiplier(targetInput.targetAmount, multipliers.amount);
    const actualAmount = applyAmountMultiplier(targetInput.actualAmount, multipliers.amount);

    const targetDecimal = new Prisma.Decimal(targetAmount);
    const actualDecimal = new Prisma.Decimal(actualAmount);

    const targetRate = targetDecimal.gt(0)
      ? toSafeRate(actualDecimal.div(targetDecimal).mul(100), Number.MAX_SAFE_INTEGER)
      : 0;

    const targetVisualRate = Math.max(0, Math.min(100, targetRate));
    const exceeded = actualDecimal.gt(targetDecimal);

    collectionTarget = {
      targetAmount,
      actualAmount,
      targetRate,
      targetVisualRate,
      remainingAmount: Prisma.Decimal.max(targetDecimal.sub(actualDecimal), 0).toFixed(2),
      exceededAmount: Prisma.Decimal.max(actualDecimal.sub(targetDecimal), 0).toFixed(2),
      exceeded,
    };
  }

  // 交付汇总：显式全量字段 × 倍率；省份覆盖数不乘倍率（任务书第 7 节）
  const summary = {
    shipmentCount: safeInteger(totals.shipmentCount, multipliers.shipmentCount),
    unitCount: safeInteger(totals.unitCount, multipliers.shipmentCount),
    regionCount: safeInteger(totals.regionCount, 1),
    todayDue: safeInteger(totals.todayDue, multipliers.shipmentCount),
    sevenDayDue: safeInteger(totals.sevenDayDue, multipliers.shipmentCount),
    overdueDue: safeInteger(totals.overdueDue, multipliers.shipmentCount),
  };

  // 路线样本：输入省市已验证，此处做防御性兜底后先构造草稿（不含 key）
  const sourceRoutes: SalesScreenRouteSource[] = Array.isArray(source.routes) ? source.routes : [];
  const routeDrafts: PublicRouteDraft[] = [];

  for (const item of sourceRoutes) {
    if (!item || !item.shipmentDate || !item.province) {
      continue;
    }
    if (!isValidLocation(item.province, null)) {
      continue;
    }

    const city = resolveDisplayCity(item.province, item.city, addressLevel);

    // provinceCity 模式优先城市级中心点，坐标表未收录时回退省级中心
    const center =
      (addressLevel === "provinceCity" && city ? getCityCenter(item.province, city) : null) ??
      getProvinceCenter(item.province);
    if (!center) {
      continue;
    }

    routeDrafts.push({
      province: item.province,
      city,
      centerLat: center.lat,
      centerLng: center.lng,
      equipmentName: item.equipmentName || "",
      equipmentModel: item.equipmentModel || "",
      shipmentDate: item.shipmentDate,
      unitCount: safeInteger(item.quantity, multipliers.shipmentCount),
    });
  }

  // 列表只取受控样本；key 仅由最终公开字段派生
  const routes: PublicRouteSample[] = routeDrafts
    .slice(0, ROUTE_SAMPLE_LIMIT)
    .map((draft) => withKey(draft, buildKey));

  // 提醒样本：先过滤有效草稿，再取前 2 条，无效条目不占样本名额
  const toReminderDraft = (item: SalesScreenReminderSource | undefined): PublicReminderDraft | null => {
    if (!item || !item.estimatedShipmentDate || !item.province) {
      return null;
    }
    if (!isValidLocation(item.province, null)) {
      return null;
    }

    const city = resolveDisplayCity(item.province, item.city, addressLevel);

    return {
      contractNumber: maskContractNumber(item.contractNo, contractMode),
      equipmentName: item.equipmentName || "",
      equipmentModel: item.equipmentModel || "",
      estimatedShipmentDate: item.estimatedShipmentDate,
      province: item.province,
      city,
    };
  };

  const collectReminderDrafts = (list: unknown): PublicReminderDraft[] => {
    const drafts: PublicReminderDraft[] = [];
    if (!Array.isArray(list)) {
      return drafts;
    }
    for (const item of list) {
      if (drafts.length >= REMINDER_SAMPLE_LIMIT) {
        break;
      }
      const draft = toReminderDraft(item as SalesScreenReminderSource);
      if (draft) {
        drafts.push(draft);
      }
    }
    return drafts;
  };

  const reminders = {
    today: collectReminderDrafts(source.reminders?.today).map((draft) => withKey(draft, buildKey)),
    sevenDays: collectReminderDrafts(source.reminders?.sevenDays).map((draft) => withKey(draft, buildKey)),
    overdue: collectReminderDrafts(source.reminders?.overdue).map((draft) => withKey(draft, buildKey)),
  };

  // 里程碑样本：从路线源过滤 SHIPPED，先过滤后构造草稿
  const milestoneDrafts: PublicMilestoneDraft[] = [];
  for (const item of sourceRoutes) {
    if (milestoneDrafts.length >= MILESTONE_SAMPLE_LIMIT) {
      break;
    }
    if (!item || !item.shipmentDate || item.shipmentStatus !== "SHIPPED") {
      continue;
    }
    milestoneDrafts.push({
      contractNumber: maskContractNumber(item.contractNo, contractMode),
      equipmentName: item.equipmentName || "",
      equipmentModel: item.equipmentModel || "",
      shipmentDate: item.shipmentDate,
      shipmentStatus: item.shipmentStatus,
      unitCount: safeInteger(item.quantity, multipliers.shipmentCount),
    });
  }

  const milestones: PublicMilestoneSample[] = milestoneDrafts.map((draft) => withKey(draft, buildKey));

  return {
    version: 1,
    generatedAt: options.generatedAt,
    displayNotice: config.privacy.showDisplayNotice,
    modules: config.modules,
    period: {
      label: source.period?.label ?? "",
      startDate: source.period?.startDate ?? "",
      endDate: source.period?.endDate ?? "",
    },
    kpis: {
      totalCustomers: safeInteger(kpis.totalCustomers, multipliers.customerCount),
      periodNewCustomers: safeInteger(kpis.periodNewCustomers, multipliers.customerCount),
      todayFollowUp: safeInteger(kpis.todayFollowUp, multipliers.customerCount),
      overdueFollowUp: safeInteger(kpis.overdueFollowUp, multipliers.customerCount),
      sevenDayFollowUp: safeInteger(kpis.sevenDayFollowUp, multipliers.customerCount),
      periodNewContracts: safeInteger(kpis.periodNewContracts, multipliers.contractCount),
      periodContractAmount,
      periodPaidAmount,
      periodUnpaidAmount,
      periodShipments: safeInteger(kpis.periodShipments, multipliers.shipmentCount),
      unpaidContracts: safeInteger(kpis.unpaidContracts, multipliers.contractCount),
      partialPaidContracts: safeInteger(kpis.partialPaidContracts, multipliers.contractCount),
    },
    collection: {
      totalContractAmount,
      totalPaidAmount,
      totalUnpaidAmount,
      collectionRate,
      ...collectionTarget,
    },
    delivery: {
      summary,
      routes,
      reminders,
      milestones,
    },
  };
}
