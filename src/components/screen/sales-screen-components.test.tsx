import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { KpiRail } from "./KpiRail";
import { TargetRing } from "./TargetRing";
import { ReminderRail } from "./ReminderRail";
import { DeliveryMilestones } from "./DeliveryMilestones";
import { ShipmentMap } from "./ShipmentMap";
import { HeaderBar } from "./HeaderBar";
import { SalesScreenBoard } from "./SalesScreenBoard";
import { computeMapViewport } from "./geo";
import {
  buildPublicSalesScreenPayloadFixture,
} from "@/modules/screen/sales-screen-payload.fixture";

const fixture = buildPublicSalesScreenPayloadFixture();

/** 面板头标题是否出现在渲染输出中 */
function hasTitle(html: string, title: string) {
  return html.includes(title);
}

describe("migrated panels render from the public payload only", () => {
  it("KpiRail shows the primary contract amount, target gauge and attention counts", () => {
    const html = renderToStaticMarkup(
      <KpiRail kpis={fixture.kpis} collection={fixture.collection} deliverySummary={fixture.delivery.summary} />,
    );
    expect(hasTitle(html, "经营指标")).toBe(true);
    // 主读数：本期合同额 ¥5,164.0万，带 money 防折行类
    expect(html).toContain("¥5,164.0万");
    expect(html).toContain("money");
    expect(html).toContain("月度目标");
    expect(html).toContain("达成 86.1%");
    // 预警计数来自显式 summary，不是数组长度
    expect(html).toContain("逾期发货");
    expect(html).toContain("待发 17");
  });

  it("TargetRing uses the server-computed collection rate for both dial and digits", () => {
    const html = renderToStaticMarkup(
      <TargetRing collection={fixture.collection} periodLabel={fixture.period.label} />,
    );
    expect(hasTitle(html, "合同与回款")).toBe(true);
    expect(html).toContain("63.8");
    expect(html).toContain("累计回款率 63.8%");
    // 环外金额：已收 / 未收 / 累计合同
    expect(html).toContain("¥8,204.0万");
    expect(html).toContain("¥4,656.0万");
    expect(html).toContain("¥1.29亿");
    expect(html).toContain("ring-box");
  });

  it("ReminderRail falls back to province when the contract number is hidden", () => {
    const html = renderToStaticMarkup(
      <ReminderRail summary={fixture.delivery.summary} reminders={fixture.delivery.reminders} />,
    );
    expect(hasTitle(html, "交付预警")).toBe(true);
    // 组头计数是显式汇总
    expect(html).toContain("逾期未发");
    expect(html).toContain("今日应发");
    expect(html).toContain("7 日内待发");
    // 合同号存在时显示遮掩号
    expect(html).toContain("****1036");
    // hidden 模式（null）回退省市，不显示空占位
    expect(html).toContain("河南省");
  });

  it("DeliveryMilestones keeps summary stats outside the sample list", () => {
    const html = renderToStaticMarkup(
      <DeliveryMilestones milestones={fixture.delivery.milestones} summary={fixture.delivery.summary} />,
    );
    expect(hasTitle(html, "交付里程碑")).toBe(true);
    // 左栏统计来自显式汇总：86 单 · 132 台 / 9 大区
    expect(html).toContain("86 单 · 132 台");
    expect(html).toContain("9 大区");
    // 卡片只列样本并显示遮掩合同号
    expect(html).toContain("数控龙门加工中心");
    expect(html).toContain("2 台");
  });

  it("ShipmentMap projects public province/city centers and titles from the summary", () => {
    const html = renderToStaticMarkup(
      <ShipmentMap
        routes={fixture.delivery.routes}
        summary={fixture.delivery.summary}
        mapBox={{ width: 880, height: 838 }}
      />,
    );
    expect(hasTitle(html, "全国交付态势")).toBe(true);
    // 标题栏三个数字全部来自显式汇总
    expect(html).toContain("交付路线");
    expect(html).toContain("覆盖省份");
    expect(html).toContain("交付台数");
    // 航线与节点：投影后的样本终点
    expect(html).toContain("map-flow");
    expect(html).toContain("省级排行");
    expect(html).toContain("山东");
  });

  it("ShipmentMap adapts its viewport to a widened panel", () => {
    const narrow = computeMapViewport(878, 836);
    const wide = computeMapViewport(1890, 962);
    expect(wide.width).toBeGreaterThan(narrow.width);
    // 画布始终在视口内
    expect(wide.left).toBeGreaterThanOrEqual(0);
    expect(wide.left + wide.width).toBeLessThanOrEqual(1890);
  });

  it("HeaderBar renders the period label and a placeholder clock on the server", () => {
    const html = renderToStaticMarkup(<HeaderBar periodLabel={fixture.period.label} />);
    expect(html).toContain("经营指挥舱");
    expect(html).toContain("2026年9月");
    expect(html).toContain("--:--:--");
  });

  it("empty sample lists render an explicit empty state instead of a hole", () => {
    const empty = buildPublicSalesScreenPayloadFixture({
      delivery: {
        ...fixture.delivery,
        milestones: [],
        reminders: { today: [], sevenDays: [], overdue: [] },
      },
    });
    const milestonesHtml = renderToStaticMarkup(
      <DeliveryMilestones milestones={empty.delivery.milestones} summary={empty.delivery.summary} />,
    );
    expect(milestonesHtml).toContain("暂无交付记录");
    const remindersHtml = renderToStaticMarkup(
      <ReminderRail summary={empty.delivery.summary} reminders={empty.delivery.reminders} />,
    );
    expect(remindersHtml).toContain("暂无数据");
  });
});

describe("sales screen board shell", () => {
  const MODULE_TITLES: Array<[keyof typeof fixture.modules, string]> = [
    ["operatingKpis", "经营指标"],
    ["deliveryMap", "全国交付态势"],
    ["collection", "合同与回款"],
    ["deliveryAlerts", "交付预警"],
    ["deliveryMilestones", "交付里程碑"],
  ];

  it("marks kiosk mode on the screen root only — never on the platform html/body", () => {
    const kioskHtml = renderToStaticMarkup(
      <SalesScreenBoard initialPayload={fixture} publicId={"x".repeat(43)} kiosk />,
    );
    expect(kioskHtml).toContain('data-kiosk="1"');
    expect(kioskHtml.startsWith("<div")).toBe(true);

    const normalHtml = renderToStaticMarkup(
      <SalesScreenBoard initialPayload={fixture} publicId={"x".repeat(43)} />,
    );
    expect(normalHtml).not.toContain("data-kiosk");
  });

  it("never mutates the platform html/body from screen code", () => {
    const source = readFileSync(path.join(import.meta.dirname, "SalesScreenBoard.tsx"), "utf8");
    expect(source).not.toContain("documentElement.classList");
    expect(source).not.toContain("document.body.classList");
  });

  it("renders the stage frame at the 1920×1080 base canvas on the server", () => {
    const html = renderToStaticMarkup(
      <SalesScreenBoard initialPayload={fixture} publicId={"x".repeat(43)} />,
    );
    // 基准画布尺寸来自样式类，缩放由客户端按视口计算 —— SSR 不含内联缩放
    expect(html).toContain("screen-frame");
    expect(html).toContain("screen-stage");
    expect(html).not.toContain("transform:scale");
  });

  it("renders exactly the enabled modules for all 31 legal combinations — disabled ones leave no DOM", () => {
    const ids = MODULE_TITLES.map(([id]) => id);
    for (let mask = 1; mask < 32; mask += 1) {
      const enabled = ids.filter((_, index) => (mask & (1 << index)) !== 0);
      const modules = {
        operatingKpis: enabled.includes("operatingKpis"),
        deliveryMap: enabled.includes("deliveryMap"),
        collection: enabled.includes("collection"),
        deliveryAlerts: enabled.includes("deliveryAlerts"),
        deliveryMilestones: enabled.includes("deliveryMilestones"),
      };
      const combo = buildPublicSalesScreenPayloadFixture({ modules });
      const html = renderToStaticMarkup(
        <SalesScreenBoard initialPayload={combo} publicId={"x".repeat(43)} />,
      );
      for (const [id, title] of MODULE_TITLES) {
        if (enabled.includes(id)) {
          expect(html.includes(title), `${mask}: ${title} 应可见`).toBe(true);
        } else {
          // 关闭的模块不得继续渲染在 DOM 中（不是 display:none 隐藏）
          expect(html.includes(title), `${mask}: ${title} 应彻底移除`).toBe(false);
        }
      }
    }
  });

  it("shows the restrained demo notice when displayNotice is on and hides it entirely when off", () => {
    const withNotice = renderToStaticMarkup(
      <SalesScreenBoard initialPayload={fixture} publicId={"x".repeat(43)} />,
    );
    expect(withNotice).toContain("展厅演示数据，仅供展示");

    const withoutNotice = renderToStaticMarkup(
      <SalesScreenBoard
        initialPayload={buildPublicSalesScreenPayloadFixture({ displayNotice: false })}
        publicId={"x".repeat(43)}
      />,
    );
    expect(withoutNotice).not.toContain("展厅演示数据，仅供展示");
    expect(withoutNotice).toContain("LIVE");
    // 无论如何都不显示倍率值或「已放大几倍」之类的表述
    expect(withNotice).not.toMatch(/倍|放大/);
  });
});
