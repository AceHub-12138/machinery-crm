import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { createMcpRequestHandler, type McpDataSource } from "@/lib/mcp/application";
import { loadMcpConfig } from "@/lib/mcp/config";
import { createPrismaMcpDataSource } from "@/lib/mcp/prisma-data-source";
import { getAgentAuthRuntime } from "@/lib/agent-auth/runtime";
import { withDatabasePoolDefaults } from "@/lib/database-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let fullReadOnlyDataSource: McpDataSource | null = null;

async function getDataSource(config: ReturnType<typeof loadMcpConfig>) {
  if (config.toolMode !== "full-read-only") {
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
    const agentAuth = await getAgentAuthRuntime();
    const handler = createMcpRequestHandler({
      config,
      dataSource: await getDataSource(config),
      identityVerifier: agentAuth?.tokenService,
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
