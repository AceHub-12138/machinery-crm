import { PrismaClient } from "@prisma/client";
import "dotenv/config";

// 本地开发专用：向本地库插入演示线索，供页面动效/交互验收使用。
// 安全护栏：仅允许 DATABASE_URL 指向 localhost 时运行。
const prisma = new PrismaClient();

type DemoLead = {
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  source: "BAIDU_SEARCH" | "MANUAL" | "OTHER";
  searchKeyword: string;
  aiScore: number;
  reviewStatus: "PENDING" | "HIGH_INTENT" | "MID_INTENT" | "LOW_INTENT" | "INVALID";
  assignIdx: number | null;
};

const DEMO_LEADS: DemoLead[] = [
  { companyName: "浙江精工齿轮有限公司", contactName: "陈厂长", phone: "13800000001", email: "chen@zjgear-demo.cn", source: "BAIDU_SEARCH", searchKeyword: "数控车床 齿轮加工", aiScore: 92, reviewStatus: "HIGH_INTENT", assignIdx: 0 },
  { companyName: "江苏恒力机械制造厂", contactName: "刘经理", phone: "13800000002", email: "liu@hljx-demo.cn", source: "BAIDU_SEARCH", searchKeyword: "CK6150 机床采购", aiScore: 87, reviewStatus: "HIGH_INTENT", assignIdx: 0 },
  { companyName: "山东华兴锻造有限公司", contactName: "孙主任", phone: "13800000003", email: "sun@hxdz-demo.cn", source: "BAIDU_SEARCH", searchKeyword: "重型机床 询价", aiScore: 78, reviewStatus: "MID_INTENT", assignIdx: 0 },
  { companyName: "广东佛山五金制品厂", contactName: "何老板", phone: "13800000004", email: "he@fswj-demo.cn", source: "BAIDU_SEARCH", searchKeyword: "仪表车床 价格", aiScore: 71, reviewStatus: "MID_INTENT", assignIdx: 1 },
  { companyName: "河北沧州管道配件公司", contactName: "马工", phone: "13800000005", email: "ma@czgd-demo.cn", source: "BAIDU_SEARCH", searchKeyword: "管件车削 设备", aiScore: 64, reviewStatus: "MID_INTENT", assignIdx: 1 },
  { companyName: "辽宁鞍山钢构机械厂", contactName: "赵经理", phone: "13800000006", email: "zhao@asgg-demo.cn", source: "OTHER", searchKeyword: "大型法兰加工", aiScore: 55, reviewStatus: "LOW_INTENT", assignIdx: null },
  { companyName: "河南洛阳轴承贸易公司", contactName: "王经理", phone: "13800000007", email: "wang@lyzc-demo.cn", source: "BAIDU_SEARCH", searchKeyword: "轴承车床 配套", aiScore: 83, reviewStatus: "HIGH_INTENT", assignIdx: 2 },
  { companyName: "安徽芜湖电器设备厂", contactName: "林工", phone: "13800000008", email: "lin@wheq-demo.cn", source: "MANUAL", searchKeyword: "电柜零件 机加工", aiScore: 47, reviewStatus: "LOW_INTENT", assignIdx: null },
  { companyName: "四川成都汽配制造公司", contactName: "周经理", phone: "13800000009", email: "zhou@cdqp-demo.cn", source: "BAIDU_SEARCH", searchKeyword: "曲轴加工 机床", aiScore: 90, reviewStatus: "HIGH_INTENT", assignIdx: 2 },
  { companyName: "天津塘沽船舶配件公司", contactName: "杨厂长", phone: "13800000010", email: "yang@tgcb-demo.cn", source: "BAIDU_SEARCH", searchKeyword: "船用件 大型车床", aiScore: 76, reviewStatus: "MID_INTENT", assignIdx: null },
  { companyName: "山西太原煤机装备公司", contactName: "高经理", phone: "13800000011", email: "gao@tymj-demo.cn", source: "OTHER", searchKeyword: "矿机配件", aiScore: 38, reviewStatus: "INVALID", assignIdx: null },
  { companyName: "上海松江精密机械有限公司", contactName: "徐工", phone: "13800000012", email: "xu@sjjm-demo.cn", source: "BAIDU_SEARCH", searchKeyword: "精密零件 车铣", aiScore: 68, reviewStatus: "MID_INTENT", assignIdx: 3 },
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl.includes("localhost") && !databaseUrl.includes("127.0.0.1")) {
    throw new Error("拒绝运行：此脚本只允许在 DATABASE_URL 指向 localhost 的本地库使用");
  }

  const salesUsers = await prisma.user.findMany({
    where: { role: { in: ["SALES", "FOREIGN_TRADE"] } },
    select: { id: true, name: true, email: true },
    orderBy: { createdAt: "asc" },
  });
  if (salesUsers.length === 0) {
    throw new Error("本地库没有销售账号，请先执行 prisma/seed.ts");
  }

  let created = 0;
  let skipped = 0;
  for (const [index, demoLead] of DEMO_LEADS.entries()) {
    const dedupKey = `local-demo-lead-${index + 1}`;
    const existing = await prisma.lead.findUnique({ where: { dedupKey } });
    if (existing) {
      skipped += 1;
      continue;
    }
    await prisma.lead.create({
      data: {
        companyName: demoLead.companyName,
        contactName: demoLead.contactName,
        phone: demoLead.phone,
        email: demoLead.email,
        source: demoLead.source,
        searchKeyword: demoLead.searchKeyword,
        aiScore: demoLead.aiScore,
        reviewStatus: demoLead.reviewStatus,
        dedupKey,
        idempotencyKey: dedupKey,
        sourceSystem: "local-demo",
        assignedUserId: demoLead.assignIdx === null ? null : salesUsers[demoLead.assignIdx % salesUsers.length]?.id ?? null,
      },
    });
    created += 1;
  }
  console.log(`本地演示线索就绪：新建 ${created} 条，已存在跳过 ${skipped} 条`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
