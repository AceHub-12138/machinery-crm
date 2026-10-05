/**
 * 公开 payload 测试夹具（仅测试使用，不参与生产构建）。
 *
 * 形状与 PublicSalesScreenPayload 完全一致：
 * 金额为十进制字符串、路线只含省市中心投影输入、样本 key 为内容派生串。
 */

import type { PublicSalesScreenPayload } from "./public-types";

export const FIXTURE_PUBLIC_ID = "a".repeat(43);

export function buildPublicSalesScreenPayloadFixture(
  overrides: Partial<PublicSalesScreenPayload> = {},
): PublicSalesScreenPayload {
  return {
    version: 1,
    generatedAt: "2026-09-21T08:00:00.000Z",
    displayNotice: true,
    modules: {
      operatingKpis: true,
      deliveryMap: true,
      collection: true,
      deliveryAlerts: true,
      deliveryMilestones: true,
    },
    period: {
      label: "2026年9月",
      startDate: "2026-09-01",
      endDate: "2026-09-21",
    },
    kpis: {
      totalCustomers: 1286,
      periodNewCustomers: 23,
      todayFollowUp: 12,
      overdueFollowUp: 4,
      sevenDayFollowUp: 31,
      periodNewContracts: 18,
      periodContractAmount: "51640000.00",
      periodPaidAmount: "32120000.00",
      periodUnpaidAmount: "19520000.00",
      periodShipments: 47,
      unpaidContracts: 9,
      partialPaidContracts: 6,
    },
    collection: {
      totalContractAmount: "128600000.00",
      totalPaidAmount: "82040000.00",
      totalUnpaidAmount: "46560000.00",
      collectionRate: 63.8,
      targetAmount: "60000000.00",
      actualAmount: "51640000.00",
      targetRate: 86.1,
      targetVisualRate: 86.1,
      remainingAmount: "8360000.00",
      exceededAmount: "0.00",
      exceeded: false,
    },
    delivery: {
      summary: {
        shipmentCount: 86,
        unitCount: 132,
        regionCount: 9,
        todayDue: 5,
        sevenDayDue: 17,
        overdueDue: 3,
      },
      routes: [
        {
          key: "route-1",
          province: "山东省",
          city: "济南市",
          centerLat: 36.65,
          centerLng: 117.12,
          equipmentName: "数控龙门加工中心",
          equipmentModel: "XK2425",
          shipmentDate: "2026-09-20T00:00:00.000Z",
          unitCount: 2,
        },
        {
          key: "route-2",
          province: "江苏省",
          city: null,
          centerLat: 32.06,
          centerLng: 118.8,
          equipmentName: "卧式加工中心",
          equipmentModel: "HMC800",
          shipmentDate: "2026-09-19T00:00:00.000Z",
          unitCount: 1,
        },
        {
          key: "route-3",
          province: "广东省",
          city: "广州市",
          centerLat: 23.13,
          centerLng: 113.27,
          equipmentName: "数控车床",
          equipmentModel: "CK6150",
          shipmentDate: "2026-09-18T00:00:00.000Z",
          unitCount: 3,
        },
      ],
      reminders: {
        today: [
          {
            key: "reminder-t1",
            contractNumber: "****1036",
            equipmentName: "数控龙门加工中心",
            equipmentModel: "XK2425",
            estimatedShipmentDate: "2026-09-21T00:00:00.000Z",
            province: "山东省",
            city: "济南市",
          },
        ],
        sevenDays: [
          {
            key: "reminder-s1",
            contractNumber: null,
            equipmentName: "立式加工中心",
            equipmentModel: "VMC1060",
            estimatedShipmentDate: "2026-09-25T00:00:00.000Z",
            province: "河南省",
            city: null,
          },
        ],
        overdue: [
          {
            key: "reminder-o1",
            contractNumber: "****2087",
            equipmentName: "数控镗铣床",
            equipmentModel: "TK6920",
            estimatedShipmentDate: "2026-09-15T00:00:00.000Z",
            province: "安徽省",
            city: "合肥市",
          },
        ],
      },
      milestones: [
        {
          key: "milestone-1",
          contractNumber: "****1036",
          equipmentName: "数控龙门加工中心",
          equipmentModel: "XK2425",
          shipmentDate: "2026-09-20T00:00:00.000Z",
          shipmentStatus: "SHIPPED",
          unitCount: 2,
        },
        {
          key: "milestone-2",
          contractNumber: null,
          equipmentName: "卧式加工中心",
          equipmentModel: "HMC800",
          shipmentDate: "2026-09-19T00:00:00.000Z",
          shipmentStatus: "SHIPPED",
          unitCount: 1,
        },
      ],
    },
    ...overrides,
  };
}
