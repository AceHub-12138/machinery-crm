# 大川机床 · DachuanPro 数字化营销管理平台

> 一句话:把机床企业的**客户、报价、合同、回款、发货、售后、生产、采购**装进一个系统——数据一致、责任到人、老板随时看得到。

*An in-house CRM + ERP + AI platform built for a CNC machine tool manufacturer (Next.js 16 · Prisma · MySQL).*

[![build-standalone](https://github.com/AceHub-12138/machinery-crm/actions/workflows/build-standalone.yml/badge.svg)](https://github.com/AceHub-12138/machinery-crm/actions/workflows/build-standalone.yml)

配套仓库:[可视化大屏](https://github.com/AceHub-12138/machinery-crm-visual-dashboard) · [桌面客户端](https://github.com/AceHub-12138/machinery-crm-desktop)

## 这是做什么的

大川机床造数控插床、插齿机、键槽机床、带锯床、五轴加工中心。卖设备的生意链条长:从找到客户、报出方案、签下合同、催回货款,到安排生产、发货、装调、售后——中间任何一环掉链子,都直接影响收钱。

这个平台把这些环节搬到线上,给销售、内勤、生产和老板各一个顺手的界面:

| 没有平台时 | 有了 DachuanPro |
|---|---|
| 客户资料散在 Excel 和业务员手机里,人一走客户就丢 | 客户、联系人、跟进记录统一入库,谁在跟、谈到哪一步一目了然 |
| 合同回款靠脑子记、群里问 | 合同台账 + 回款进度,逾期自动提醒 |
| 生产、采购、库存各记各的账 | BOM、生产工单、采购、出入库一条线,物料齐套自动检查 |
| 老板要看经营情况得等人做报表 | 经营指挥舱实时看合同额、回款、发货地图,展厅大屏直接投 |
| 获客靠翻黄页、跑展会 | AI 获客助手自动搜索线索、核验企业信息、评分、生成跟进报告 |

## 功能模块

### CRM(销售主线)

- **客户与跟进**:客户档案、联系人、区域划分、跟进记录
- **报价**:客户报价单管理
- **合同**:合同台账与回款进度;合同删除、解锁一律走审批流,防止随意改动
- **发货与售后**:发货单跟踪、售后工单
- **任务与提醒**:销售任务、月度任务、到期提醒

### ERP(生产与供应链)

- **生产**:生产合同、生产工单、月度生产计划、工单变更审批
- **物料与库存**:物料分类、BOM、仓库、出入库、移库、盘点
- **采购**:采购需求、采购订单、供应商与供应商送货管理
- **齐套检查**:按工单自动核对物料齐套,缺料提前预警

### AI 能力

- **AI 助手「小川」**:平台内置对话助手,业务员用大白话查客户、查合同、查回款;独立账号体系、按日限额、模型可切换、全程审计
- **AI 获客助手**:线索自动搜索、天眼查企业信息核验、评分入池,可配合 n8n 工作流全自动跑
- **MCP 服务**:把平台数据以标准 MCP(Model Context Protocol)工具安全开放给外部 AI 客户端——只读、鉴权、审计

### 管理与安全

- 用户 / 角色 / 区域三级权限体系
- 操作日志留痕;关键业务数据只加不删、软删除、可审计
- 附件访问统一鉴权,合同与图片不能拿链接直接看
- 独立管理后台:Agent 账号管理、系统配置、健康检查

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Next.js 16(App Router)· React 19 · TypeScript · Tailwind CSS 4 |
| 后端 | Next.js API Routes · Auth.js(next-auth v5) |
| 数据库 | MySQL 5.7+ · Prisma 6 |
| AI | MCP · 多模型可切换 · 支持图片识别 |
| 测试 | Vitest · 全量验收工作流(真实 MySQL 5.7 容器跑迁移与最小权限验收) |
| 部署 | Docker standalone · GitHub Actions 云构建 · PM2 + Nginx |

## 快速启动(开发环境)

要求:Node.js 20+、pnpm 10、MySQL 5.7+

```bash
pnpm install

# 准备环境变量:复制 .env.example 为 .env,并至少补齐:
#   DATABASE_URL    MySQL 连接串
#   AUTH_SECRET     登录会话密钥
#   NEXTAUTH_URL    http://localhost:3000
#   UPLOAD_DIR      附件存储目录
pnpm db:migrate      # 建表
pnpm db:seed         # 初始化演示账号(需在 .env 设置 SEED_ADMIN_PASSWORD / SEED_SALES_PASSWORD,长度≥12)
pnpm dev
```

打开 http://localhost:3000 ,用种子管理员账号登录。

> 完整环境变量说明见 `docs/`;部署细节见 [DEPLOY.md](DEPLOY.md)、[STANDALONE_DEPLOY.md](STANDALONE_DEPLOY.md)、[ROLLBACK.md](ROLLBACK.md)。

## 目录结构

```
src/app/             页面与 API 路由(Next.js App Router)
src/lib/             业务逻辑、鉴权、工具
prisma/              数据库 schema 与迁移脚本
deploy/              Nginx、FastGPT 等部署配套
docs/                设计文档、API 说明、验收清单
scripts/             构建、打包、验收脚本
n8n/                 获客自动化工作流
.github/workflows/   CI:standalone 构建 + 全量只读验收
```

## 相关仓库

| 仓库 | 说明 |
|---|---|
| [machinery-crm-visual-dashboard](https://github.com/AceHub-12138/machinery-crm-visual-dashboard) | 经营指挥舱可视化大屏(CRM KPI + 销售目标 + 发货地图)+ 语音交互 |
| [machinery-crm-desktop](https://github.com/AceHub-12138/machinery-crm-desktop) | DachuanPro Windows 桌面客户端(Electron) |

## 版权与使用说明

© 2026 大川机床(Dachuan)。本项目源码仅用于技术展示与交流,未附开源许可证,默认保留所有权利;未经授权请勿用于商业用途或二次分发。

仓库中不包含任何客户数据、生产环境配置与密钥——所有敏感信息一律通过环境变量注入。
