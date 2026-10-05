import { describe, it, expect } from "vitest";
import { transformToPublicPayload } from "./display-payload";
import type { SalesScreenConfig } from "./config";
import type { SalesScreenSourceData } from "./source-data";

// 固定生成时间：转换器必须是纯函数，同一输入恒定产生同一输出
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

function transform(source: SalesScreenSourceData, config: SalesScreenConfig = mockConfig) {
  return transformToPublicPayload(source, config, { generatedAt: GENERATED_AT });
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

function makeReminder(overrides: Partial<SalesScreenSourceData["reminders"]["today"][number]> = {}): SalesScreenSourceData["reminders"]["today"][number] {
  return {
    contractNo: "HT-2024-001",
    equipmentName: "挖掘机",
    equipmentModel: "CAT320",
    estimatedShipmentDate: "2024-01-15T00:00:00.000Z",
    province: "山东省",
    city: "济南市",
    ...overrides,
  };
}

describe("transformToPublicPayload", () => {
  describe("倍率应用", () => {
    it("应对金额字段应用倍率并保持精确十进制", () => {
      const source = makeSource({
        amounts: {
          periodContractAmount: 100000.5,
          periodPaidAmount: 60000.25,
          periodUnpaidAmount: 40000.25,
          totalContractAmount: 500000.75,
          totalPaidAmount: 300000.5,
          totalUnpaidAmount: 200000.25,
        },
      });

      const result = transform(source);

      // 金额倍率为 5，结果必须是精确十进制字符串
      expect(result.kpis.periodContractAmount).toBe("500002.50");
      expect(result.kpis.periodPaidAmount).toBe("300001.25");
      expect(result.kpis.periodUnpaidAmount).toBe("200001.25");
      expect(result.collection.totalContractAmount).toBe("2500003.75");
      expect(result.collection.totalPaidAmount).toBe("1500002.50");
      expect(result.collection.totalUnpaidAmount).toBe("1000001.25");
    });

    it("应对客户数量字段应用倍率", () => {
      const source = makeSource({
        kpis: {
          totalCustomers: 100,
          periodNewCustomers: 10,
          todayFollowUp: 5,
          overdueFollowUp: 3,
          sevenDayFollowUp: 8,
          periodNewContracts: 0,
          periodShipments: 0,
          unpaidContracts: 0,
          partialPaidContracts: 0,
        },
      });

      const result = transform(source);

      // 客户倍率为 2
      expect(result.kpis.totalCustomers).toBe(200);
      expect(result.kpis.periodNewCustomers).toBe(20);
      expect(result.kpis.todayFollowUp).toBe(10);
      expect(result.kpis.overdueFollowUp).toBe(6);
      expect(result.kpis.sevenDayFollowUp).toBe(16);
    });

    it("应对合同数量字段应用倍率", () => {
      const source = makeSource({
        kpis: {
          totalCustomers: 0,
          periodNewCustomers: 0,
          todayFollowUp: 0,
          overdueFollowUp: 0,
          sevenDayFollowUp: 0,
          periodNewContracts: 5,
          periodShipments: 0,
          unpaidContracts: 3,
          partialPaidContracts: 2,
        },
      });

      const result = transform(source);

      // 合同倍率为 3
      expect(result.kpis.periodNewContracts).toBe(15);
      expect(result.kpis.unpaidContracts).toBe(9);
      expect(result.kpis.partialPaidContracts).toBe(6);
    });

    it("应对发货数量字段应用倍率", () => {
      const source = makeSource({
        kpis: { ...makeSource().kpis, periodShipments: 10 },
        deliveryTotals: { shipmentCount: 0, unitCount: 0, regionCount: 0, todayDue: 2, sevenDayDue: 5, overdueDue: 1 },
      });

      const result = transform(source);

      // 发货倍率为 4
      expect(result.kpis.periodShipments).toBe(40);
      expect(result.delivery.summary.todayDue).toBe(8);
      expect(result.delivery.summary.sevenDayDue).toBe(20);
      expect(result.delivery.summary.overdueDue).toBe(4);
    });

    it("四类倍率应彼此独立", () => {
      const config: SalesScreenConfig = {
        ...mockConfig,
        multipliers: { amount: 10, customerCount: 20, contractCount: 5, shipmentCount: 3 },
      };
      const source = makeSource({
        amounts: { ...makeSource().amounts, periodContractAmount: 100 },
        kpis: { ...makeSource().kpis, totalCustomers: 50, periodNewContracts: 10, periodShipments: 20 },
      });

      const result = transform(source, config);

      expect(result.kpis.periodContractAmount).toBe("1000.00");
      expect(result.kpis.totalCustomers).toBe(1000);
      expect(result.kpis.periodNewContracts).toBe(50);
      expect(result.kpis.periodShipments).toBe(60);
    });
  });

  describe("P1：显式全量汇总（列表是样本、汇总是总量）", () => {
    it("汇总必须来自显式全量字段，不得从路线样本推导", () => {
      const source = makeSource({
        kpis: { ...makeSource().kpis, periodShipments: 10 },
        deliveryTotals: {
          shipmentCount: 200, // 全量发货总单数
          unitCount: 100, // 全量交付总台数
          regionCount: 8, // 全量省份覆盖数
          todayDue: 2,
          sevenDayDue: 5,
          overdueDue: 1,
        },
        routes: [
          makeRoute({ quantity: 1 }),
          makeRoute({ contractNo: "HT-2024-002", province: "河北省", city: "石家庄市", quantity: 1 }),
          makeRoute({ contractNo: "HT-2024-003", province: "广东省", city: "广州市", quantity: 1 }),
        ],
      });

      const result = transform(source);

      // 发货倍率为 4：汇总来自显式字段（100×4=400），与样本台数（1+1+1=3）无关
      expect(result.delivery.summary.unitCount).toBe(400);
      // 省份覆盖数来自全量字段（8），不是样本中的 3 个省份，且不乘倍率
      expect(result.delivery.summary.regionCount).toBe(8);
      // 发货总单数是独立的全量口径（200×4=800），不是"本期发货数"（10×4=40）
      expect(result.delivery.summary.shipmentCount).toBe(800);
      expect(result.kpis.periodShipments).toBe(40);
    });

    it("全量字段异常时安全归零，不得输出 NaN 或 Infinity", () => {
      const source = makeSource({
        deliveryTotals: {
          shipmentCount: NaN,
          unitCount: -5,
          regionCount: Infinity,
          todayDue: null as unknown as number,
          sevenDayDue: 3,
          overdueDue: 1.9,
        },
      });

      const result = transform(source);
      const json = JSON.stringify(result);

      expect(result.delivery.summary.shipmentCount).toBe(0);
      expect(result.delivery.summary.unitCount).toBe(0);
      expect(result.delivery.summary.regionCount).toBe(0);
      expect(result.delivery.summary.todayDue).toBe(0);
      expect(result.delivery.summary.sevenDayDue).toBe(12);
      expect(result.delivery.summary.overdueDue).toBe(7); // 1.9 × 4 = 7.6，向下取整为 7
      expect(json).not.toContain("NaN");
      expect(json).not.toContain("Infinity");
    });

    it("有限数量乘倍率后溢出或超出安全整数范围时必须归零", () => {
      const source = makeSource({
        kpis: {
          ...makeSource().kpis,
          totalCustomers: Number.MAX_VALUE,
        },
        deliveryTotals: {
          ...makeSource().deliveryTotals,
          shipmentCount: Number.MAX_VALUE,
        },
        routes: [makeRoute({ quantity: Number.MAX_VALUE })],
      });

      const result = transform(source);

      expect(result.kpis.totalCustomers).toBe(0);
      expect(result.delivery.summary.shipmentCount).toBe(0);
      expect(result.delivery.routes[0]?.unitCount).toBe(0);
      expect(result.delivery.milestones[0]?.unitCount).toBe(0);
      expect(Number.isSafeInteger(result.kpis.totalCustomers)).toBe(true);
      expect(Number.isSafeInteger(result.delivery.summary.shipmentCount)).toBe(true);
    });
  });

  describe("P1：提醒先过滤后取样", () => {
    it("无效条目不得占用样本名额", () => {
      const source = makeSource({
        reminders: {
          today: [
            makeReminder({ estimatedShipmentDate: null as unknown as string, contractNo: "HT-INVALID-1" }),
            makeReminder({ province: "火星省", contractNo: "HT-INVALID-2", city: null }),
            makeReminder({ contractNo: "HT-2024-010" }),
            makeReminder({ contractNo: "HT-2024-011" }),
            makeReminder({ contractNo: "HT-2024-012" }),
          ],
          sevenDays: [],
          overdue: [],
        },
      });

      const result = transform(source);

      // 前两条无效（缺日期、省份非法），必须跳过并由后续有效条目补位
      expect(result.delivery.reminders.today.length).toBe(2);
      expect(result.delivery.reminders.today[0]?.contractNumber).toMatch(/010$/);
      expect(result.delivery.reminders.today[1]?.contractNumber).toMatch(/011$/);
      expect(JSON.stringify(result)).not.toContain("INVALID");
      expect(JSON.stringify(result)).not.toContain("火星省");
    });

    it("每组提醒最多 2 条有效样本", () => {
      const source = makeSource({
        reminders: {
          today: Array.from({ length: 5 }, (_, i) => makeReminder({ contractNo: `HT-2024-00${i}` })),
          sevenDays: [],
          overdue: [],
        },
      });

      const result = transform(source);

      expect(result.delivery.reminders.today.length).toBe(2);
    });
  });

  describe("P2：纯函数与确定性 key", () => {
    it("同一输入必须产生完全相同的输出（含 key 与生成时间）", () => {
      const source = makeSource({
        routes: [
          makeRoute(),
          makeRoute({ contractNo: "HT-2024-002", province: "河北省", city: "石家庄市", shipmentStatus: "SHIPPED", quantity: 3 }),
        ],
        reminders: { today: [makeReminder()], sevenDays: [], overdue: [] },
      });

      const first = transform(source);
      const second = transform(source);

      expect(second).toEqual(first);
      expect(first.generatedAt).toBe(GENERATED_AT);
    });

    it("展示 key 必须是 UUID 格式、内容不同则 key 不同", () => {
      const source = makeSource({
        routes: [
          makeRoute(),
          makeRoute({ contractNo: "HT-2024-002", province: "河北省", city: "石家庄市" }),
          makeRoute({ contractNo: "HT-2024-003", province: "广东省", city: "广州市" }),
        ],
      });

      const result = transform(source);

      const keys = result.delivery.routes.map((r) => r.key);
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      keys.forEach((key) => expect(key).toMatch(uuidPattern));
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("P1：插入其他条目不得改变既有条目的 key（不含数组位置）", () => {
      const routeA = makeRoute({ contractNo: "HT-2024-001" });
      const routeB = makeRoute({
        contractNo: "HT-2024-002",
        province: "河北省",
        city: "石家庄市",
        shipmentDate: "2024-01-11T00:00:00.000Z",
      });
      const routeC = makeRoute({
        contractNo: "HT-2024-003",
        province: "广东省",
        city: "广州市",
        shipmentDate: "2024-01-12T00:00:00.000Z",
      });

      const before = transform(makeSource({ routes: [routeA, routeB] })).delivery.routes.map((r) => r.key);
      const after = transform(makeSource({ routes: [routeC, routeA, routeB] })).delivery.routes.map((r) => r.key);

      // 前插 routeC 后，routeA 与 routeB 的 key 必须保持不变（仅列表末尾新增一个 key）
      expect(after[1]).toBe(before[0]);
      expect(after[2]).toBe(before[1]);
      expect(after.length).toBe(3);
    });

    it("P1：key 不得受合同号影响（防止无盐哈希被离线枚举）", () => {
      // 除合同号外内容完全一致的两条路线，key 必须相同
      const routeX = makeRoute({ contractNo: "202409000001" });
      const routeY = makeRoute({ contractNo: "HT-2024-999" });

      const keyX = transform(makeSource({ routes: [routeX] })).delivery.routes[0]?.key;
      const keyY = transform(makeSource({ routes: [routeY] })).delivery.routes[0]?.key;

      expect(keyX).toBe(keyY);
    });

    it("同内容条目用同内容序号保证 key 唯一", () => {
      const routeA = makeRoute();
      const keys = transform(makeSource({ routes: [routeA, { ...routeA }] })).delivery.routes.map((r) => r.key);

      expect(new Set(keys).size).toBe(2);
    });

    it("P1：原型链键省份必须被整条跳过", () => {
      const result = transform(
        makeSource({
          routes: [
            makeRoute({ province: "constructor" as unknown as string, city: null }),
            makeRoute({ province: "toString" as unknown as string, city: null }),
          ],
        })
      );

      expect(result.delivery.routes.length).toBe(0);
      const json = JSON.stringify(result);
      expect(json).not.toContain("centerLat\":\"");
      expect(json).not.toContain("undefined");
    });

    it("P1：同展示台数不得产生不同 key（key 不得编码倍率前台数）", () => {
      // 数量 3 与 3.2 在倍率 4 下展示台数都是 12，除 key 外输出必须完全一致
      const routeA = makeRoute({ contractNo: "HT-2024-001", quantity: 3 });
      const routeB = makeRoute({ contractNo: "HT-2024-002", quantity: 3.2 });

      const sampleA = transform(makeSource({ routes: [routeA] })).delivery.routes[0];
      const sampleB = transform(makeSource({ routes: [routeB] })).delivery.routes[0];

      expect(sampleA?.unitCount).toBe(12);
      expect(sampleB?.unitCount).toBe(12);
      expect(sampleB).toEqual(sampleA);
    });

    it("P1：milestone key 不得依赖未公开的省市字段", () => {
      const jinan = makeRoute({ shipmentStatus: "SHIPPED", city: "济南市" });
      const qingdao = makeRoute({ shipmentStatus: "SHIPPED", city: "青岛市" });

      // 里程碑输出不含省市：两个 payload 的里程碑（含 key）必须完全一致
      const m1 = transform(makeSource({ routes: [jinan] })).delivery.milestones[0];
      const m2 = transform(makeSource({ routes: [qingdao] })).delivery.milestones[0];

      expect(m2).toEqual(m1);
    });

    it("P1：reminder key 必须包含已公开的脱敏合同号", () => {
      const r1111 = makeReminder({ contractNo: "HT-2024-1111" });
      const r2222 = makeReminder({
        contractNo: "HT-2024-2222",
        equipmentName: "装载机",
        estimatedShipmentDate: "2024-01-16T00:00:00.000Z",
      });
      const r9999 = makeReminder({ contractNo: "HT-2024-9999" });

      // 每组上限 2 条：前 [***1111, ***2222]；后前插 [***9999, ***1111]（***2222 被挤出样本）
      const before = transform(
        makeSource({ reminders: { today: [r1111, r2222], sevenDays: [], overdue: [] } })
      ).delivery.reminders.today.map((r) => r.key);
      const after = transform(
        makeSource({ reminders: { today: [r9999, r1111], sevenDays: [], overdue: [] } })
      ).delivery.reminders.today.map((r) => r.key);

      expect(before.length).toBe(2);
      expect(after.length).toBe(2);
      // ***1111 必须保住自己的 key，而不是继承被挤出条目的序号
      expect(after[1]).toBe(before[0]);
      expect(after[0]).not.toBe(before[0]);
    });

    it("P2：字段值含分隔符不得造成 key 碰撞与换位", () => {
      // 两组不同的公开内容在 join("|") 序列化下会产生相同 base
      const r1 = makeRoute({ equipmentName: "A", equipmentModel: "B|C" });
      const r2 = makeRoute({ equipmentName: "A|B", equipmentModel: "C" });

      const before = transform(makeSource({ routes: [r1] })).delivery.routes[0]?.key;
      const after = transform(makeSource({ routes: [r2, r1] })).delivery.routes.map((r) => r.key);

      expect(after[1]).toBe(before);
      // 不同公开内容不得共享同一个 key
      expect(after[0]).not.toBe(after[1]);
    });
  });

  describe("白名单投影与深度安全扫描", () => {
    it("输入中的多余字段（含敏感字段）不得进入输出", () => {
      const source = makeSource({
        routes: [
          {
            ...makeRoute(),
            // 模拟上游构造失误夹带的身份字段：转换器必须白名单投影兜底
            id: "real-shipment-uuid-12345",
            customerName: "客户C公司",
            contactName: "张三",
            phone: "13800138000",
            receivingAddress: "广东省广州市天河区XXX路123号",
          } as SalesScreenSourceData["routes"][number],
        ],
        reminders: {
          today: [
            {
              ...makeReminder(),
              id: "real-contract-uuid-67890",
              salesUser: "业务员李四",
            } as SalesScreenSourceData["reminders"]["today"][number],
          ],
          sevenDays: [],
          overdue: [],
        },
      });

      const result = transform(source);
      const jsonString = JSON.stringify(result);

      const forbiddenPatterns = [
        "companyName", "customer", "customerName", "contactName", "phone", "email",
        "salesUser", "assignedUser", "followContent", "content", "receivingAddress",
        "fullAddress", "mapKey", "multipliers", "beforeData", "afterData",
      ];
      forbiddenPatterns.forEach((pattern) => {
        expect(jsonString).not.toContain(`"${pattern}"`);
      });
      expect(jsonString).not.toContain("real-shipment-uuid-12345");
      expect(jsonString).not.toContain("real-contract-uuid-67890");
      expect(jsonString).not.toContain("客户C公司");
      expect(jsonString).not.toContain("张三");
      expect(jsonString).not.toContain("13800138000");
      expect(jsonString).not.toContain("业务员李四");
      expect(jsonString).not.toContain("XXX路123号");
    });

    it("不得修改输入对象", () => {
      const source = makeSource({
        routes: [makeRoute({ quantity: 5 })],
        amounts: { ...makeSource().amounts, periodContractAmount: 100000 },
      });
      const snapshot = JSON.parse(JSON.stringify(source));

      transform(source);

      expect(source).toEqual(snapshot);
    });
  });

  describe("合同号脱敏", () => {
    it("masked 模式应只保留末尾识别字符", () => {
      const source = makeSource({
        reminders: { today: [makeReminder({ contractNo: "HT-2024-001" })], sevenDays: [], overdue: [] },
      });

      const result = transform(source);

      expect(result.delivery.reminders.today[0]?.contractNumber).toMatch(/^\*+\d+$/);
      expect(result.delivery.reminders.today[0]?.contractNumber).not.toBe("HT-2024-001");
      expect(JSON.stringify(result)).not.toContain("HT-2024-001");
    });

    it("hidden 模式应完全省略合同号", () => {
      const config: SalesScreenConfig = {
        ...mockConfig,
        privacy: { ...mockConfig.privacy, contractNumberMode: "hidden" },
      };
      const source = makeSource({
        reminders: { today: [makeReminder()], sevenDays: [], overdue: [] },
      });

      const result = transform(source, config);

      expect(result.delivery.reminders.today[0]?.contractNumber).toBeNull();
      expect(JSON.stringify(result)).not.toContain("HT-2024-001");
    });
  });

  describe("地址脱敏与城市校验", () => {
    it("provinceCity 模式保留省市；province 模式只保留省级", () => {
      const provinceConfig: SalesScreenConfig = {
        ...mockConfig,
        privacy: { ...mockConfig.privacy, addressLevel: "province" },
      };

      const result = transform(makeSource({ routes: [makeRoute({ province: "四川省", city: "成都市" })] }));
      expect(result.delivery.routes[0]?.province).toBe("四川省");
      expect(result.delivery.routes[0]?.city).toBe("成都市");

      const provinceOnly = transform(
        makeSource({ routes: [makeRoute({ province: "四川省", city: "成都市" })] }),
        provinceConfig
      );
      expect(provinceOnly.delivery.routes[0]?.city).toBeNull();
      expect(JSON.stringify(provinceOnly)).not.toContain("成都市");
    });

    it("非法城市必须封闭为 null，非法省份必须整条跳过", () => {
      const source = makeSource({
        routes: [
          makeRoute({ city: "历下区" as unknown as string }), // 区县不是标准地级市
          makeRoute({ contractNo: "HT-2024-002", province: "火星省", city: null }),
          makeRoute({ contractNo: "HT-2024-003", province: "国外", city: null }),
        ],
      });

      const result = transform(source);

      expect(result.delivery.routes.length).toBe(1);
      expect(result.delivery.routes[0]?.province).toBe("山东省");
      expect(result.delivery.routes[0]?.city).toBeNull();
      expect(JSON.stringify(result)).not.toContain("历下区");
      expect(JSON.stringify(result)).not.toContain("火星省");
    });
  });

  describe("地图中心点", () => {
    it("provinceCity 模式使用城市级中心点", () => {
      const result = transform(makeSource({ routes: [makeRoute({ province: "山东省", city: "青岛市" })] }));

      // 青岛市中心 (36.07, 120.38)，不是济南附近的省中心 (36.65, 117.12)
      expect(result.delivery.routes[0]?.centerLat).toBeCloseTo(36.07, 1);
      expect(result.delivery.routes[0]?.centerLng).toBeCloseTo(120.38, 1);
    });

    it("坐标表未收录的城市回退省级中心，坐标只由坐标表决定", () => {
      // 延边朝鲜族自治州是 region-data 的标准城市，但坐标表未收录
      const result = transform(
        makeSource({ routes: [makeRoute({ province: "吉林省", city: "延边朝鲜族自治州" })] })
      );

      expect(result.delivery.routes[0]?.province).toBe("吉林省");
      expect(result.delivery.routes[0]?.city).toBe("延边朝鲜族自治州");
      expect(result.delivery.routes[0]?.centerLat).toBeCloseTo(43.88, 1);
      expect(result.delivery.routes[0]?.centerLng).toBeCloseTo(125.35, 1);
    });
  });

  describe("受控样本上限", () => {
    it("路线样本最多 80 条", () => {
      const source = makeSource({
        routes: Array.from({ length: 85 }, (_, i) => makeRoute({ contractNo: `HT-2024-${String(i).padStart(3, "0")}` })),
      });

      const result = transform(source);

      expect(result.delivery.routes.length).toBe(80);
    });

    it("里程碑最多 5 条且先过滤后取样", () => {
      const source = makeSource({
        routes: [
          ...Array.from({ length: 3 }, (_, i) =>
            makeRoute({ contractNo: `HT-2024-A${i}`, shipmentStatus: "NOT_SHIPPED" })
          ),
          ...Array.from({ length: 8 }, (_, i) =>
            makeRoute({ contractNo: `HT-2024-B${i}`, shipmentStatus: "SHIPPED" })
          ),
        ],
      });

      const result = transform(source);

      expect(result.delivery.milestones.length).toBe(5);
      result.delivery.milestones.forEach((milestone) => {
        expect(milestone.shipmentStatus).toBe("SHIPPED");
        expect(milestone.unitCount).toBe(4); // quantity 1 × 发货倍率 4
      });
    });
  });

  describe("销售目标映射", () => {
    it("目标与实际同时乘相同倍率，完成率与原比例一致", () => {
      const source = makeSource({
        target: { targetAmount: "200000", actualAmount: "50000" },
      });

      const result = transform(source);

      // 金额倍率 5：20 万 → 100 万，5 万 → 25 万，完成率仍为 25%
      expect(result.collection.targetAmount).toBe("1000000.00");
      expect(result.collection.actualAmount).toBe("250000.00");
      expect(result.collection.targetRate).toBe(25);
      expect(result.collection.targetVisualRate).toBe(25);
      expect(result.collection.remainingAmount).toBe("750000.00");
      expect(result.collection.exceededAmount).toBe("0.00");
      expect(result.collection.exceeded).toBe(false);
    });

    it("超额目标应输出超额值且剩余为零", () => {
      const source = makeSource({
        target: { targetAmount: "100000", actualAmount: "120000" },
      });

      const result = transform(source);

      // 金额倍率 5：目标 50 万，实际 60 万，完成率 120%，视觉值封顶 100%
      expect(result.collection.targetAmount).toBe("500000.00");
      expect(result.collection.actualAmount).toBe("600000.00");
      expect(result.collection.targetRate).toBe(120);
      expect(result.collection.targetVisualRate).toBe(100);
      expect(result.collection.remainingAmount).toBe("0.00");
      expect(result.collection.exceededAmount).toBe("100000.00");
      expect(result.collection.exceeded).toBe(true);
    });

    it("缺失目标时应输出安全零值", () => {
      const result = transform(makeSource());

      expect(result.collection.targetAmount).toBe("0.00");
      expect(result.collection.actualAmount).toBe("0.00");
      expect(result.collection.targetRate).toBe(0);
      expect(result.collection.targetVisualRate).toBe(0);
      expect(result.collection.remainingAmount).toBe("0.00");
      expect(result.collection.exceededAmount).toBe("0.00");
      expect(result.collection.exceeded).toBe(false);
    });
  });

  describe("回款率自洽", () => {
    it("回款率必须从扩大后的展示值重新计算且与原比例一致", () => {
      const source = makeSource({
        amounts: {
          ...makeSource().amounts,
          totalContractAmount: "333333.33",
          totalPaidAmount: "111111.11",
        },
      });

      const result = transform(source);

      // 扩大后仍为 1/3 ≈ 33.3%
      expect(result.collection.totalContractAmount).toBe("1666666.65");
      expect(result.collection.totalPaidAmount).toBe("555555.55");
      expect(result.collection.collectionRate).toBeCloseTo(33.3, 1);
    });

    it("极端正向金额比例必须饱和到有限上限并保持业务语义", () => {
      const source = makeSource({
        amounts: {
          ...makeSource().amounts,
          totalContractAmount: "0.01",
          totalPaidAmount: Number.MAX_VALUE,
        },
        target: {
          targetAmount: "0.01",
          actualAmount: Number.MAX_VALUE,
        },
      });

      const result = transform(source);

      expect(result.collection.collectionRate).toBe(100);
      expect(result.collection.targetRate).toBe(Number.MAX_SAFE_INTEGER);
      expect(result.collection.targetVisualRate).toBe(100);
      expect(result.collection.exceeded).toBe(true);
      expect(Number.isFinite(result.collection.collectionRate)).toBe(true);
      expect(Number.isFinite(result.collection.targetRate)).toBe(true);
    });
  });

  describe("边界情况", () => {
    it("应处理空数据", () => {
      const result = transform(makeSource());

      expect(result.kpis.totalCustomers).toBe(0);
      expect(result.kpis.periodContractAmount).toBe("0.00");
      expect(result.collection.collectionRate).toBe(0);
      expect(result.delivery.routes.length).toBe(0);
      expect(result.delivery.milestones.length).toBe(0);
      expect(result.delivery.reminders.today.length).toBe(0);
    });

    it("应处理异常数值", () => {
      const source = makeSource({
        kpis: {
          totalCustomers: Infinity,
          periodNewCustomers: NaN,
          todayFollowUp: -5,
          overdueFollowUp: 0,
          sevenDayFollowUp: 3,
          periodNewContracts: null as unknown as number,
          periodShipments: 4,
          unpaidContracts: 1,
          partialPaidContracts: 2,
        },
        amounts: { ...makeSource().amounts, periodContractAmount: NaN },
      });

      const result = transform(source);

      expect(result.kpis.totalCustomers).toBe(0);
      expect(result.kpis.periodNewCustomers).toBe(0);
      expect(result.kpis.todayFollowUp).toBe(0);
      expect(result.kpis.periodNewContracts).toBe(0);
      expect(result.kpis.periodContractAmount).toBe("0.00");
      expect(result.kpis.periodShipments).toBe(16);

      const jsonString = JSON.stringify(result);
      expect(jsonString).not.toContain("NaN");
      expect(jsonString).not.toContain("Infinity");
    });
  });
});
