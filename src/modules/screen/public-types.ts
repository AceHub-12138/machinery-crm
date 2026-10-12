/**
 * 公开展示专用类型
 * 仅包含白名单字段，不包含任何敏感信息
 */

import type { SalesScreenConfig } from "./config";

export type PublicSalesScreenPayload = {
  version: 1;
  generatedAt: string;
  displayNotice: boolean;
  modules: SalesScreenConfig["modules"];
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
    /** 本期有效 CNY 合同数，与本期合同额使用同一合同集合。 */
    periodNewContracts: number;
    periodContractAmount: string;
    periodPaidAmount: string;
    periodUnpaidAmount: string;
    periodShipments: number;
    /** 累计有效 CNY 未回款合同数。 */
    unpaidContracts: number;
    /** 累计有效 CNY 部分回款合同数。 */
    partialPaidContracts: number;
  };
  collection: {
    totalContractAmount: string;
    totalPaidAmount: string;
    totalUnpaidAmount: string;
    collectionRate: number;
    /** 同月公司目标取最后修改的一条（updatedAt desc，id asc）。 */
    targetConfigured?: boolean;
    targetAmount: string;
    actualAmount: string;
    targetRate: number;
    targetVisualRate: number;
    remainingAmount: string;
    exceededAmount: string;
    exceeded: boolean;
  };
  delivery: {
    summary: {
      shipmentCount: number;
      unitCount: number;
      regionCount: number;
      todayDue: number;
      sevenDayDue: number;
      overdueDue: number;
    };
    regionUnits?: Array<{ province: string; shipmentCount: number; unitCount: number }>;
    unresolvedRegionTotals?: { shipmentCount: number; unitCount: number };
    routesTotal?: number;
    milestonesTotal?: number;
    routes: PublicRouteSample[];
    reminders: {
      todayTotal?: number;
      sevenDaysTotal?: number;
      overdueTotal?: number;
      today: PublicReminderSample[];
      sevenDays: PublicReminderSample[];
      overdue: PublicReminderSample[];
    };
    milestones: PublicMilestoneSample[];
  };
};

export type PublicRouteSample = {
  key: string;
  province: string;
  city: string | null;
  centerLat: number;
  centerLng: number;
  equipmentName: string;
  equipmentModel: string;
  shipmentDate: string;
  unitCount: number;
};

export type PublicReminderSample = {
  key: string;
  contractNumber: string | null;
  equipmentName: string;
  equipmentModel: string;
  estimatedShipmentDate: string;
  province: string;
  city: string | null;
};

export type PublicMilestoneSample = {
  key: string;
  contractNumber: string | null;
  equipmentName: string;
  equipmentModel: string;
  shipmentDate: string;
  shipmentStatus: string;
  unitCount: number;
};
