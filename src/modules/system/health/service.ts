import { prisma } from "@/lib/db";
import { APP_VERSION } from "@/lib/changelog";
import type { SessionUser } from "@/lib/permissions";
import { DomainError } from "@/modules/shared/domain-error";

type HealthItem = { name: string; status: "OK" | "UNAVAILABLE" | "NOT_CONNECTED"; detail: string };

export async function getSystemHealth(user: SessionUser) {
  if (user.role !== "SUPER_ADMIN") throw new DomainError("无权限查看系统健康", 403);
  const database: HealthItem = await prisma.$queryRaw`SELECT 1`.then((): HealthItem => ({ name: "数据库", status: "OK", detail: "SELECT 1 成功" })).catch((): HealthItem => ({ name: "数据库", status: "UNAVAILABLE", detail: "无法验证" }));
  return {
    generatedAt: new Date().toISOString(),
    items: [
      { name: "Web 应用", status: "OK", detail: "当前请求已响应" } satisfies HealthItem,
      database,
      { name: "Agent Gateway", status: process.env.NEXT_PUBLIC_AGENT_GATEWAY_URL ? "NOT_CONNECTED" : "NOT_CONNECTED", detail: process.env.NEXT_PUBLIC_AGENT_GATEWAY_URL ? "已配置，当前未执行外部探测" : "未配置" } satisfies HealthItem,
      { name: "上传目录", status: "NOT_CONNECTED", detail: "运行环境未接入可验证目录状态" } satisfies HealthItem,
    ],
    build: { version: APP_VERSION, gitSha: process.env.GIT_SHA || "无法验证", branch: process.env.GIT_BRANCH || "无法验证", actionsRunId: process.env.GITHUB_RUN_ID || "无法验证" },
  };
}
