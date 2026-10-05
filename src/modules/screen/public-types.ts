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
    periodNewContracts: number;
    periodContractAmount: string;
    periodPaidAmount: string;
    periodUnpaidAmount: string;
    periodShipments: number;
    unpaidContracts: number;
    partialPaidContracts: number;
  };
  collection: {
    totalContractAmount: string;
    totalPaidAmount: string;
    totalUnpaidAmount: string;
    collectionRate: number;
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
    routes: PublicRouteSample[];
    reminders: {
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
