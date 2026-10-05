import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import type { McpDataSource, McpUser } from "@/lib/mcp/application";
import {
  nullishDrop,
  optionalDateFilter,
  optionalLocationFilter,
  optionalSearchFilter,
  optionalStockReferenceTypeFilter,
  optionalUuidReferenceFilter,
  requiredUuidReferenceFilter,
} from "@/lib/mcp/input-schemas";
import {
  canManageSuppliers,
  canReadMcpBomDetail,
  canRunMcpKitCheck,
  canViewERP,
  roleRequiresRegionScope,
} from "@/lib/erp-roles";

const page = z.number().int().min(1).default(1).describe("页码，从 1 开始");
const pageSize = z.number().int().min(1).max(100).default(20).describe("每页数量，最大 100");
const search = optionalSearchFilter("名称、编号或型号关键词");
const id = z.string().trim().min(1).max(100).describe("记录 ID");
const dateStart = optionalDateFilter("开始日期，YYYY-MM-DD");
const dateEnd = optionalDateFilter("结束日期，YYYY-MM-DD");
const MAX_DATE_RANGE_DAYS = 366;
const CUSTOMER_STATUS_VALUES = ["NEW_LEAD", "CONTACTED", "QUOTED", "NEGOTIATING", "WON", "LOST", "INACTIVE"] as const;
const CUSTOMER_TYPE_VALUES = ["NEW", "OLD", "AGENT", "END_USER", "DISTRIBUTOR"] as const;
const CUSTOMER_STATUS_VALUE_SET = new Set<string>(CUSTOMER_STATUS_VALUES);
const CUSTOMER_TYPE_VALUE_SET = new Set<string>(CUSTOMER_TYPE_VALUES);
const LEAD_REVIEW_STATUS_VALUES = ["PENDING", "HIGH_INTENT", "MID_INTENT", "LOW_INTENT", "INVALID"] as const;
const LEAD_SOURCE_VALUES = ["BAIDU_SEARCH", "MANUAL", "OTHER"] as const;
const customerStatus = z.preprocess(
  nullishDrop,
  z.enum(CUSTOMER_STATUS_VALUES).optional(),
).describe("客户跟进阶段。仅在用户明确询问线索、已联系、已报价、洽谈、成交、流失或不活跃客户时使用；不能用来表示某时间段新增客户。");
const customerType = z.preprocess(
  nullishDrop,
  z.enum(CUSTOMER_TYPE_VALUES).optional(),
).describe("客户分类。仅在用户明确要求按新客户、老客户、代理商、终端用户或经销商分类筛选时使用；不能用来表示某时间段新增的记录。");

function strictListInput(extra: Record<string, z.ZodTypeAny> = {}) {
  return z.object({ page, pageSize, search, dateStart, dateEnd, ...extra }).strict().superRefine((value, context) => {
    if (!value || typeof value !== "object") return;
    const filters = value as typeof value & { status?: unknown; customerType?: unknown };
    if (typeof filters.status === "string" && CUSTOMER_TYPE_VALUE_SET.has(filters.status)) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: `status 收到 ${filters.status}，这是 customerType 的值；查询某时间段新增客户时只需传日期范围，不要设置 status/customerType`,
      });
    }
    if (typeof filters.customerType === "string" && CUSTOMER_STATUS_VALUE_SET.has(filters.customerType)) {
      context.addIssue({
        code: "custom",
        path: ["customerType"],
        message: `customerType 收到 ${filters.customerType}，这是 status 的值；查询某时间段新增客户时只需传日期范围，不要设置 status/customerType`,
      });
    }
    if (Boolean(value.dateStart) !== Boolean(value.dateEnd)) {
      context.addIssue({
        code: "custom",
        path: [value.dateStart ? "dateEnd" : "dateStart"],
        message: "dateStart 和 dateEnd 必须同时提供",
      });
      return;
    }
    if (!value.dateStart || !value.dateEnd) return;
    const start = Date.parse(`${value.dateStart}T00:00:00.000Z`);
    const end = Date.parse(`${value.dateEnd}T00:00:00.000Z`);
    const rangeDays = (end - start) / 86_400_000;
    if (rangeDays < 0 || rangeDays > MAX_DATE_RANGE_DAYS) {
      context.addIssue({
        code: "custom",
        path: ["dateStart"],
        message: `日期范围必须在 0 到 ${MAX_DATE_RANGE_DAYS} 天内`,
      });
    }
  }, { when: () => true });
}

const leadListInput = z.object({
  page,
  pageSize,
  reviewStatus: z.preprocess(nullishDrop, z.enum(LEAD_REVIEW_STATUS_VALUES).optional()),
  source: z.preprocess(nullishDrop, z.enum(LEAD_SOURCE_VALUES).optional()),
  searchKeyword: optionalSearchFilter("命中关键词，最长 100 个字符"),
  aiScoreMin: z.preprocess(nullishDrop, z.number().int().min(0).max(100).optional()),
  aiScoreMax: z.preprocess(nullishDrop, z.number().int().min(0).max(100).optional()),
  dateStart,
  dateEnd,
}).strict().superRefine((value, context) => {
  if (Boolean(value.dateStart) !== Boolean(value.dateEnd)) {
    context.addIssue({
      code: "custom",
      path: [value.dateStart ? "dateEnd" : "dateStart"],
      message: "dateStart 和 dateEnd 必须同时提供",
    });
  } else if (value.dateStart && value.dateEnd) {
    const start = Date.parse(`${value.dateStart}T00:00:00.000Z`);
    const end = Date.parse(`${value.dateEnd}T00:00:00.000Z`);
    const rangeDays = (end - start) / 86_400_000;
    if (rangeDays < 0 || rangeDays > MAX_DATE_RANGE_DAYS) {
      context.addIssue({
        code: "custom",
        path: ["dateStart"],
        message: `日期范围必须在 0 到 ${MAX_DATE_RANGE_DAYS} 天内`,
      });
    }
  }
  if (value.aiScoreMin !== undefined && value.aiScoreMax !== undefined && value.aiScoreMin > value.aiScoreMax) {
    context.addIssue({
      code: "custom",
      path: ["aiScoreMin"],
      message: "aiScoreMin 不能大于 aiScoreMax",
    });
  }
}, { when: () => true });

const idInput = z.object({ id }).strict();
const leadIdInput = z.object({ id: requiredUuidReferenceFilter("线索 UUID") }).strict();
const whoAmIInput = z.object({}).strict();

export const MCP_IDENTITY_TOOL_NAME = "dachuan_identity_who_am_i";

const ALL_ROLES: McpUser["role"][] = ["SUPER_ADMIN", "SALES", "FOREIGN_TRADE", "PURCHASE", "WAREHOUSE"];
const CRM_READ_ROLES = ALL_ROLES.filter((role) => role === "SUPER_ADMIN" || roleRequiresRegionScope(role));
const ERP_VIEW_ROLES = ALL_ROLES.filter(canViewERP);
const SUPPLIER_DETAIL_ROLES = ALL_ROLES.filter(canManageSuppliers);
const BOM_DETAIL_ROLES = ALL_ROLES.filter(canReadMcpBomDetail);
const KIT_CHECK_ROLES = ALL_ROLES.filter(canRunMcpKitCheck);
const LEAD_READ_ROLES: McpUser["role"][] = ["SUPER_ADMIN"];

const toolDefinitions = [
  {
    name: "lead_list",
    allowedRoles: LEAD_READ_ROLES,
    title: "查询 AI 线索列表",
    description: "按跟进状态、来源、命中关键词、AI 评分区间和创建日期分页查询 AI 线索池。",
    schema: leadListInput,
  },
  {
    name: "lead_get",
    allowedRoles: LEAD_READ_ROLES,
    title: "查询 AI 线索详情",
    description: "按线索 UUID 查询画像、AI 评分、去重状态和不可变反馈事件。",
    schema: leadIdInput,
  },
  {
    name: "lead_stats",
    allowedRoles: LEAD_READ_ROLES,
    title: "统计 AI 线索池",
    description: "统计 AI 线索总量及跟进状态、来源和评分段分布。",
    schema: z.object({}).strict(),
  },
  {
    name: "crm_customers_list",
    allowedRoles: CRM_READ_ROLES,
    title: "查询客户列表",
    description: "查询当前用户可查看的客户记录。询问某日期范围内新增客户时，只传入日期范围，不设置客户跟进阶段或客户分类；最终回复应使用自然中文，不展示内部字段名、参数名或枚举值。",
    schema: strictListInput({
      status: customerStatus,
      customerType,
      province: optionalLocationFilter("省份全称。仅当用户明确指定省份时传入；不得填入数字占位符或 null。"),
      city: optionalLocationFilter("城市全称。仅当用户明确指定城市时传入；不得填入数字占位符或 null。"),
      assignedUserId: optionalUuidReferenceFilter("负责人 UUID。仅当用户明确指定负责人且已知其 ID 时传入。"),
    }),
  },
  { name: "crm_customer_get", allowedRoles: CRM_READ_ROLES, title: "查询客户详情", description: "查询当前用户可查看的客户详情。", schema: idInput },
  {
    name: "crm_customer_follows_list",
    allowedRoles: CRM_READ_ROLES,
    title: "查询客户跟进记录",
    description: "查询当前用户可查看的客户跟进记录。",
    schema: strictListInput({ customerId: id }),
  },
  {
    name: "crm_products_list",
    allowedRoles: CRM_READ_ROLES,
    title: "查询产品列表",
    description: "查询产品主数据和中文资料。",
    schema: strictListInput({
      productType: z.enum(["MAIN", "OPTIONAL"]).optional(),
    }),
  },
  { name: "crm_product_get", allowedRoles: CRM_READ_ROLES, title: "查询产品详情", description: "按 ID 查询产品及多语言资料。", schema: idInput },
  {
    name: "crm_contracts_list",
    allowedRoles: CRM_READ_ROLES,
    title: "查询合同列表",
    description: "查询当前用户可查看的合同记录。",
    schema: strictListInput({
      status: z.enum(["DRAFT", "SIGNED", "CANCELLED", "COMPLETED", "ARCHIVED"]).optional(),
      paymentStatus: z.enum(["UNPAID", "PARTIAL_PAID", "PAID"]).optional(),
      customerId: optionalUuidReferenceFilter("客户 UUID。仅当用户明确指定客户且已知其 ID 时传入。"),
    }),
  },
  { name: "crm_contract_get", allowedRoles: CRM_READ_ROLES, title: "查询合同详情", description: "查询当前用户可查看的合同详情和回款摘要。", schema: idInput },
  {
    name: "crm_shipments_list",
    allowedRoles: CRM_READ_ROLES,
    title: "查询发货记录",
    description: "查询当前用户可查看的发货记录和状态。",
    schema: strictListInput({
      status: z.enum(["NOT_SHIPPED", "PARTIAL_SHIPPED", "SHIPPED"]).optional(),
      contractId: optionalUuidReferenceFilter("合同 UUID。仅当用户明确指定合同且已知其 ID 时传入。"),
      customerId: optionalUuidReferenceFilter("客户 UUID。仅当用户明确指定客户且已知其 ID 时传入。"),
    }),
  },
  { name: "crm_shipment_get", allowedRoles: CRM_READ_ROLES, title: "查询发货详情", description: "查询当前用户可查看的发货详情。", schema: idInput },
  {
    name: "erp_suppliers_list",
    allowedRoles: ERP_VIEW_ROLES,
    title: "查询供应商列表",
    description: "查询当前用户可查看的供应商记录。",
    schema: strictListInput({ active: z.preprocess(nullishDrop, z.boolean().optional()) }),
  },
  { name: "erp_supplier_get", allowedRoles: SUPPLIER_DETAIL_ROLES, title: "查询供应商详情", description: "按 ID 查询供应商。", schema: idInput },
  {
    name: "erp_purchase_orders_list",
    allowedRoles: ERP_VIEW_ROLES,
    title: "查询采购订单列表",
    description: "查询当前用户可查看的采购订单。",
    schema: strictListInput({
      status: z.enum(["DRAFT", "ORDERED", "PARTIAL_RECEIVED", "RECEIVED", "CANCELLED"]).optional(),
      supplierId: optionalUuidReferenceFilter("供应商 UUID。仅当用户明确指定供应商且已知其 ID 时传入。"),
    }),
  },
  { name: "erp_purchase_order_get", allowedRoles: ERP_VIEW_ROLES, title: "查询采购订单详情", description: "按 ID 查询采购订单、明细和供应商快照。", schema: idInput },
  {
    name: "erp_inventory_list",
    allowedRoles: ERP_VIEW_ROLES,
    title: "查询库存",
    description: "按仓库、物料或预警状态查询当前库存。",
    schema: strictListInput({
      warehouseId: optionalUuidReferenceFilter("仓库 UUID。仅在用户明确指定仓库且已知其 ID 时传入。"),
      categoryId: optionalUuidReferenceFilter("物料分类 UUID。仅当用户明确指定分类且已知其 ID 时传入。"),
      alertOnly: z.preprocess(nullishDrop, z.boolean().default(false)),
    }),
  },
  {
    name: "erp_stock_documents_list",
    allowedRoles: ERP_VIEW_ROLES,
    title: "查询出入库单",
    description: "查询正式入库单或出库单及其明细。",
    schema: strictListInput({
      direction: z.enum(["IN", "OUT"]),
      warehouseId: optionalUuidReferenceFilter("仓库 UUID。仅当用户明确指定仓库且已知其 ID 时传入。"),
      productionOrderId: optionalUuidReferenceFilter("生产工单 UUID。仅当用户明确指定工单且已知其 ID 时传入。"),
      purchaseOrderId: optionalUuidReferenceFilter("采购订单 UUID。仅当用户明确指定采购订单且已知其 ID 时传入。"),
    }),
  },
  {
    name: "erp_stock_movements_list",
    allowedRoles: ERP_VIEW_ROLES,
    title: "查询库存流水",
    description: "查询当前用户可查看的库存变动流水。",
    schema: strictListInput({
      warehouseId: optionalUuidReferenceFilter("仓库 UUID。仅当用户明确指定仓库且已知其 ID 时传入。"),
      materialId: optionalUuidReferenceFilter("物料 UUID。仅当用户明确指定物料且已知其 ID 时传入。"),
      type: z.enum(["STOCK_IN", "STOCK_OUT", "CHECK_ADJUST", "TRANSFER_IN", "TRANSFER_OUT"]).optional(),
      refType: optionalStockReferenceTypeFilter("来源单据类型，仅支持 StockIn、StockOut、StockCheck 或 StockTransfer。"),
      refId: optionalUuidReferenceFilter("来源单据 UUID。仅当用户明确指定来源单据且已知其 ID 时传入。"),
    }),
  },
  {
    name: "erp_boms_list",
    allowedRoles: ERP_VIEW_ROLES,
    title: "查询整机用料清单",
    description: "查询整机用料清单版本和用料明细。",
    schema: strictListInput({
      productId: optionalUuidReferenceFilter("产品 UUID。仅当用户明确指定产品且已知其 ID 时传入。"),
      active: z.preprocess(nullishDrop, z.boolean().optional()),
    }),
  },
  { name: "erp_bom_get", allowedRoles: BOM_DETAIL_ROLES, title: "查询用料清单详情", description: "查询当前用户可查看的完整用料层级。", schema: idInput },
  {
    name: "erp_production_orders_list",
    allowedRoles: ERP_VIEW_ROLES,
    title: "查询生产工单列表",
    description: "查询当前用户可查看的生产工单。",
    schema: strictListInput({
      status: z.enum(["DRAFT", "ISSUED", "CHANGE_PENDING", "CANCELLED"]).optional(),
    }),
  },
  { name: "erp_production_order_get", allowedRoles: ERP_VIEW_ROLES, title: "查询生产工单详情", description: "查询当前用户可查看的生产工单详情。", schema: idInput },
  {
    name: "erp_kit_check",
    allowedRoles: KIT_CHECK_ROLES,
    title: "只读齐套检查",
    description: "根据工单冻结用料和当前仓库库存即时计算齐套结果，不保存结果、不扣减库存。",
    schema: z.object({ productionOrderId: id }).strict(),
  },
] as const;

export const MCP_TOOL_NAMES = toolDefinitions.map((tool) => tool.name);

export type McpBusinessToolDefinition = {
  name: string;
  title: string;
  description: string;
  allowedRoles: readonly McpUser["role"][];
  schema: z.ZodTypeAny;
};

/** 按名称取业务工具定义（含 Zod 校验 schema）；平台内 Agent（小川）与 MCP 共用同一份定义。 */
export function getMcpBusinessToolDefinition(name: string): McpBusinessToolDefinition | null {
  const definition = toolDefinitions.find((tool) => tool.name === name);
  if (!definition) return null;
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    allowedRoles: definition.allowedRoles,
    schema: definition.schema,
  };
}

export const MCP_TOOL_ROLE_MATRIX = Object.fromEntries(
  toolDefinitions.map((tool) => [tool.name, [...tool.allowedRoles]]),
) as Record<(typeof MCP_TOOL_NAMES)[number], McpUser["role"][]>;

export function canCallMcpBusinessTool(toolName: string, role: McpUser["role"]) {
  const definition = toolDefinitions.find((tool) => tool.name === toolName);
  return Boolean(definition && (definition.allowedRoles as readonly string[]).includes(role));
}

function plainJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, current) => typeof current === "bigint" ? current.toString() : current));
}

function resultEnvelope(requestId: string, toolName: string, generatedAt: Date, data: unknown) {
  return {
    ok: true,
    data: plainJson(data),
    meta: {
      requestId,
      tool: toolName,
      generatedAt: generatedAt.toISOString(),
    },
    error: null,
  };
}

function errorEnvelope(requestId: string, toolName: string, generatedAt: Date, error: unknown) {
  const safeError = error instanceof McpToolError
    ? { code: error.code, message: error.message }
    : { code: "INTERNAL_ERROR", message: "工具执行失败" };
  return {
    ok: false,
    data: null,
    meta: {
      requestId,
      tool: toolName,
      generatedAt: generatedAt.toISOString(),
    },
    error: safeError,
  };
}

export function createMcpToolErrorResult(
  requestId: string,
  toolName: string,
  generatedAt: Date,
  error: unknown,
) {
  const envelope = errorEnvelope(requestId, toolName, generatedAt, error);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
    structuredContent: envelope,
    isError: true,
  };
}

export class McpToolError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "McpToolError";
  }
}

function writeDiagnosticLog(
  enabled: boolean | undefined,
  entry: Record<string, unknown>,
) {
  if (enabled !== true) return;
  console.warn(JSON.stringify({ event: "MCP_TOOL_DIAGNOSTIC", ...entry }));
}

function executeWithTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new McpToolError("QUERY_TIMEOUT", "查询超过允许等待时间"));
    }, timeoutMs);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export function registerMcpTools(
  server: McpServer,
  context: {
    requestId: string;
    user: McpUser | null;
    dataSource: McpDataSource;
    now: () => Date;
    includeBusinessTools?: boolean;
    allowedBusinessToolNames?: readonly string[];
    allowedBusinessToolRoles?: readonly McpUser["role"][];
    queryTimeoutMs?: number;
    diagnosticLogging?: boolean;
  },
) {
  server.registerTool(
    MCP_IDENTITY_TOOL_NAME,
    {
      title: "验证当前 ERP 身份",
      description: "显示当前登录用户可用于本次只读会话的身份摘要。",
      inputSchema: whoAmIInput,
      annotations: {
        title: "验证当前 ERP 身份",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      if (!context.user) {
        return createMcpToolErrorResult(
          context.requestId,
          MCP_IDENTITY_TOOL_NAME,
          context.now(),
          new McpToolError("IDENTITY_REQUIRED", "工具调用需要当前登录用户身份"),
        );
      }
      const envelope = resultEnvelope(context.requestId, MCP_IDENTITY_TOOL_NAME, context.now(), {
        userId: context.user.id,
        isActive: context.user.isActive !== false,
        role: context.user.role,
        region: context.user.region,
        territories: context.user.territories,
        viewScope: context.user.viewScope,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope,
      };
    },
  );

  if (context.includeBusinessTools === false) return;

  const allowedBusinessToolNames = context.allowedBusinessToolNames
    ? new Set(context.allowedBusinessToolNames)
    : null;
  const allowedBusinessToolRoles = context.allowedBusinessToolRoles
    ? new Set(context.allowedBusinessToolRoles)
    : null;

  for (const definition of toolDefinitions) {
    if (allowedBusinessToolNames && !allowedBusinessToolNames.has(definition.name)) continue;
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.schema,
        annotations: {
          title: definition.title,
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args: Record<string, unknown>) => {
        const startedAt = Date.now();
        if (!context.user) {
          return createMcpToolErrorResult(
            context.requestId,
            definition.name,
            context.now(),
            new McpToolError("IDENTITY_REQUIRED", "工具调用需要当前登录用户身份"),
          );
        }
        try {
          if (allowedBusinessToolRoles && !allowedBusinessToolRoles.has(context.user.role)) {
            throw new McpToolError("FORBIDDEN", "当前角色不在本 MCP 联调范围内");
          }
          if (!canCallMcpBusinessTool(definition.name, context.user.role)) {
            throw new McpToolError("FORBIDDEN", "当前角色无权调用此工具");
          }
          const data = await executeWithTimeout(context.dataSource.execute(
            definition.name,
            args as Record<string, unknown>,
            context.user,
          ), context.queryTimeoutMs ?? 5_000);
          const envelope = resultEnvelope(context.requestId, definition.name, context.now(), data);
          writeDiagnosticLog(context.diagnosticLogging, {
            requestId: context.requestId,
            toolName: definition.name,
            outcome: "SUCCESS",
            durationMs: Date.now() - startedAt,
          });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
            structuredContent: envelope,
          };
        } catch (error) {
          writeDiagnosticLog(context.diagnosticLogging, {
            requestId: context.requestId,
            toolName: definition.name,
            outcome: "ERROR",
            durationMs: Date.now() - startedAt,
            errorName: error instanceof Error ? error.name : "UnknownError",
            errorCode: error instanceof McpToolError ? error.code : "UNEXPECTED",
          });
          return createMcpToolErrorResult(context.requestId, definition.name, context.now(), error);
        }
      },
    );
  }
}
