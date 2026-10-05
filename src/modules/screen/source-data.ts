/**
 * 展厅大屏数据源契约（服务器内部结构，不直接发给浏览器）
 *
 * 第 4 步的公开数据服务负责从真实 CRM 数据构造本结构：
 * - 汇总必须是显式全量字段；真实 dashboard 的列表查询带 take 截断，
 *   截断后的列表只允许作为展示样本，绝不能当作总量来源；
 * - province/city 必须已经过 location.ts 的标准行政区划校验；
 * - 客户身份信息（名称、联系人、电话、业务员、详细地址、数据库 ID）
 *   在本结构中就应当缺席，转换器只做白名单投影兜底。
 */

/** 金额输入兼容 number / string / Prisma.Decimal（结构化兼容，不引入 Prisma 依赖） */
export type AmountInput = number | string | { toFixed: () => string };

export type SalesScreenDeliveryTotals = {
  /** 发货总单数（全量口径，区别于 kpis.periodShipments 的"本期发货数"） */
  shipmentCount: number;
  /** 交付总台数（全量口径） */
  unitCount: number;
  /** 覆盖省份数（全量口径） */
  regionCount: number;
  todayDue: number;
  sevenDayDue: number;
  overdueDue: number;
};

export type SalesScreenRouteSource = {
  contractNo: string;
  equipmentName: string;
  equipmentModel: string;
  /** ISO 字符串 */
  shipmentDate: string;
  shipmentStatus: string;
  quantity: number;
  /** 已验证的标准省级名称 */
  province: string;
  /** 已验证的标准地级市名称，无法验证时必须为 null */
  city: string | null;
};

export type SalesScreenReminderSource = {
  contractNo: string;
  equipmentName: string;
  equipmentModel: string;
  /** ISO 字符串 */
  estimatedShipmentDate: string;
  /** 已验证的标准省级名称 */
  province: string;
  /** 已验证的标准地级市名称，无法验证时必须为 null */
  city: string | null;
};

export type SalesScreenSourceData = {
  period: {
    label: string;
    startDate: string;
    endDate: string;
  };
  kpis: {
    totalCustomers: number;
    periodNewCustomers: number;
    todayFollowUp: number;
    overdueFollowUp: number;
    sevenDayFollowUp: number;
    periodNewContracts: number;
    /** 本期发货数（区别于 deliveryTotals.shipmentCount 的全量总单数） */
    periodShipments: number;
    unpaidContracts: number;
    partialPaidContracts: number;
  };
  amounts: {
    periodContractAmount: AmountInput;
    periodPaidAmount: AmountInput;
    periodUnpaidAmount: AmountInput;
    totalContractAmount: AmountInput;
    totalPaidAmount: AmountInput;
    totalUnpaidAmount: AmountInput;
  };
  /** 当前考核期销售目标；无目标时为 null */
  target: {
    targetAmount: AmountInput;
    actualAmount: AmountInput;
  } | null;
  deliveryTotals: SalesScreenDeliveryTotals;
  routes: SalesScreenRouteSource[];
  reminders: {
    today: SalesScreenReminderSource[];
    sevenDays: SalesScreenReminderSource[];
    overdue: SalesScreenReminderSource[];
  };
};
