import { describe, expect, it } from "vitest";
import { McpToolError } from "@/lib/mcp/tools";
import {
  CALC_EXPRESSION,
  CALC_PART_WEIGHT,
  runCalculatorTool,
} from "@/lib/agent/tools/calculator";

describe("dachuan_calc_expression", () => {
  async function evaluate(expression: string) {
    return (await runCalculatorTool(CALC_EXPRESSION, { expression })) as { result: number; resultText: string };
  }

  it("四则运算与优先级", async () => {
    expect((await evaluate("1+2*3")).result).toBe(7);
    expect((await evaluate("(1+2)*3")).result).toBe(9);
    expect((await evaluate("10/4")).result).toBe(2.5);
    expect((await evaluate("10%3")).result).toBe(1);
  });

  it("乘方右结合与一元负号", async () => {
    expect((await evaluate("2^10")).result).toBe(1024);
    expect((await evaluate("2^3^2")).result).toBe(512);
    expect((await evaluate("-3+5")).result).toBe(2);
    expect((await evaluate("2*-3")).result).toBe(-6);
  });

  it("白名单函数与常量", async () => {
    expect((await evaluate("sqrt(144)")).result).toBe(12);
    expect((await evaluate("min(3,7,5)")).result).toBe(3);
    expect((await evaluate("max(3,7,5)")).result).toBe(7);
    expect((await evaluate("round(1024/7*100)/100")).result).toBe(146.29);
    expect((await evaluate("round(pi*100)/100")).result).toBe(3.14);
  });

  it("浮点噪声收敛：0.1+0.2=0.3", async () => {
    const outcome = await evaluate("0.1+0.2");
    expect(outcome.resultText).toBe("0.3");
  });

  it("拒绝注入与非法字符", async () => {
    await expect(evaluate("process.env")).rejects.toBeInstanceOf(McpToolError);
    await expect(evaluate("alert(1)")).rejects.toBeInstanceOf(McpToolError);
    await expect(evaluate("1; drop table x")).rejects.toBeInstanceOf(McpToolError);
    await expect(evaluate("eval('1')")).rejects.toBeInstanceOf(McpToolError);
  });

  it("拒绝除零与语法错误", async () => {
    await expect(evaluate("1/0")).rejects.toBeInstanceOf(McpToolError);
    await expect(evaluate("(1+2")).rejects.toBeInstanceOf(McpToolError);
    await expect(evaluate("1+2)")).rejects.toBeInstanceOf(McpToolError);
  });
});

describe("dachuan_calc_part_weight", () => {
  async function estimate(args: Record<string, unknown>) {
    return (await runCalculatorTool(CALC_PART_WEIGHT, args)) as {
      volumeCm3: number;
      unitWeightKg: number;
      totalWeightKg: number;
      densityGcm3: number;
      materialLabel: string | null;
    };
  }

  it("实心圆盘（D240×45，45钢 ≈ 15.98kg）", async () => {
    const outcome = await estimate({ shape: "solid_cylinder", diameterMm: 240, thicknessMm: 45, material: "45" });
    // V = π/4 × 240² × 45 mm³ ≈ 2035.75 cm³；×7.85 ≈ 15.981 kg
    expect(outcome.volumeCm3).toBeCloseTo(2035.75, 1);
    expect(outcome.unitWeightKg).toBeCloseTo(15.981, 2);
    expect(outcome.materialLabel).toContain("结构钢");
  });

  it("圆环/套类（外径240 内径60 厚45，HT250）", async () => {
    const outcome = await estimate({
      shape: "tube",
      diameterMm: 240,
      innerDiameterMm: 60,
      thicknessMm: 45,
      material: "HT250",
    });
    // V = π/4 × (240² − 60²) × 45 ≈ 1908.52 cm³；灰铁 7.25 ≈ 13.837 kg
    expect(outcome.volumeCm3).toBeCloseTo(1908.52, 1);
    expect(outcome.densityGcm3).toBe(7.25);
    expect(outcome.unitWeightKg).toBeCloseTo(13.837, 2);
  });

  it("矩形板料与数量", async () => {
    const outcome = await estimate({
      shape: "rect_plate",
      lengthMm: 500,
      widthMm: 300,
      thicknessMm: 20,
      material: "Q235",
      quantity: 3,
    });
    // V = 500×300×20 = 3,000,000 mm³ = 3000 cm³；×7.85 = 23.55 kg/件 ×3 = 70.65 kg
    expect(outcome.volumeCm3).toBe(3000);
    expect(outcome.unitWeightKg).toBeCloseTo(23.55, 2);
    expect(outcome.totalWeightKg).toBeCloseTo(70.65, 2);
  });

  it("方料与自定义密度", async () => {
    const outcome = await estimate({ shape: "square_bar", sideMm: 50, lengthMm: 200, densityGcm3: 2.7 });
    // V = 50²×200 = 500,000 mm³ = 500 cm³；×2.7 = 1.35 kg
    expect(outcome.unitWeightKg).toBeCloseTo(1.35, 3);
    expect(outcome.materialLabel).toBeNull();
  });

  it("材料按牌号精确优先：40Cr 不被宽泛『45』键误判", async () => {
    const outcome = await estimate({ shape: "solid_cylinder", diameterMm: 100, thicknessMm: 100, material: "40Cr" });
    expect(outcome.densityGcm3).toBe(7.85);
  });

  it("拒绝未知材料并提示可选清单", async () => {
    await expect(estimate({ shape: "solid_cylinder", diameterMm: 100, thicknessMm: 10, material: "神秘合金" }))
      .rejects.toBeInstanceOf(McpToolError);
  });

  it("拒绝缺尺寸、内径大于外径", async () => {
    await expect(estimate({ shape: "solid_cylinder", diameterMm: 100, material: "45" }))
      .rejects.toBeInstanceOf(McpToolError);
    await expect(estimate({ shape: "tube", diameterMm: 60, innerDiameterMm: 240, thicknessMm: 10, material: "45" }))
      .rejects.toBeInstanceOf(McpToolError);
  });
});
