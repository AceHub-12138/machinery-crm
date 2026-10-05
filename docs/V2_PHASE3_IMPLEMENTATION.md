# DachuanPro 2.0 阶段 3：待办、审批与平台管理

## 交付范围

- `/tasks` 统一聚合以下既有业务来源，并用 `system_user_task_states` 保存用户已读、置顶、忽略与最后查看状态：
  - 审批：合同解锁、合同删除、生产工单变更、采购订单删除、齐套结果删除；
  - 采购需求：活动槽位的草稿/已提交采购需求；
  - 跟进提醒：当前用户客户数据范围内，已到期或未来 3 天内到期的 `Customer.nextFollowDate`（逾期 `URGENT`，临近 `NORMAL`）；
  - 供应商交期：已下单/部分收货采购订单中，已逾期或未来 3 天内到期且未完成的最新承诺交期（逾期 `URGENT`，临近 `NORMAL`）；
  - 库存异常：低于物料安全库存的库存台账（`safetyStock=0` 视为未设阈值；只有 `safetyStock=null` 才回退分类 `warningThreshold`）；
  - 逾期履约：客户数据范围内未完成的发货记录，以及未删除、当前、已下达且计划完工日已过的生产工单。
- CRM 来源复用 `buildCustomerWhereClause`/`canSeeAllData`；ERP 来源仅对 `canSeeErpTasks` 的超级管理员、采购和仓库开放。
- 新增采购订单非草稿删除申请与齐套结果删除申请。审批仅超级管理员可执行；采购订单如已有任何已收数量即返回 409，不改写库存流水；齐套删除仅软删除结果，不删除采购需求或库存数据。
- 新增 `/admin/master-data`、`/admin/config`、`/admin/health`、`/admin/cockpit`。资料中心只跳转既有数据，配置服务仅允许提醒/打印信息白名单，健康中心只读且不返回密钥。
- 新增静态权限动作/模块矩阵及只读查询 API。`SUPER_ADMIN` 永远全权限，原有领域 API 权限函数仍是动态矩阵迁移前的服务端兜底。
- 新的 `/api/system/audit/search` 提供分页、筛选和递归脱敏；旧 `/api/operation-logs` 与 `/api/system/audit` 保持阶段 2 数组响应契约。

## 仓库权限 BUG 修复

| 能力 | SUPER_ADMIN | WAREHOUSE | PURCHASE |
| --- | --- | --- | --- |
| 物料主数据 / BOM / 齐套执行 | 写 | 写 / 可执行 | 只读 |
| 采购需求 | 写 | 创建/处理 | 写 |
| 采购订单 / 供应商 | 写 | 只读 | 写 |
| 库存 | 写 | 写 | 只读 |

- `canManagePurchaseDemands` 已从 `canManagePurchaseOrders` 拆分；仓库没有采购订单创建、供应商维护或删除审批权限。
- 采购需求 Route 使用新函数；采购订单创建仍使用原函数。
- middleware 放行采购/仓库的 BOM 页，仓库额外放行采购需求页；sidebar 同步显示仓库的 BOM 与采购需求入口，保留阶段 1 的业务分组和滚动恢复逻辑。

## 数据库与手工导入

`prisma/migrations/20260803130000_v2_phase3_admin_tasks/migration.sql` 仅包含 `CREATE TABLE`、`ADD COLUMN`、`ADD INDEX` 和外键；未在本机或任何服务器执行。生产导入前应备份数据库，并先在副本验证。

## 明确边界

- 未变更 CRM 的 `customerIsolationWhere`、`canSeeAllData`、`viewScope` 或 Agent assertion/Gateway 合约。
- 未实现阶段 4 的编号规则和打印，不把未落地能力伪装成配置项。
- 健康中心不提供重启、部署、回滚、Shell、环境变量编辑或密钥查看。
