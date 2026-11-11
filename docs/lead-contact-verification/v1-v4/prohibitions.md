# 本轮禁止事项逐条确认

| 禁止事项 | 实际确认 |
| --- | --- |
| 连接正式库或远程数据库 | 未连接；仅一次性本机 127.0.0.1 容器 crm_d1_test／crm_v1_test 及同容器基线试跑库 |
| 调用真实天眼查、千帆、模型供应商 | 未调用；全部测试数据来自回环模拟，外网 socket 由测试 guard 拒绝 |
| worktree 内建 .env／.env.local | 未创建；只有原有 .env*.example；随机秘密仅在仓库外临时状态／进程环境；相关进程已停止，临时目录删除被自动审批审核拒绝，待用户本机清理 |
| migrate dev、migrate reset、db push | 未使用；只用既有 migrate deploy／status；原 V1 resolve 的 P3012 结果沿用，本轮未用 reset |
| 合并 PR | 未合并，PR #2 保持原状态 |
| 推送 main | 未推送；只普通推送 github/codex/lead-contact-verification |
| 手动运行 build-standalone | 未运行／未 dispatch；只本地 pnpm build 和既有 PR checks |
| force push | 未使用 |
| git reset | 未使用 |
| git clean | 未使用 |
| git amend | 未使用 |
| git add -A／git add . | 未使用；源码四文件逐路径 add，文档文件也逐路径 add |
| 超出 D1 修改入池／心跳逻辑 | 没有；生产源码仅两条 SQL 表达式，原防本地旧值覆盖注释保留 |
| 新增 migration／改 schema | 没有；工作区 prisma/ 未改 |
| V2 新缺陷顺手修复或绕过 | 没有范围外业务修复；暂停核对过的异常均定位为临时样本预期或模拟器错误，原记录保留；未确认新的业务缺陷。原已知限制不被自动视为通过 |
| 修改 deployment.md | 没有；完整修订建议只追加到 v1-mysql-roundtrip.md，标记待复审 |
| 文档／日志暴露密码、真实 token、带密码连接串或本机私有路径 | 新证据写入前脱敏，并在提交前按本轮随机秘密扫描；本机路径替换为 <workspace>／<temporary> |
| 删除正式数据、覆盖 uploads、删除旧 CRM、绕过权限、修改生产配置 | 均未执行；测试数据只在一次性容器和仓库外临时 uploads 中 |
| 没有回滚方案就建议部署 | 未部署；D1 代码回滚及核验结构／迁移历史回滚边界分别写明，结构建议待复审 |

原主工作区的既有未跟踪文件未移动、删除或暂存；既有其他 worktree、容器和临时目录未清理。本轮新建容器、匿名卷和服务进程已清理；私有临时目录删除被自动审批审核拒绝（blocked by policy），未换用其他方式绕过拦截，尚待用户本机清理。详见 cleanup-retest.json。
