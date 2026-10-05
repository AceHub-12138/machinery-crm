# Lead 评分画像 Prompt v1

## 1. 目标与模型边界

本 Prompt 用于对一条已经由 N8N 清洗过的线索做首轮评分和画像。当前推荐模型为 DeepSeek，但接口不绑定模型厂商；后续可在 FastGPT 面板切换其他支持严格 JSON 输出的模型。

模型只生成候选评分，不负责去重、不查询 `lead_list`、不生成幂等键，也不能直接接触 MCP 签发私钥。写入仍必须经过 FastGPT 服务端 SERVICE 断言和 `lead_upsert`。

## 2. 版本

- Prompt/解析契约：`lead-score-v1`
- `extractorVersion`：固定填写 `lead-score-v1`
- `sourceModelVersion`：填写实际模型及版本，例如 `deepseek-chat@2026-08`；更换模型时必须同步修改，不得继续沿用旧值。

## 3. System Prompt

```text
你是大川机床线索评分器。只评估输入的一条线索，禁止输出解释、Markdown 或代码围栏。必须返回符合 lead-score-v1 的单个 JSON 对象。

总分为 0-100 整数：
1. 行业匹配 0-30：机械制造、金属加工、设备采购等与大川机床业务的匹配程度。
2. 需求信号 0-30：询价、采购、扩产、设备更新、项目招标等明确程度。
3. 企业规模 0-20：公开内容体现的产能、人员、厂房、业务覆盖和采购能力。
4. 可联系性 0-20：联系人、电话、邮箱等信息的完整性和可信度。

profile 必须包含 industry、intent、scale、contactability、confidence、reason 六个非空字符串。reason 简洁说明四维评分依据。仅在输入能可靠提取时输出 contactName、phone、email，禁止猜测。
```

## 4. 严格输出契约

唯一允许的顶层结构：

```json
{
  "aiScore": 86,
  "profile": {
    "industry": "金属加工",
    "intent": "明确询价",
    "scale": "中型制造企业",
    "contactability": "电话和邮箱完整",
    "confidence": "high",
    "reason": "行业匹配且存在明确采购信号"
  },
  "contactName": "可选",
  "phone": "可选",
  "email": "可选"
}
```

约束：

- `aiScore` 必须是 0～100 的整数。
- `profile` 六个字段全部必填，且只能是非空字符串。
- 联系人、电话和邮箱无法可靠提取时必须省略，不能输出空字符串或猜测值。
- 禁止顶层或 profile 增加 Prompt、Key、Token、Assertion、Authorization、Cookie 等字段。
- 禁止自由文本、Markdown 围栏和 JSON 前后说明。
- 任一字段不合法时，FastGPT 校验节点终止工作流，`lead_upsert` 不得执行。

## 5. FastGPT 参数

- 单轮评分，历史轮数设为 `0`。
- `temperature=0` 或模型支持的最低稳定值。
- `max_tokens=600`；若实际模型把推理 token 单独计量，仍应限制最终输出长度。
- 关闭图片、音频、视频、文件提取和推理文本输出。
- 优先选择模型原生 JSON Schema/JSON Object 模式。
- 导入 `deploy/fastgpt/v4.15.1/workflows/lead-score-agent-v1.json` 后，必须在面板重新选择实际模型并填写 `sourceModelVersion`。评分应用没有 MCP 工具，也不得加入 SERVICE 签发 allowlist。
- `deploy/fastgpt/v4.15.1/workflows/lead-write-agent-v1.json` 只接收已锁定的评分页，整页校验后一次调用 N3 `lead_upsert`；只有写应用可以加入 SERVICE 签发 allowlist。

## 6. 数据保护

Prompt 只属于 FastGPT 工作流配置，不写入 DachuanPro 的 `leads` 或 `lead_write_audits`。写入 profile 只能包含上述业务画像字段；任何模型凭据、Prompt、断言或完整请求头都不得进入工作流输出、CRM 数据库或日志。
