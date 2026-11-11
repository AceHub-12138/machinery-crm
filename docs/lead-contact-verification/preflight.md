# 开工前核对

- 本地原分支：k3/sales-screen-platform，57af5403ac3ea2b188dfea557cd939960bb834ed。
- 本地 main：06495e2e42c366b0c8fbc49ac9d7b021a2f87b4f。
- 实时 fetch 与 ls-remote 交叉确认的 github/main：5d6941e0b82a5a46e76cce4227391bac5ea1650e。
- 文档所写远端 609f26c1 已过时，其后新增 7 个提交、67 文件差异，主要为大屏数据口径及多币种显示。
- 原分支与当前 github/main 的快照相差 110 文件，2827 行新增、852 行删除；获客助手与线索池相关目录内容完全一致。MCP API 含远端数据库连接池安全修复，施工基于远端保留。
- 此仓库不是浅克隆，两个历史分别根于 f4af3a50 和 a8576dc6，git merge-base 返回 1；不能直接 pull/rebase 当作普通落后分支处理。
- origin 指向 Hantai-Jialink/machinery-crm-source，Git 与连接器均返回仓库不存在或无权限，不能验证该远端最新状态。
- 原工作区无已跟踪或暂存差异；有 4 个未跟踪文件：.share-tmp.txt、docs/design/xiaochuan-mascot/codex-blender-repair-round2.md、review-server.log、v4probe.tmp.mjs，均保留且未读取内容。
- 用户确认基线后，在独立目录 wt-lead-contact-verification 创建 codex/lead-contact-verification；没有把远端差异覆盖到原工作区。
- 未找到 lead-hunter-audit-repro 目录，测试按施工方案的行为对照表重新建立，不能冒充原始复现文件逐字迁入。
