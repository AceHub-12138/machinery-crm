/** 保留每个数据库账号及显式参数，不能把 MCP 只读/审计账号合并成业务写账号。 */
export function withDatabasePoolDefaults(raw: string | undefined, connectionLimit = 10) {
  if (!raw) return undefined;
  const url = new URL(raw);
  for (const [name, value] of Object.entries({ connection_limit: String(connectionLimit), pool_timeout: "10", connect_timeout: "10" })) {
    if (!url.searchParams.has(name)) url.searchParams.set(name, value);
  }
  return url.toString();
}
