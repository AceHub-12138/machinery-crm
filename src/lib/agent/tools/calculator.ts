import { z } from "zod/v4";
import { McpToolError } from "@/lib/mcp/tools";

/**
 * 小川内置计算工具（2026-09 一期）：表达式精确计算 / 工件毛坯重量估算。
 *
 * 背景：大模型心算不可靠（求和、百分比、体积×密度经常出错），凡是数字计算
 * 一律下到这里精确算——"让工具算数，不让模型猜数"。
 * 与知识库工具同纪律：Zod 严格校验 + 逐次审计（executor 统一做）+ 超时保护；
 * 纯本地计算、不触碰数据库、无角色限制，全员可用。
 * 表达式求值是自写的白名单解析器（词法→递归下降），绝不使用 eval。
 */

export const CALC_EXPRESSION = "dachuan_calc_expression";
export const CALC_PART_WEIGHT = "dachuan_calc_part_weight";

export type CalculatorToolDefinition = {
  name: string;
  title: string;
  description: string;
  schema: z.ZodTypeAny;
};

/* ============================== 表达式计算 ============================== */

const EXPRESSION_MAX_LENGTH = 200;

/** 白名单函数：只开放与车间计算相关、无副作用的纯函数 */
const EXPRESSION_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  min: (...args: number[]) => Math.min(...args),
  max: (...args: number[]) => Math.max(...args),
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  pow: (base: number, exponent: number) => Math.pow(base, exponent),
};

const EXPRESSION_CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

type ExpressionToken =
  | { type: "number"; value: number }
  | { type: "name"; value: string }
  | { type: "op"; value: string };

function tokenizeExpression(input: string): ExpressionToken[] {
  const tokens: ExpressionToken[] = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      let end = index;
      while (end < input.length && /[0-9.]/.test(input[end]!)) end += 1;
      const text = input.slice(index, end);
      const value = Number(text);
      if (!Number.isFinite(value) || (text.match(/\./g)?.length ?? 0) > 1) {
        throw new McpToolError("INVALID_ARGUMENT", `无法识别的数字「${text}」`);
      }
      tokens.push({ type: "number", value });
      index = end;
      continue;
    }
    if (/[a-zA-Z]/.test(char)) {
      let end = index;
      while (end < input.length && /[a-zA-Z]/.test(input[end]!)) end += 1;
      tokens.push({ type: "name", value: input.slice(index, end).toLowerCase() });
      index = end;
      continue;
    }
    if ("+-*/%^(),".includes(char)) {
      tokens.push({ type: "op", value: char });
      index += 1;
      continue;
    }
    throw new McpToolError(
      "INVALID_ARGUMENT",
      `表达式包含不允许的字符「${char}」。只支持数字、+ - * / % ^ ( ) , 和函数 ${Object.keys(EXPRESSION_FUNCTIONS).join("、")} 与常量 pi、e`,
    );
  }
  return tokens;
}

/** 递归下降求值：expr → term → power → unary → primary（^ 右结合） */
class ExpressionParser {
  private position = 0;

  constructor(private readonly tokens: ExpressionToken[]) {}

  private peek(): ExpressionToken | undefined {
    return this.tokens[this.position];
  }

  private consumeOp(value: string): boolean {
    const token = this.peek();
    if (token?.type === "op" && token.value === value) {
      this.position += 1;
      return true;
    }
    return false;
  }

  private requireOp(value: string): void {
    if (!this.consumeOp(value)) {
      throw new McpToolError("INVALID_ARGUMENT", `表达式语法错误：缺少「${value}」`);
    }
  }

  parseExpression(): number {
    let value = this.parseTerm();
    for (;;) {
      if (this.consumeOp("+")) value += this.parseTerm();
      else if (this.consumeOp("-")) value -= this.parseTerm();
      else return value;
    }
  }

  private parseTerm(): number {
    let value = this.parsePower();
    for (;;) {
      if (this.consumeOp("*")) value *= this.parsePower();
      else if (this.consumeOp("/")) value /= this.parsePower();
      else if (this.consumeOp("%")) value %= this.parsePower();
      else return value;
    }
  }

  private parsePower(): number {
    const base = this.parseUnary();
    if (this.consumeOp("^")) return Math.pow(base, this.parsePower());
    return base;
  }

  private parseUnary(): number {
    if (this.consumeOp("-")) return -this.parseUnary();
    if (this.consumeOp("+")) return this.parseUnary();
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const token = this.tokens[this.position];
    if (!token) throw new McpToolError("INVALID_ARGUMENT", "表达式不完整");
    this.position += 1;
    if (token.type === "number") return token.value;
    if (token.type === "name") {
      if (this.consumeOp("(")) {
        const args: number[] = [this.parseExpression()];
        while (this.consumeOp(",")) args.push(this.parseExpression());
        this.requireOp(")");
        const fn = EXPRESSION_FUNCTIONS[token.value];
        if (!fn) {
          throw new McpToolError(
            "INVALID_ARGUMENT",
            `不支持的函数「${token.value}」，可用：${Object.keys(EXPRESSION_FUNCTIONS).join("、")}`,
          );
        }
        return fn(...args);
      }
      const constant = EXPRESSION_CONSTANTS[token.value];
      if (constant === undefined) {
        throw new McpToolError("INVALID_ARGUMENT", `不支持的名称「${token.value}」，可用常量：pi、e`);
      }
      return constant;
    }
    if (token.value === "(") {
      const value = this.parseExpression();
      this.requireOp(")");
      return value;
    }
    throw new McpToolError("INVALID_ARGUMENT", "表达式语法错误");
  }

  /** 表达式解析完必须正好消费全部 token */
  expectEnd(): void {
    if (this.position !== this.tokens.length) {
      throw new McpToolError("INVALID_ARGUMENT", "表达式末尾有多余内容");
    }
  }
}

/** 浮点噪声收敛：0.1+0.2 → 0.3 */
function formatCalcNumber(value: number): string {
  return String(Number(value.toPrecision(12)));
}

function evaluateExpression(rawExpression: string): { expression: string; result: number; resultText: string } {
  const expression = rawExpression.trim();
  if (!expression || expression.length > EXPRESSION_MAX_LENGTH) {
    throw new McpToolError("INVALID_ARGUMENT", `表达式为空或超过 ${EXPRESSION_MAX_LENGTH} 个字符`);
  }
  const tokens = tokenizeExpression(expression);
  if (!tokens.length) throw new McpToolError("INVALID_ARGUMENT", "表达式为空");
  const parser = new ExpressionParser(tokens);
  const result = parser.parseExpression();
  parser.expectEnd();
  if (!Number.isFinite(result)) {
    throw new McpToolError("INVALID_ARGUMENT", "计算结果不是有限数（请检查除零、负数开方或超大数值）");
  }
  return { expression, result, resultText: formatCalcNumber(result) };
}

/* ============================== 毛坯重量估算 ============================== */

const SHAPE_LABELS = {
  solid_cylinder: "实心圆柱/圆盘",
  tube: "圆环/套类（空心圆柱）",
  square_bar: "方料",
  rect_plate: "矩形板料",
} as const;

type MaterialDensity = { keys: string[]; label: string; density: number };

/** 常用材料密度表（g/cm³）：具体牌号在前，宽泛关键词在后，命中即停 */
const MATERIAL_DENSITIES: readonly MaterialDensity[] = [
  { keys: ["304", "316", "06Cr19Ni10", "1Cr18Ni9", "不锈钢"], label: "不锈钢（304/316 类）", density: 7.93 },
  { keys: ["GCr15", "轴承钢"], label: "轴承钢 GCr15", density: 7.81 },
  { keys: ["42CrMo"], label: "合金结构钢 42CrMo", density: 7.85 },
  { keys: ["40Cr"], label: "合金结构钢 40Cr", density: 7.85 },
  { keys: ["20CrMnTi"], label: "合金结构钢 20CrMnTi", density: 7.85 },
  { keys: ["HT150", "HT200", "HT250", "HT300", "灰铸铁", "灰铁"], label: "灰铸铁（HT 类）", density: 7.25 },
  { keys: ["QT400", "QT450", "QT500", "QT600", "球墨铸铁", "球铁"], label: "球墨铸铁（QT 类）", density: 7.3 },
  { keys: ["Q235", "Q345"], label: "碳素结构钢（Q 系列）", density: 7.85 },
  { keys: ["6061", "6063", "2A12", "LY12", "铝合金"], label: "铝合金", density: 2.7 },
  { keys: ["H62", "H59", "H65", "黄铜"], label: "黄铜", density: 8.5 },
  { keys: ["T2", "紫铜", "纯铜"], label: "紫铜/纯铜", density: 8.9 },
  { keys: ["TC4", "钛合金"], label: "钛合金 TC4", density: 4.43 },
  { keys: ["铸钢", "ZG"], label: "铸钢", density: 7.8 },
  { keys: ["45", "40", "35", "20", "钢"], label: "碳素/合金结构钢", density: 7.85 },
];

function lookupMaterialDensity(material: string): MaterialDensity | null {
  const normalized = material.trim().toUpperCase();
  for (const entry of MATERIAL_DENSITIES) {
    if (entry.keys.some((key) => normalized.includes(key.toUpperCase()))) return entry;
  }
  return null;
}

function formatMaterialList() {
  return MATERIAL_DENSITIES.map((entry) => entry.label).join("、");
}

type PartWeightInput = {
  shape: keyof typeof SHAPE_LABELS;
  diameterMm?: number;
  innerDiameterMm?: number;
  sideMm?: number;
  lengthMm?: number;
  widthMm?: number;
  thicknessMm?: number;
  material?: string;
  densityGcm3?: number;
  quantity?: number;
};

function requireDimension(value: number | undefined, label: string): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    throw new McpToolError("INVALID_ARGUMENT", `缺少${label}尺寸，请补充后重试`);
  }
  return value;
}

/** 各形状的毛坯体积（mm³）；缺尺寸/尺寸矛盾时抛出带中文说明的错误 */
function computePartVolumeMm3(input: PartWeightInput): { volumeMm3: number; dims: Record<string, number> } {
  switch (input.shape) {
    case "solid_cylinder": {
      const diameter = requireDimension(input.diameterMm, "外径 D");
      const length = input.lengthMm ?? requireDimension(input.thicknessMm, "厚度/长度");
      return { volumeMm3: (Math.PI / 4) * diameter * diameter * length, dims: { 直径D_mm: diameter, 长度L_mm: length } };
    }
    case "tube": {
      const diameter = requireDimension(input.diameterMm, "外径 D");
      const inner = requireDimension(input.innerDiameterMm, "内径 d");
      const length = input.lengthMm ?? requireDimension(input.thicknessMm, "厚度/长度");
      if (inner >= diameter) {
        throw new McpToolError("INVALID_ARGUMENT", `内径 d（${inner}）必须小于外径 D（${diameter}）`);
      }
      return {
        volumeMm3: (Math.PI / 4) * (diameter * diameter - inner * inner) * length,
        dims: { 外径D_mm: diameter, 内径d_mm: inner, 长度L_mm: length },
      };
    }
    case "square_bar": {
      const side = requireDimension(input.sideMm, "边长 a");
      const length = input.lengthMm ?? requireDimension(input.thicknessMm, "长度");
      return { volumeMm3: side * side * length, dims: { 边长a_mm: side, 长度L_mm: length } };
    }
    case "rect_plate": {
      const length = requireDimension(input.lengthMm, "长度 L");
      const width = requireDimension(input.widthMm, "宽度 W");
      const thickness = requireDimension(input.thicknessMm, "厚度 T");
      return { volumeMm3: length * width * thickness, dims: { 长度L_mm: length, 宽度W_mm: width, 厚度T_mm: thickness } };
    }
    default:
      throw new McpToolError("INVALID_ARGUMENT", "不支持的形状");
  }
}

function roundTo(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function estimatePartWeight(input: PartWeightInput) {
  const { volumeMm3, dims } = computePartVolumeMm3(input);
  const volumeCm3 = volumeMm3 / 1000;

  let materialLabel: string | null = null;
  let density = input.densityGcm3;
  if (density === undefined) {
    if (!input.material) {
      throw new McpToolError(
        "INVALID_ARGUMENT",
        `未提供材料。请传材料牌号（如 45、40Cr、HT250、QT500、304、6061、H62、TC4）或直接给密度 densityGcm3。可识别：${formatMaterialList()}`,
      );
    }
    const matched = lookupMaterialDensity(input.material);
    if (!matched) {
      throw new McpToolError(
        "INVALID_ARGUMENT",
        `暂不认识材料「${input.material}」。可识别：${formatMaterialList()}；其他材料请直接提供密度 densityGcm3`,
      );
    }
    materialLabel = matched.label;
    density = matched.density;
  }

  const unitWeightKg = (volumeCm3 * density) / 1000;
  const quantity = input.quantity ?? 1;
  return {
    shape: input.shape,
    shapeLabel: SHAPE_LABELS[input.shape],
    inputs: dims,
    material: input.material ?? null,
    materialLabel,
    densityGcm3: density,
    volumeCm3: roundTo(volumeCm3, 2),
    unitWeightKg: roundTo(unitWeightKg, 3),
    quantity,
    totalWeightKg: roundTo(unitWeightKg * quantity, 3),
    note: "按毛坯几何计算的理论重量，未计加工余量、公差与孔槽等结构简化，仅供报价/选型参考",
  };
}

/* ============================== 工具定义与执行 ============================== */

const expressionSchema = z
  .object({
    expression: z
      .string()
      .trim()
      .min(1)
      .max(EXPRESSION_MAX_LENGTH)
      .describe("数学表达式，用纯数字与运算符书写，如：(12.5+3)*4、2^10、sqrt(240^2-60^2)、round(1024/7*100)/100"),
  })
  .strict();

const partWeightSchema = z
  .object({
    shape: z.enum(["solid_cylinder", "tube", "square_bar", "rect_plate"]).describe(
      "形状：solid_cylinder=实心圆柱/圆盘，tube=圆环/套类，square_bar=方料，rect_plate=矩形板料",
    ),
    diameterMm: z.number().positive().max(100_000).optional().describe("外径 D（mm）；solid_cylinder / tube 必填"),
    innerDiameterMm: z.number().positive().max(100_000).optional().describe("内径 d（mm）；tube 必填，须小于外径"),
    sideMm: z.number().positive().max(100_000).optional().describe("方料边长 a（mm）；square_bar 必填"),
    lengthMm: z.number().positive().max(100_000).optional().describe("长度 L（mm）；圆柱/方料的长度，板料的长边"),
    widthMm: z.number().positive().max(100_000).optional().describe("宽度 W（mm）；rect_plate 必填"),
    thicknessMm: z.number().positive().max(100_000).optional().describe("厚度 T（mm）；rect_plate 必填；圆柱/圆盘/套类的厚度也可用本字段"),
    material: z
      .string()
      .trim()
      .min(1)
      .max(30)
      .optional()
      .describe("材料牌号，如 45、40Cr、HT250、QT500、304、6061、H62、TC4；与 densityGcm3 二选一"),
    densityGcm3: z.number().positive().max(25).optional().describe("自定义密度（g/cm³）；提供时不查材料表"),
    quantity: z.number().int().min(1).max(100_000).optional().describe("数量，默认 1"),
  })
  .strict();

export const CALCULATOR_TOOL_DEFINITIONS: readonly CalculatorToolDefinition[] = [
  {
    name: CALC_EXPRESSION,
    title: "精确计算表达式",
    description:
      "精确计算数学表达式（加减乘除、乘方、括号、sqrt/abs/min/max/round/floor/ceil/pow、常量 pi/e）。任何涉及数字计算（求和、均值、百分比、换算、面积、体积）时必须调用本工具，禁止心算或估算。",
    schema: expressionSchema,
  },
  {
    name: CALC_PART_WEIGHT,
    title: "估算工件毛坯重量",
    description:
      "按几何形状与材料估算工件毛坯重量（kg）。支持实心圆柱/圆盘、圆环/套类、方料、矩形板料；材料传牌号关键词（45、40Cr、HT250、QT500、304、6061、H62、TC4 等）或直接给密度。报价、选型、运输评估需要重量时调用。",
    schema: partWeightSchema,
  },
];

export function getCalculatorToolDefinition(name: string): CalculatorToolDefinition | null {
  return CALCULATOR_TOOL_DEFINITIONS.find((definition) => definition.name === name) ?? null;
}

/** 计算工具执行入口（参数已由 executor 用 schema 校验过；这里再 parse 一次保持 runner 可独立测试） */
export async function runCalculatorTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  if (toolName === CALC_EXPRESSION) {
    const { expression } = expressionSchema.parse(args) as { expression: string };
    return evaluateExpression(expression);
  }
  if (toolName === CALC_PART_WEIGHT) {
    const parsed = partWeightSchema.parse(args) as PartWeightInput;
    return estimatePartWeight(parsed);
  }
  throw new McpToolError("TOOL_NOT_ALLOWED", `工具 ${toolName} 不在计算工具清单内`);
}
