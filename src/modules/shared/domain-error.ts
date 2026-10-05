/**
 * 领域服务可预期的业务/权限错误。
 * Route 只把它翻译为 HTTP，避免兼容路由各自复制权限分支。
 */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 409 | 503 = 400,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
