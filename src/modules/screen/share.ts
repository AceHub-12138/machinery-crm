import { randomBytes } from "node:crypto";
import { z } from "zod";
import { DomainError } from "@/modules/shared/domain-error";

export const SALES_SCREEN_SHARE_SETTING_KEY = "salesScreenShare";

export const PUBLIC_ID_BYTE_LENGTH = 32;

export type SalesScreenShareState = {
  version: 1;
  publicId: string | null;
  createdAt: string | null;
  rotatedAt: string | null;
  revokedAt: string | null;
};

export type SalesScreenShareView = {
  share: SalesScreenShareState;
  path: string | null;
};

// 服务端密码学安全随机源生成 bearer 标识：32 字节 base64url，长度 43
export function generatePublicId(): string {
  return randomBytes(PUBLIC_ID_BYTE_LENGTH).toString("base64url");
}

export function buildSalesScreenShareView(state: SalesScreenShareState): SalesScreenShareView {
  return {
    share: state,
    path: state.publicId === null ? null : `/screen/sales/${state.publicId}?kiosk=1`,
  };
}

// 32 字节 base64url：长度固定 43，字符集仅 A-Z a-z 0-9 下划线 短横线
export const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// 写入端固定使用 toISOString()，因此存储契约锁定为 UTC ISO-8601 字符串
const ISO_UTC_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export function isValidPublicIdFormat(value: unknown): value is string {
  return typeof value === "string" && PUBLIC_ID_PATTERN.test(value);
}

function isValidStoredTime(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_UTC_TIME_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  // 拒绝被 Date 自动归一的溢出日期（如 2026-02-30 → 03-02、25 点 → 次日 1 点）：
  // 回转序列化必须与输入完全一致，才承认是写入端 toISOString() 的合法产物
  return new Date(parsed).toISOString() === value;
}

function safeState(): SalesScreenShareState {
  return {
    version: 1,
    publicId: null,
    createdAt: null,
    rotatedAt: null,
    revokedAt: null,
  };
}

export function normalizeSalesScreenShareState(value: unknown): SalesScreenShareState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return safeState();

  const input = value as Record<string, unknown>;
  if (input.version !== 1) return safeState();
  if (input.publicId !== null && !isValidPublicIdFormat(input.publicId)) return safeState();

  for (const field of ["createdAt", "rotatedAt", "revokedAt"] as const) {
    const stored = input[field];
    if (stored !== null && !isValidStoredTime(stored)) return safeState();
  }

  // 有效链接不允许携带撤销标记：冲突视为损坏数据，整体回退禁用态
  if (input.publicId !== null && input.revokedAt !== null) return safeState();

  return {
    version: 1,
    publicId: input.publicId,
    createdAt: input.createdAt as string | null,
    rotatedAt: input.rotatedAt as string | null,
    revokedAt: input.revokedAt as string | null,
  };
}

const storedTimeSchema = z
  .string()
  .refine(isValidStoredTime, { message: "__INVALID_TIME__" });

const shareStateSchema = z
  .object({
    version: z.literal(1, { message: "共享状态版本不受支持" }),
    publicId: z.union([z.null(), z.string().regex(PUBLIC_ID_PATTERN, { message: "字段 publicId 的格式无效" })]),
    createdAt: z.union([z.null(), storedTimeSchema]),
    rotatedAt: z.union([z.null(), storedTimeSchema]),
    revokedAt: z.union([z.null(), storedTimeSchema]),
  })
  .strict();

export function parseSalesScreenShareState(value: unknown): SalesScreenShareState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("共享状态必须是对象", 400);
  }

  try {
    return shareStateSchema.parse(value);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstIssue = error.issues[0];

      if (firstIssue?.code === "unrecognized_keys") {
        throw new DomainError("共享状态包含未知字段", 400);
      }
      if (firstIssue?.code === "invalid_type") {
        throw new DomainError(`字段 ${firstIssue.path.join(".")} 的类型不正确`, 400);
      }
      if (firstIssue?.code === "invalid_union") {
        throw new DomainError(`字段 ${firstIssue.path.join(".")} 的类型不正确`, 400);
      }
      if (firstIssue?.message === "__INVALID_TIME__") {
        throw new DomainError(`字段 ${firstIssue.path.join(".")} 的时间格式无效`, 400);
      }
      if (firstIssue?.message) {
        throw new DomainError(firstIssue.message, 400);
      }
    }
    throw new DomainError("共享状态格式无效", 400);
  }
}
