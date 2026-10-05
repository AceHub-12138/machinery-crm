/**
 * 小川第 2 期段 1 冒烟测试：直接驱动引擎，验证知识库工具链路。
 * 用法：npx tsx --env-file=.env scripts/xiaochuan-phase2-smoke.ts
 */
import { prisma } from "../src/lib/db";
import { createPrismaMcpDataSource } from "../src/lib/mcp/prisma-data-source";
import { runXiaochuanTurn } from "../src/lib/agent/engine";
import { loadXiaochuanConfig } from "../src/lib/agent/config";

const QUESTIONS = [
  "BK5040 数控插床最大能插多长的键槽？主电机功率多大？",
  "客户要加工一个直齿圆柱齿轮：外径 240mm、模数 4、齿宽 60mm。用我们哪台机床加工合适？",
  "车间是凯恩帝系统的插床，插一个键槽，程序怎么写？",
  "工件上有好几个键槽要加工，用什么设备比较好？",
];

async function main() {
  const config = loadXiaochuanConfig();
  const dataSource = createPrismaMcpDataSource(prisma);
  const findUser = dataSource.findUser;
  if (!findUser) throw new Error("findUser 不可用");
  const dbUser = await prisma.user.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
  if (!dbUser) throw new Error("本地库没有用户");
  const user = await findUser(dbUser.id);
  if (!user) throw new Error("McpUser 解析失败");
  console.log(`测试用户：${user.name}（${user.role}）\n`);

  for (const question of QUESTIONS) {
    console.log("=".repeat(72));
    console.log(`问：${question}`);
    const result = await runXiaochuanTurn({
      config,
      tier: "standard",
      user,
      dataSource,
      history: [],
      userMessage: question,
      callbacks: {
        onDelta: () => undefined,

        onReasoning: () => {},
        onToolEvent: (event) => console.log(`  [工具] ${event.tool} ok=${event.ok} ${event.durationMs}ms`),
      },
    });
    console.log(`答：${result.content.slice(0, 600)}`);
    console.log(`（轮数=${result.iterations}，工具调用=${result.toolEvents.length} 次）\n`);
  }
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("冒烟失败：", error);
  process.exit(1);
});
