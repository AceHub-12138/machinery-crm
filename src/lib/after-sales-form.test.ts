import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adjustServiceAmount,
  filterAfterSalesPartOptions,
  normalizeServiceAmountInput,
  scheduleAfterSalesContractSearch,
} from "./after-sales-form";

describe("售后合同搜索", () => {
  afterEach(() => vi.useRealTimers());

  it("在最后一次输入后等待约 300ms 再执行搜索", () => {
    vi.useFakeTimers();
    const search = vi.fn();
    const firstTimer = scheduleAfterSalesContractSearch(search);
    clearTimeout(firstTimer);
    scheduleAfterSalesContractSearch(search);

    vi.advanceTimersByTime(299);
    expect(search).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(search).toHaveBeenCalledTimes(1);
  });
});

describe("售后表单金额与配件输入", () => {
  it("将手输金额限制为最多一位小数，且步进始终增减 1", () => {
    expect(normalizeServiceAmountInput("11233.04")).toBe("11233.0");
    expect(normalizeServiceAmountInput("12.34.5")).toBe("12.3");
    expect(adjustServiceAmount("12.5", 1)).toBe("13.5");
    expect(adjustServiceAmount("0", -1)).toBe("0");
  });

  it("按当前合同配件名称本地筛选，并保留无匹配时可手输的能力", () => {
    expect(filterAfterSalesPartOptions(["丝杠", "主轴轴承", "冷却泵"], "轴")).toEqual(["主轴轴承"]);
    expect(filterAfterSalesPartOptions(["丝杠"], "现场新件")).toEqual([]);
  });
});
