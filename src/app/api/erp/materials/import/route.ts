import { readBoundedBody } from "@/lib/bounded-request";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { MAX_IMPORT_BYTES, MAX_IMPORT_CELLS, MAX_IMPORT_ROWS, parseMaterialWorkbook } from "@/lib/material-import";
import { prisma } from "@/lib/db";
import { getSessionUser, canManageMaterialMaster } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";

type ImportStatus = "CREATE" | "UPDATE" | "MISSING_CODE" | "ERROR";

type CategoryNode = {
  id: string;
  name: string;
  code?: string | null;
  children?: CategoryNode[];
};

type ParsedMaterialRow = {
  rowNumber: number;
  code: string;
  name: string;
  categoryText: string;
  categoryId: string;
  categoryName: string;
  spec: string;
  materialType: string;
  unit: string;
  standardPrice: string;
  safetyStock: string;
  remark: string;
  isActive: boolean;
};

type PreviewRow = ParsedMaterialRow & {
  status: ImportStatus;
  actionLabel: string;
  error: string;
  existingMaterialId: string;
  suggestedMatches: Array<{
    id: string;
    code: string;
    name: string;
    categoryName: string;
    spec: string;
    materialType: string;
    unit: string;
  }>;
};

type Resolution = {
  action?: "UPDATE_EXISTING" | "AUTO_CODE_CREATE" | "SKIP";
  materialId?: string;
  categoryId?: string;
};

const HEADER_ALIASES = {
  code: ["物料编号/图号", "物料编号", "图号", "物料编码", "编码", "code", "drawingno"],
  name: ["物料名称", "名称", "name"],
  categoryText: ["物料分类", "分类", "分类编码", "category", "categorycode"],
  spec: ["规格型号", "规格", "型号", "spec", "model"],
  materialType: ["材质", "材料", "物料类型", "material", "materialtype"],
  unit: ["单位", "unit"],
  standardPrice: ["标准单价", "标准价", "单价", "standardprice", "price"],
  safetyStock: ["安全库存", "安全库存数量", "safetystock"],
  remark: ["备注", "remark"],
  isActive: ["是否启用", "启用", "isactive"],
} as const;

const CATEGORY_PREFIX_FALLBACKS: Array<[RegExp, string]> = [
  [/机身|床身|底座/, "JSCJ"],
  [/工作台/, "GZTJ"],
  [/立柱/, "LZCJ"],
  [/电气|电器|电控/, "DHQJ"],
  [/标准件|标件/, "BZJ"],
  [/外购/, "WGJ"],
  [/铸件/, "ZJ"],
  [/机加|加工/, "JJJ"],
];

function normalizeHeader(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[()（）/_-]/g, "")
    .toLowerCase();
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function nullableText(value: string) {
  return value.trim() ? value.trim() : null;
}

function parseDecimal(value: string, fieldName: string, errors: string[]) {
  if (!value.trim()) return null;
  const next = Number(value);
  if (!Number.isFinite(next) || next < 0) {
    errors.push(`${fieldName}必须是大于等于 0 的数字`);
    return null;
  }
  return next;
}

function parseActive(value: string) {
  const next = value.trim().toLowerCase();
  if (!next) return true;
  return !["否", "不启用", "停用", "false", "0", "no", "n"].includes(next);
}

function flattenCategories(categories: CategoryNode[]) {
  const result: CategoryNode[] = [];
  const walk = (nodes: CategoryNode[]) => {
    for (const node of nodes) {
      result.push(node);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(categories);
  return result;
}

function findCategory(categoryText: string, categories: CategoryNode[]) {
  const target = categoryText.trim();
  if (!target) return null;
  const normalized = target.toLowerCase();
  return (
    categories.find((category) => category.id === target) ||
    categories.find((category) => category.code && category.code.toLowerCase() === normalized) ||
    categories.find((category) => category.name === target) ||
    categories.find((category) => `${category.code || ""} ${category.name}`.trim() === target) ||
    null
  );
}

function materialKey(row: Pick<ParsedMaterialRow, "name" | "categoryId" | "spec" | "materialType" | "unit">) {
  return [row.name, row.categoryId, row.spec, row.materialType, row.unit || "件"]
    .map((value) => value.trim().toLowerCase())
    .join("|");
}

function materialData(row: ParsedMaterialRow, options: { includeCode: boolean }) {
  const data: any = {
    name: row.name,
    categoryId: row.categoryId,
    spec: nullableText(row.spec),
    materialType: nullableText(row.materialType),
    unit: row.unit || "件",
    standardPrice: row.standardPrice === "" ? null : Number(row.standardPrice),
    safetyStock: row.safetyStock === "" ? null : Number(row.safetyStock),
    remark: nullableText(row.remark),
    isActive: row.isActive,
  };

  if (options.includeCode) {
    data.code = row.code;
    data.drawingNo = row.code;
  }

  return data;
}

/** 新增/更新落库：同编码物料此前只是软删除时复活该记录（保留历史，按 Excel 行覆盖信息）。 */
async function reviveDeletedOrCreate(
  tx: Prisma.TransactionClient,
  row: PreviewRow,
  result: { created: number; revived: number }
) {
  const deletedHolder = row.code
    ? await tx.material.findFirst({
        where: { code: row.code, deletedAt: { not: null } },
        select: { id: true },
      })
    : null;
  if (deletedHolder) {
    await tx.material.update({
      where: { id: deletedHolder.id },
      data: { ...materialData(row, { includeCode: true }), deletedAt: null },
    });
    result.revived++;
    result.created++;
    return;
  }
  await tx.material.create({ data: materialData(row, { includeCode: true }) });
  result.created++;
}

function sanitizePrefix(value: unknown) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
}

function prefixForCategory(category: CategoryNode) {
  const codePrefix = sanitizePrefix(category.code);
  if (codePrefix) return codePrefix;
  for (const [pattern, prefix] of CATEGORY_PREFIX_FALLBACKS) {
    if (pattern.test(category.name)) return prefix;
  }
  return "WL";
}

async function nextMaterialCode(
  tx: Prisma.TransactionClient,
  category: CategoryNode,
  reservedCodes: Set<string>
) {
  const prefix = prefixForCategory(category);
  const prefixWithDash = `${prefix}-`;
  const existing = await tx.material.findMany({
    where: { categoryId: category.id, code: { startsWith: prefixWithDash } },
    select: { code: true },
  });

  let max = 0;
  for (const material of existing) {
    const suffix = material.code.slice(prefixWithDash.length);
    if (/^\d+$/.test(suffix)) {
      max = Math.max(max, Number(suffix));
    }
  }
  for (const code of reservedCodes) {
    if (!code.startsWith(prefixWithDash)) continue;
    const suffix = code.slice(prefixWithDash.length);
    if (/^\d+$/.test(suffix)) {
      max = Math.max(max, Number(suffix));
    }
  }

  let next = max + 1;
  while (true) {
    const code = `${prefix}-${String(next).padStart(4, "0")}`;
    const conflict = reservedCodes.has(code) || await tx.material.findUnique({ where: { code }, select: { id: true } });
    if (!conflict) {
      reservedCodes.add(code);
      return code;
    }
    next++;
  }
}

function rowValue(row: Record<string, unknown>, aliases: readonly string[]) {
  const byNormalizedHeader = new Map(
    Object.entries(row).map(([key, value]) => [normalizeHeader(key), value])
  );
  for (const alias of aliases) {
    const value = byNormalizedHeader.get(normalizeHeader(alias));
    if (value !== undefined) return text(value);
  }
  return "";
}

async function buildPreviewRows(rawRows: Record<string, unknown>[]) {
  const categoryTree = await prisma.materialCategory.findMany({
    include: { children: { include: { children: true } } },
    where: { parentId: null },
    orderBy: { sortOrder: "asc" },
  });
  const categories = flattenCategories(categoryTree as CategoryNode[]);
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const codes = [...new Set(rawRows.map((row) => rowValue(row, HEADER_ALIASES.code)).filter(Boolean))];
  const names = [...new Set(rawRows.map((row) => rowValue(row, HEADER_ALIASES.name)).filter(Boolean))];
  const materials = await prisma.material.findMany({
    where: { deletedAt: null, OR: [
      { code: { in: codes } }, { drawingNo: { in: codes } }, { name: { in: names } },
    ] },
    include: { category: { select: { id: true, name: true, code: true } } },
  });
  const materialsByCode = new Map<string, (typeof materials)[number]>();
  const materialsByComposite = new Map<string, typeof materials>();
  for (const material of materials) {
    materialsByCode.set(material.code.trim().toLowerCase(), material);
    if (material.drawingNo) materialsByCode.set(material.drawingNo.trim().toLowerCase(), material);
    const key = materialKey({
      name: material.name || "",
      categoryId: material.categoryId,
      spec: material.spec || "",
      materialType: material.materialType || "",
      unit: material.unit || "件",
    });
    materialsByComposite.set(key, [...(materialsByComposite.get(key) || []), material]);
  }

  const seenCodes = new Set<string>();
  const rows: PreviewRow[] = [];
  for (let index = 0; index < rawRows.length; index++) {
    const raw = rawRows[index];
    const errors: string[] = [];
    const code = rowValue(raw, HEADER_ALIASES.code);
    const name = rowValue(raw, HEADER_ALIASES.name);
    const categoryText = rowValue(raw, HEADER_ALIASES.categoryText);
    const category = findCategory(categoryText, categories);
    const spec = rowValue(raw, HEADER_ALIASES.spec);
    const materialType = rowValue(raw, HEADER_ALIASES.materialType);
    const unit = rowValue(raw, HEADER_ALIASES.unit) || "件";
    const standardPriceRaw = rowValue(raw, HEADER_ALIASES.standardPrice);
    const safetyStockRaw = rowValue(raw, HEADER_ALIASES.safetyStock);
    const remark = rowValue(raw, HEADER_ALIASES.remark);
    const isActive = parseActive(rowValue(raw, HEADER_ALIASES.isActive));

    if (!name) errors.push("缺少物料名称");
    if (!categoryText) errors.push("缺少物料分类");
    if (categoryText && !category) errors.push(`物料分类 "${categoryText}" 不存在`);
    const standardPrice = parseDecimal(standardPriceRaw, "标准单价", errors);
    const safetyStock = parseDecimal(safetyStockRaw, "安全库存", errors);
    if (code && seenCodes.has(code.toLowerCase())) {
      errors.push(`导入文件内物料编号/图号 "${code}" 重复`);
    }
    if (code) seenCodes.add(code.toLowerCase());

    const parsed: ParsedMaterialRow = {
      rowNumber: index + 2,
      code,
      name,
      categoryText,
      categoryId: category?.id || "",
      categoryName: category?.name || "",
      spec,
      materialType,
      unit,
      standardPrice: standardPrice === null ? "" : String(standardPrice),
      safetyStock: safetyStock === null ? "" : String(safetyStock),
      remark,
      isActive,
    };

    let status: ImportStatus = "CREATE";
    let actionLabel = "新增物料";
    let existingMaterialId = "";
    let suggestedMatches: PreviewRow["suggestedMatches"] = [];

    if (errors.length > 0) {
      status = "ERROR";
      actionLabel = "错误";
    } else if (!code) {
      status = "MISSING_CODE";
      actionLabel = "缺少图号/编号，待处理";
      const matches = materialsByComposite.get(materialKey(parsed)) || [];
      suggestedMatches = matches.map((material) => ({
        id: material.id,
        code: material.code,
        name: material.name,
        categoryName: material.category?.name || categoryById.get(material.categoryId)?.name || "",
        spec: material.spec || "",
        materialType: material.materialType || "",
        unit: material.unit || "件",
      }));
    } else {
      const existing = materialsByCode.get(code.toLowerCase());
      if (existing) {
        status = "UPDATE";
        actionLabel = "更新已有物料";
        existingMaterialId = existing.id;
      }
    }

    rows.push({
      ...parsed,
      status,
      actionLabel,
      error: errors.join("；"),
      existingMaterialId,
      suggestedMatches,
    });
  }

  return rows;
}

function summarize(rows: PreviewRow[]) {
  return {
    create: rows.filter((row) => row.status === "CREATE").length,
    update: rows.filter((row) => row.status === "UPDATE").length,
    missingCode: rows.filter((row) => row.status === "MISSING_CODE").length,
    error: rows.filter((row) => row.status === "ERROR").length,
    total: rows.length,
  };
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!canManageMaterialMaster(user)) {
    return NextResponse.json({ error: "无权限导入物料" }, { status: 403 });
  }

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    let formData: FormData;
    try {
      const bytes = await readBoundedBody(request, MAX_IMPORT_BYTES + 128 * 1024);
      formData = await new Response(bytes, { headers: { "content-type": contentType } }).formData();
    } catch {
      return NextResponse.json({ error: "上传内容无效或超过 5MB 限制" }, { status: 400 });
    }
    const intent = String(formData.get("intent") || "preview");
    if (intent !== "preview") {
      return NextResponse.json({ error: "不支持的导入操作" }, { status: 400 });
    }
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传 Excel 文件" }, { status: 400 });
    }

    let rawRows: Record<string, unknown>[];
    try {
      rawRows = await parseMaterialWorkbook(file);
    } catch {
      return NextResponse.json({ error: "Excel 格式无效或超过限制：文件 5MB、解压 40MB、5000 行、50000 个单元格" }, { status: 400 });
    }
    if (rawRows.length === 0) {
      return NextResponse.json({ error: "Excel 中没有可导入的数据" }, { status: 400 });
    }
    const rows = await buildPreviewRows(rawRows);
    return NextResponse.json({ rows, summary: summarize(rows) });
  }

  let body;
  try {
    body = JSON.parse((await readBoundedBody(request, MAX_IMPORT_BYTES)).toString("utf8"));
  } catch {
    return NextResponse.json({ error: "导入请求无效或超过 5MB 限制" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "导入请求格式无效" }, { status: 400 });
  }
  if (Array.isArray(body.rows) && (body.rows.some((row: unknown) => !row || typeof row !== "object" || Array.isArray(row))
    || body.rows.reduce((count: number, row: Record<string, unknown>) => count + Object.keys(row).length, 0) > MAX_IMPORT_CELLS)) {
    return NextResponse.json({ error: "导入行格式无效或超过 50000 个单元格" }, { status: 400 });
  }
  if (body.intent === "preview") {
    if (!Array.isArray(body.rows) || body.rows.length > MAX_IMPORT_ROWS) {
      return NextResponse.json({ error: "预览数据必须是数组且不能超过 5000 行" }, { status: 400 });
    }
    const rows = await buildPreviewRows(body.rows);
    return NextResponse.json({ rows, summary: summarize(rows) });
  }

  if (body.intent !== "confirm") {
    return NextResponse.json({ error: "不支持的导入操作" }, { status: 400 });
  }

  const rows = Array.isArray(body.rows) ? body.rows as PreviewRow[] : [];
  if (rows.length > MAX_IMPORT_ROWS) {
    return NextResponse.json({ error: "单次导入不能超过 5000 行" }, { status: 400 });
  }
  const resolutions = (body.resolutions || {}) as Record<string, Resolution>;
  if (rows.length === 0) {
    return NextResponse.json({ error: "导入数据不能为空" }, { status: 400 });
  }

  const categories = await prisma.materialCategory.findMany({
    include: { children: { include: { children: true } } },
    where: { parentId: null },
  });
  const categoryById = new Map(flattenCategories(categories as CategoryNode[]).map((category) => [category.id, category]));

  const result = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    revived: 0,
    errorMessages: [] as string[],
    generatedCodes: [] as Array<{ rowNumber: number; code: string }>,
  };

  const reservedCodes = new Set<string>();

  await prisma.$transaction(
    async (tx) => {
      for (const row of rows) {
        try {
          if (row.status === "ERROR") {
            result.errors++;
            result.errorMessages.push(`第${row.rowNumber}行：${row.error || "预览校验未通过"}`);
            continue;
          }

          if (row.status === "MISSING_CODE") {
            const resolution = resolutions[String(row.rowNumber)] || {};
            if (resolution.action === "SKIP") {
              result.skipped++;
              continue;
            }

            if (resolution.action === "UPDATE_EXISTING" && resolution.materialId) {
              const existing = await tx.material.findUnique({ where: { id: resolution.materialId } });
              if (!existing) {
                result.errors++;
                result.errorMessages.push(`第${row.rowNumber}行：选择的已有物料不存在`);
                continue;
              }
              await tx.material.update({
                where: { id: resolution.materialId },
                data: materialData(row, { includeCode: false }),
              });
              result.updated++;
              continue;
            }

            if (resolution.action === "AUTO_CODE_CREATE") {
              const category = categoryById.get(resolution.categoryId || row.categoryId);
              if (!category) {
                result.errors++;
                result.errorMessages.push(`第${row.rowNumber}行：必须先选择有效物料分类才能自动生成图号`);
                continue;
              }
              const code = await nextMaterialCode(tx, category, reservedCodes);
              await tx.material.create({
                data: {
                  ...materialData({ ...row, code, categoryId: category.id, categoryName: category.name }, { includeCode: true }),
                },
              });
              result.generatedCodes.push({ rowNumber: row.rowNumber, code });
              result.created++;
              continue;
            }

            result.errors++;
            result.errorMessages.push(`第${row.rowNumber}行：缺少图号/编号，请选择处理方式`);
            continue;
          }

          if (row.status === "UPDATE") {
            const existing = row.existingMaterialId
              ? await tx.material.findUnique({ where: { id: row.existingMaterialId } })
              : await tx.material.findFirst({ where: { deletedAt: null, OR: [{ code: row.code }, { drawingNo: row.code }] } });
            if (!existing) {
              await reviveDeletedOrCreate(tx, row, result);
              continue;
            }
            await tx.material.update({
              where: { id: existing.id },
              data: materialData(row, { includeCode: true }),
            });
            result.updated++;
            continue;
          }

          if (row.status === "CREATE") {
            await reviveDeletedOrCreate(tx, row, result);
          }
        } catch (error: any) {
          result.errors++;
          const message = error?.code === "P2002" ? "物料编号/图号已存在" : error?.message || "导入失败";
          result.errorMessages.push(`第${row.rowNumber}行：${message}`);
        }
      }

      await writeOperationLog(tx, {
        userId: user.id,
        action: "IMPORT_MATERIALS",
        entityType: "Material",
        entityId: `material-import-${Date.now()}`,
        afterData: {
          importedBy: user.name || user.email || user.id,
          importedAt: new Date().toISOString(),
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          errors: result.errors,
          revived: result.revived,
          generatedCodes: result.generatedCodes,
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );

  return NextResponse.json(result, { status: result.errors > 0 ? 207 : 201 });
}
