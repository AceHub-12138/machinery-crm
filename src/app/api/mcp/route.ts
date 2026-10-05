import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { createMcpRequestHandler, type McpDataSource } from "@/lib/mcp/application";
import { loadMcpConfig } from "@/lib/mcp/config";
import { createPrismaMcpDataSource } from "@/lib/mcp/prisma-data-source";
import { getAgentAuthRuntime } from "@/lib/agent-auth/runtime";
import { getLeadWriterAuthRuntime } from "@/lib/agent-auth/service-runtime";
import { createPrismaLeadCommandDataSource } from "@/lib/mcp/prisma-command-data-source";
import { McpToolError } from "@/lib/mcp/tools";
import { withDatabasePoolDefaults } from "@/lib/database-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let fullReadOnlyDataSource: McpDataSource | null = null;
let leadWriteDataSource: McpDataSource | null = null;

async function getDataSource(config: ReturnType<typeof loadMcpConfig>) {
  if (config.toolMode !== "full-read-only") {
    if (config.toolMode === "lead-write-internal") {
      if (!config.commandDatabaseUrl || !config.auditDatabaseUrl) throw new Error("Lead command databases are not configured");
      if (!leadWriteDataSource) {
        const commandClient = new PrismaClient({ datasources: { db: { url: withDatabasePoolDefaults(config.commandDatabaseUrl, 2) } } });
        const protocolAuditClient = new PrismaClient({ datasources: { db: { url: withDatabasePoolDefaults(config.auditDatabaseUrl, 2) } } });
        const protocolAudit = createPrismaMcpDataSource(commandClient, protocolAuditClient);
        const command = createPrismaLeadCommandDataSource(commandClient);
        leadWriteDataSource = {
          async execute() {
            throw new McpToolError("QUERY_CHANNEL_DISABLED", "Lead 写模式未启用只读查询通道");
          },
          executeCommand: command.executeCommand,
          writeAudit: protocolAudit.writeAudit,
        };
      }
      return leadWriteDataSource;
    }
    const { prisma } = await import("@/lib/db");
    return createPrismaMcpDataSource(prisma);
  }
  fullReadOnlyDataSource ??= createPrismaMcpDataSource(
    new PrismaClient({ datasources: { db: { url: withDatabasePoolDefaults(config.queryDatabaseUrl, 2) } } }),
    new PrismaClient({ datasources: { db: { url: withDatabasePoolDefaults(config.auditDatabaseUrl, 2) } } }),
  );
  return fullReadOnlyDataSource;
}

async function handle(request: Request) {
  try {
    const config = loadMcpConfig();
    const serviceAuth = config.toolMode === "lead-write-internal"
      ? await getLeadWriterAuthRuntime()
      : null;
    const agentAuth = config.toolMode === "lead-write-internal"
      ? null
      : await getAgentAuthRuntime();
    const handler = createMcpRequestHandler({
      config,
      dataSource: await getDataSource(config),
      identityVerifier: agentAuth?.tokenService,
      serviceIdentityVerifier: serviceAuth?.verifier,
    });
    return await handler(request);
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32603, message: "MCP service is not configured" }, id: null },
      { status: 503 },
    );
  }
}

export { handle as POST, handle as GET, handle as DELETE };
