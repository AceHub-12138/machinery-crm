import { Prisma } from "@prisma/client";

export type MonthlySparePartsForecastItem = {
  materialId: string;
  quantity: Prisma.Decimal;
  needByDate: Date;
};

export function normalizeMonthlySparePartsForecast(body: Record<string, unknown>) {
  const forecastMonth = String(body.forecastMonth || "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(forecastMonth)) {
    throw new Error("请选择有效的预测月份");
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) throw new Error("请至少添加一项备件预测");

  const items: MonthlySparePartsForecastItem[] = rawItems.map((raw) => {
    const row = (raw || {}) as Record<string, unknown>;
    const materialId = String(row.materialId || "").trim();
    let quantity: Prisma.Decimal;
    try {
      quantity = new Prisma.Decimal(String(row.quantity || ""));
    } catch {
      throw new Error("备件预测数量无效");
    }
    const needByDate = new Date(String(row.needByDate || ""));
    if (!materialId || !quantity.isFinite() || !quantity.gt(0) || Number.isNaN(needByDate.getTime())) {
      throw new Error("每项备件都必须选择物料并填写大于 0 的数量和需要日期");
    }
    return { materialId, quantity: quantity.toDecimalPlaces(4), needByDate };
  });
  if (new Set(items.map((item) => item.materialId)).size !== items.length) {
    throw new Error("同一批月度备件预测中的物料不能重复，请合并数量");
  }

  return {
    forecastMonth,
    sourceLabel: `${forecastMonth} 月度生产计划备件预测`,
    remark: String(body.remark || "").trim(),
    items,
  };
}
