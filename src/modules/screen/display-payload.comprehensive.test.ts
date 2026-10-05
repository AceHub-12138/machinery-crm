import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { transformToPublicPayload } from "./display-payload";
import type { SalesScreenConfig } from "./config";
import type { SalesScreenSourceData } from "./source-data";
import { PROVINCE_CITY_MAP } from "@/lib/region-data";
import { CITY_CENTERS, getCityCenter } from "./city-centers";
import { getProvinceCenter } from "./province-centers";

const GENERATED_AT = "2024-02-01T00:00:00.000Z";

const mockConfig: SalesScreenConfig = {
  version: 1,
  enabled: true,
  modules: {
    operatingKpis: true,
    deliveryMap: true,
    collection: true,
    deliveryAlerts: true,
    deliveryMilestones: true,
  },
  multipliers: {
    amount: 5,
    customerCount: 2,
    contractCount: 3,
    shipmentCount: 4,
  },
  privacy: {
    contractNumberMode: "masked",
    addressLevel: "provinceCity",
    showDisplayNotice: true,
  },
};

function makeSource(overrides: Partial<SalesScreenSourceData> = {}): SalesScreenSourceData {
  return {
    period: { label: "month", startDate: "2024-01-01T00:00:00.000Z", endDate: "2024-02-01T00:00:00.000Z" },
    kpis: {
      totalCustomers: 0,
      periodNewCustomers: 0,
      todayFollowUp: 0,
      overdueFollowUp: 0,
      sevenDayFollowUp: 0,
      periodNewContracts: 0,
      periodShipments: 0,
      unpaidContracts: 0,
      partialPaidContracts: 0,
    },
    amounts: {
      periodContractAmount: 0,
      periodPaidAmount: 0,
      periodUnpaidAmount: 0,
      totalContractAmount: 0,
      totalPaidAmount: 0,
      totalUnpaidAmount: 0,
    },
    target: null,
    deliveryTotals: {
      shipmentCount: 0,
      unitCount: 0,
      regionCount: 0,
      todayDue: 0,
      sevenDayDue: 0,
      overdueDue: 0,
    },
    routes: [],
    reminders: { today: [], sevenDays: [], overdue: [] },
    ...overrides,
  };
}

function makeRoute(overrides: Partial<SalesScreenSourceData["routes"][number]> = {}): SalesScreenSourceData["routes"][number] {
  return {
    contractNo: "HT-2024-001",
    equipmentName: "挖掘机",
    equipmentModel: "CAT320",
    shipmentDate: "2024-01-10T00:00:00.000Z",
    shipmentStatus: "SHIPPED",
    quantity: 1,
    province: "山东省",
    city: "济南市",
    ...overrides,
  };
}

describe("transformToPublicPayload comprehensive", () => {
  describe("P1：真实 Prisma.Decimal 支持", () => {
    it("应正确处理 Prisma.Decimal 对象", () => {
      const source = makeSource({
        amounts: {
          periodContractAmount: new Prisma.Decimal("123456.78"),
          periodPaidAmount: new Prisma.Decimal("80000.50"),
          periodUnpaidAmount: new Prisma.Decimal("43456.28"),
          totalContractAmount: new Prisma.Decimal("500000.00"),
          totalPaidAmount: new Prisma.Decimal("300000.00"),
          totalUnpaidAmount: new Prisma.Decimal("200000.00"),
        },
      });

      const result = transformToPublicPayload(source, mockConfig, { generatedAt: GENERATED_AT });

      expect(result.kpis.periodContractAmount).toBe("617283.90");
      expect(result.kpis.periodPaidAmount).toBe("400002.50");
      expect(result.kpis.periodUnpaidAmount).toBe("217281.40");
      expect(result.collection.totalContractAmount).toBe("2500000.00");
      expect(result.collection.totalPaidAmount).toBe("1500000.00");
      expect(result.collection.totalUnpaidAmount).toBe("1000000.00");
    });

    it("应拒绝非数字和非 Decimal 对象", () => {
      const source = makeSource({
        amounts: {
          ...makeSource().amounts,
          periodContractAmount: "not a number",
          totalContractAmount: {} as AmountLike,
        },
      });

      const result = transformToPublicPayload(source, mockConfig, { generatedAt: GENERATED_AT });

      expect(result.kpis.periodContractAmount).toBe("0.00");
      expect(result.collection.totalContractAmount).toBe("0.00");
    });
  });

  describe("P1：合同号脱敏长度限制", () => {
    it("纯数字合同号应限制尾数显示长度", () => {
      const source = makeSource({
        reminders: {
          today: [
            {
              contractNo: "202409000123",
              equipmentName: "设备",
              equipmentModel: "M1",
              estimatedShipmentDate: "2024-01-15T00:00:00.000Z",
              province: "山东省",
              city: "济南市",
            },
          ],
          sevenDays: [],
          overdue: [],
        },
      });

      const result = transformToPublicPayload(source, mockConfig, { generatedAt: GENERATED_AT });
      const masked = result.delivery.reminders.today[0]?.contractNumber;

      expect(masked).toBe("********0123");
    });

    it("短合同号应正常脱敏", () => {
      const source = makeSource({
        reminders: {
          today: [
            {
              contractNo: "HT-123",
              equipmentName: "设备",
              equipmentModel: "M1",
              estimatedShipmentDate: "2024-01-15T00:00:00.000Z",
              province: "山东省",
              city: "济南市",
            },
          ],
          sevenDays: [],
          overdue: [],
        },
      });

      const result = transformToPublicPayload(source, mockConfig, { generatedAt: GENERATED_AT });
      const masked = result.delivery.reminders.today[0]?.contractNumber;

      // HT-123 末尾数字是 123（3 位），应全部显示
      expect(masked).toBe("***123");
    });
  });

  describe("P2：数据源一致性守卫", () => {
    it("坐标表必须与 region-data 标准省市名单对齐，防止两份名单漂移", () => {
      for (const [province, cities] of Object.entries(CITY_CENTERS)) {
        expect(PROVINCE_CITY_MAP[province], `省份 ${province} 必须存在于标准名单`).toBeDefined();
        for (const city of Object.keys(cities)) {
          expect(
            PROVINCE_CITY_MAP[province].includes(city),
            `城市 ${province}/${city} 必须存在于标准名单`
          ).toBe(true);
        }
      }
    });

    it("P1：坐标查询必须只识别自有属性，拒绝原型链键", () => {
      expect(getProvinceCenter("toString")).toBeNull();
      expect(getProvinceCenter("constructor")).toBeNull();
      expect(getProvinceCenter("__proto__")).toBeNull();
      expect(getProvinceCenter("valueOf")).toBeNull();

      expect(() => getCityCenter("constructor", "name")).not.toThrow();
      expect(getCityCenter("constructor", "name")).toBeNull();
      expect(getCityCenter("山东省", "toString")).toBeNull();
      expect(getCityCenter("山东省", "__proto__")).toBeNull();
    });

    it("P2：省份键必须先做自有属性校验，原型污染不得伪造坐标", () => {
      const proto = Object.prototype as unknown as Record<string, unknown>;
      proto.evilProvince = { evilCity: { lat: 1, lng: 2 } };
      proto.evilProvince2 = { lat: 3, lng: 4 };
      try {
        expect(getCityCenter("evilProvince", "evilCity")).toBeNull();
        expect(getProvinceCenter("evilProvince2")).toBeNull();
      } finally {
        delete proto.evilProvince;
        delete proto.evilProvince2;
      }
    });

    it("坐标必须是对象自身的有限数值且位于合法经纬度范围", () => {
      const cities = CITY_CENTERS["山东省"];
      const original = cities["济南市"];

      try {
        cities["济南市"] = Object.create({ lat: 36.65, lng: 117.12 }) as {
          lat: number;
          lng: number;
        };
        expect(getCityCenter("山东省", "济南市")).toBeNull();

        cities["济南市"] = { lat: Number.NaN, lng: Number.POSITIVE_INFINITY };
        expect(getCityCenter("山东省", "济南市")).toBeNull();

        cities["济南市"] = { lat: 91, lng: 181 };
        expect(getCityCenter("山东省", "济南市")).toBeNull();
      } finally {
        cities["济南市"] = original;
      }
    });
  });

  describe("地图中心点与汇总", () => {
    it("provinceCity 模式使用城市级中心点并回退省级中心", () => {
      const source = makeSource({
        deliveryTotals: { shipmentCount: 0, unitCount: 0, regionCount: 2, todayDue: 0, sevenDayDue: 0, overdueDue: 0 },
        routes: [
          makeRoute({ province: "山东省", city: "青岛市", quantity: 5 }),
          makeRoute({ contractNo: "HT-2024-002", province: "河北省", city: "石家庄市", quantity: 3 }),
          makeRoute({ contractNo: "HT-2024-003", province: "山东省", city: "济南市", quantity: 2 }),
        ],
      });

      const result = transformToPublicPayload(source, mockConfig, { generatedAt: GENERATED_AT });

      // 青岛市级中心
      expect(result.delivery.routes[0]?.centerLat).toBeCloseTo(36.07, 1);
      expect(result.delivery.routes[0]?.centerLng).toBeCloseTo(120.38, 1);
      // 石家庄市级中心（不是河北省中心 38.04/114.51 附近的省中心）
      expect(result.delivery.routes[1]?.centerLat).toBeCloseTo(38.04, 1);
      expect(result.delivery.routes[1]?.centerLng).toBeCloseTo(114.51, 1);

      // 汇总来自显式全量字段，与样本无关
      expect(result.delivery.summary.regionCount).toBe(2);
    });

    it("应生成发货里程碑样本", () => {
      const source = makeSource({
        routes: [
          makeRoute({
            contractNo: "HT-2024-001",
            shipmentDate: "2024-01-15T00:00:00.000Z",
            shipmentStatus: "SHIPPED",
            quantity: 5,
          }),
          makeRoute({
            contractNo: "HT-2024-002",
            equipmentName: "装载机",
            equipmentModel: "LG936",
            shipmentDate: "2024-01-20T00:00:00.000Z",
            shipmentStatus: "SHIPPED",
            quantity: 3,
          }),
        ],
      });

      const result = transformToPublicPayload(source, mockConfig, { generatedAt: GENERATED_AT });

      expect(result.delivery.milestones.length).toBe(2);

      const milestone = result.delivery.milestones[0];
      expect(milestone.key).toMatch(/^[0-9a-f-]{36}$/i);
      expect(milestone.equipmentName).toBe("挖掘机");
      expect(milestone.shipmentDate).toBe("2024-01-15T00:00:00.000Z");
      expect(milestone.unitCount).toBe(20); // 5 × 发货倍率 4
      expect(milestone.contractNumber).toMatch(/^\*+\d+$/);
    });
  });
});

type AmountLike = SalesScreenSourceData["amounts"]["totalContractAmount"];
