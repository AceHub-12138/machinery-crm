# ERP 二期可用性修复审计报告

日期：2026-07-09
分支：`codex/erp-phase2-usability-fixes`
基线：`origin/erp-graft@6dc650e`
范围：本地代码修复与审计报告；未部署、未连接服务器、未修改线上数据库数据。

## 修改范围

- 物料 Excel 导入
  - 新增 Excel 模板下载入口与 Excel 导入入口。
  - 导入接口改为预览/确认两阶段。
  - 有“物料编号/图号”时按编号查找，存在则更新基础信息，不存在则新增。
  - 缺少“物料编号/图号”时预览标记为“缺少图号/编号，待处理”，可选择已有物料更新、按分类自动编号新增或跳过。
  - 自动编号优先使用 `MaterialCategory.code`，否则使用固定映射前缀，格式为 `前缀-0001`。
  - 确认导入在事务中处理自动编号和新增，并写入 `OperationLog`。
  - 导入逻辑未写 `Inventory`，未写 `StockMovement`，不修改库存数量。
- 整机用料清单
  - 用户可见的“BOM 管理/新增 BOM/BOM 明细”等文案改为“整机用料清单/新建整机清单/清单明细”。
  - 页面仅保留一次说明：“用于维护每台机床生产所需的标准物料，原行业术语为 BOM。”
  - 新增/编辑弹窗改为 80vw、最大 1100px、固定底部按钮、内容区滚动。
  - 明细录入改为“批量选择物料 + 表格逐行填写单台用量”。
  - `sortOrder` 仍由前端按行顺序自动生成；`level`、`parentItemId` 默认隐藏。
- 入库单
  - 列表操作改为“查看”和“纠错/作废”。
  - 由于当前表结构没有 `status`、`voidedAt`、`voidReason`，未实现直接作废写库。
  - 对已提交入库单显示安全提示：不能直接编辑或删除，后续应走冲销改造。
- 盘点
  - 页面新增使用说明，明确账面数量、实盘数量、盘盈盘亏、提交后生成库存流水、完成后不可随意修改。

## 修改文件

- `package.json`
- `pnpm-lock.yaml`
- `src/app/api/erp/materials/import/route.ts`
- `src/components/erp/material-import-dialog.tsx`
- `src/app/(app)/erp/materials/page.tsx`
- `src/app/(app)/erp/bom/page.tsx`
- `src/app/api/erp/boms/route.ts`
- `src/app/api/erp/boms/[id]/route.ts`
- `src/app/api/erp/boms/[id]/requirements/route.ts`
- `src/components/layout/sidebar.tsx`
- `src/lib/changelog.ts`
- `src/app/(app)/erp/stock-in/page.tsx`
- `src/app/(app)/erp/stock-check/page.tsx`
- `docs/audits/erp-phase2-usability-fixes-2026-07-09.md`

## 验证结果

- `git diff --check`：通过。
- `pnpm run build`：通过。
  - 构建路由包含 CRM：`/login`、`/customers`、`/products`、`/contracts`、`/shipments`。
  - 构建路由包含 ERP：`/erp/materials`、`/erp/inventory`、`/erp/stock-in`、`/erp/stock-out`、`/erp/stock-check`、`/erp/bom`。
  - 构建路由包含 API：`/api/erp/materials/import`、`/api/erp/boms`、`/api/erp/boms/[id]`、`/api/erp/boms/[id]/requirements`。
- 本地 production smoke（`127.0.0.1:3110`）：
  - `/login`：200。
  - CRM 受保护页面 `/customers`、`/products`、`/contracts`、`/contracts/new`、`/shipments`：307 登录重定向。
  - ERP 受保护页面 `/erp/materials`、`/erp/inventory`、`/erp/stock-in`、`/erp/stock-out`、`/erp/stock-check`、`/erp/bom`：307 登录重定向。
- 用户可见 “BOM” 文案扫描：
  - 前端页面仅保留一次说明句。
  - API 内部 action 名 `CREATE_BOM`、`UPDATE_BOM`、`DISABLE_BOM` 保留不变。

## 未执行项

- 未连接线上服务器。
- 未部署。
- 未执行数据库迁移。
- 未对线上或本地真实业务数据执行确认导入、新建清单、入库纠错。
- `pnpm run lint` 未通过，原因是仓库缺少 ESLint 9 需要的 `eslint.config.*` 配置文件。
- `pnpm exec tsc --noEmit` 未通过，原因是基线 `next.config.ts` 中 `eslint` 字段不再属于当前 `NextConfig` 类型；`next build` 可通过但会打印该基线警告。

## 入库单安全改造方案

当前先实现“查看 + 提示已提交单据需冲销处理”是安全边界。后续正式作废/冲销建议单独做 schema 迁移和功能开发：

1. 为 `StockIn` 增加状态字段，例如 `DRAFT`、`SUBMITTED`、`VOIDED`。
2. 增加 `voidedAt`、`voidedById`、`voidReason`、`voidRefId` 等字段。
3. 已提交单据禁止直接编辑明细和删除。
4. 作废时要求 `SUPER_ADMIN` 或 `WAREHOUSE` 角色，并强制填写原因。
5. 作废事务内读取原单明细，生成反向 `StockMovement`，同步恢复 `Inventory.quantity`、`totalAmount`、`avgPrice`。
6. 原入库单保留并标记 `VOIDED`，写入 `OperationLog`。
7. 增加幂等保护，防止同一入库单重复作废。

## 风险说明

- Excel 导入确认路径涉及数据库写入，已通过构建验证和代码审计，但未在真实登录会话下写入测试库。
- 自动编号依赖分类编码或固定映射；分类命名不在映射中且没有 `code` 时会使用 `WL` 前缀。
- 当前整机用料清单的多级字段默认隐藏；已有多级数据在编辑保存时会尽量保留隐藏字段，但本次重点是一级用料清单的可用性。
- `next.config.ts` 的 `eslint` 警告和 ESLint 9 配置缺失是现有工程问题，未纳入本次 ERP 业务修复范围。
