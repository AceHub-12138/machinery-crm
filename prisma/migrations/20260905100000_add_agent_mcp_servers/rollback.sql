-- 回滚：删除外部 MCP 服务配置表（仅丢失 MCP 服务配置本身，不影响任何业务数据）。
DROP TABLE `agent_mcp_servers`;
