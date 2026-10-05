/** 只有明确不属于 Agent 独立账号名单时，才交给 CRM 员工认证继续判断。 */
export function shouldFallbackToCrmLogin(status: number, code: string | undefined) {
  return status === 401 && code === "NOT_AGENT_ACCOUNT";
}
