# 04｜服务器部署与环境说明

## 一、服务器与部署基础

DachuanPro 生产环境长期部署在阿里云服务器，使用宝塔面板管理，核心服务包括：

- Nginx
- Node.js / Next.js
- PM2
- MySQL
- pnpm
- 宝塔面板

生产项目路径：

```bash
/opt/machinery-crm-v108-release
```

部署脚本路径：

```bash
/opt/crm_deploy_now.sh
```

历史部署包放置位置：

```bash
/opt/*.tar.gz
```

PM2 服务名通常为：

```bash
machinery-crm
```

## 二、部署原则

每次部署都必须遵守：

1. 先确认当前 CRM/ERP 能正常访问。
2. 先备份项目目录。
3. 先备份数据库。
4. 确认部署包是最新包，不要让旧包因修改时间较新被脚本误选。
5. 执行部署脚本。
6. 重启 PM2。
7. 检查 PM2 状态。
8. 检查网页是否能访问。
9. 检查关键功能。
10. 出问题立即回滚。

## 三、强制禁止命令

生产环境禁止执行：

```bash
prisma migrate reset
```

```bash
prisma migrate reset --force
```

```bash
pnpm prisma migrate reset
```

```bash
npm run db:reset
```

```bash
rm -rf /opt/machinery-crm-v108-release
```

```bash
rm -rf /opt/machinery-crm-uploads
```

```bash
DROP DATABASE
```

```bash
TRUNCATE
```

除非明确处于测试环境，否则任何清空、重置、删除类命令都必须视为高风险。

## 四、数据库变更原则

正式服务器上数据库变更优先通过确认过的 SQL 执行。

原因：

- standalone 部署包里 Prisma CLI/engines 可能不完整。
- 低配置服务器直接跑迁移或构建容易出问题。
- 生产数据库不能承受试错式迁移。

正确做法：

1. Codex 提供 SQL。
2. AI 审查 SQL。
3. 确认 SQL 不含 DROP / TRUNCATE / DELETE。
4. 备份数据库。
5. 通过宝塔数据库导入或命令行执行。
6. 执行后检查表结构。
7. 再部署代码。

## 五、GitHub Actions 构建原则

历史经验：

- 服务器配置低时，`pnpm build` 可能卡死或导致服务异常。
- 正确方式是 GitHub Actions 云端构建 standalone tarball。
- 服务器只负责解压、恢复 `.env`、重启服务。
- 构建中可能关闭 TypeScript/ESLint 阻断，以避免构建失败，但代码上线前必须人工审查。

## 六、部署脚本注意事项

历史部署脚本可能会自动选择 `/opt/` 下修改时间最新的 `.tar.gz` 包。

因此部署前必须：

1. 清理旧包或移走旧包；
2. 确认新包名字；
3. 确认新包修改时间；
4. 防止旧包被误部署。

## 七、宝塔面板与 CRM 服务区别

必须分清：

- CRM 访问异常：业务系统问题，优先处理。
- 宝塔面板打不开：可能只是管理面板卡住，不代表 CRM 挂了。

宝塔面板可尝试重启：

```bash
bt restart
```

但执行前先确认 CRM 是否能访问。

## 八、常用检查命令

检查 PM2：

```bash
pm2 list
```

查看日志：

```bash
pm2 logs machinery-crm --lines 80
```

重启服务：

```bash
pm2 restart machinery-crm
```

查看 Nginx 状态：

```bash
systemctl status nginx
```

重启 Nginx：

```bash
systemctl restart nginx
```

查看磁盘：

```bash
df -h
```

查看内存：

```bash
free -h
```

查看项目目录：

```bash
ls -lah /opt/machinery-crm-v108-release
```

## 九、`.env` 规则

`.env` 文件非常重要，通常包含：

- 数据库连接
- AUTH_SECRET
- 地图 Key
- 其他服务密钥

规则：

1. 部署时必须保留 `.env`。
2. 不要把 `.env` 发给不可信平台。
3. 不要随意更换 `AUTH_SECRET`。
4. `.env` 权限应尽量严格。
5. 备份包中不要公开 `.env`。

## 十、上传文件规则

上传目录、合同附件、发货图片等正式业务文件必须保留。

禁止：

```bash
rm -rf uploads
```

禁止：

```bash
rm -rf /opt/machinery-crm-uploads
```

历史上 `/uploads` 公开白名单曾被识别为重大风险，后续文件访问必须走鉴权 API，不能直接无权限公开访问合同附件。

## 十一、服务器安全历史问题

历史记录中出现过：

- 宝塔安全扫描风险。
- `intel-microcode` 版本过旧。
- `cloud-init` 漏洞。
- 宝塔默认端口 8888 暴露风险。
- `/uploads` 无鉴权公开风险。
- 登录爆破防护。
- 文件权限过宽。
- 旧备份包、失败包、`.bak` 文件残留。

处理原则：

1. 不要一次性大升级全系统。
2. 先快照。
3. 再定向升级有风险的软件包。
4. 必要时重启。
5. 不要随便删除备份，先归档观察。

## 十二、遇到异常时的处理顺序

### CRM 打不开

1. 截图错误页面。
2. 检查 PM2。
3. 检查 Nginx。
4. 看 PM2 日志。
5. 看服务器资源。
6. 不要盲目重装。

### 宝塔打不开

1. 先检查 CRM 是否能访问。
2. CRM 正常，则优先重启宝塔面板。
3. 不要误判为业务事故。

### 部署后页面转圈

1. 看 PM2 是否 online。
2. 看 PM2 日志。
3. 检查 `.env` 是否保留。
4. 检查数据库字段是否已迁移。
5. 检查 Nginx 代理。
6. 准备回滚。

## 十三、给 AI / Codex 的部署要求

每次给部署方案必须包含：

1. 备份命令。
2. 部署命令。
3. 检查命令。
4. 成功标准。
5. 失败判断。
6. 回滚命令。
7. 哪些命令绝对不能执行。

不要只给“上传运行”这种模糊指令。
