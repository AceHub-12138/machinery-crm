# Lead 联系方式反查 v1：FastGPT Prompt 与数据契约补丁

## 1. 适用范围与当前状态

本文件是 `n8n/workflows/baidu-lead-contact-enrichment-v1.json` 的离线 FastGPT 配置契约。它只描述后续由管理员在 FastGPT UI 中创建的两个独立 Agent：

- Contact Query Planner：只为 Round 2 / Round 3 生成下一条搜索 Query；
- Contact Verifier：只基于本轮搜索证据验证候选联系方式和企业归属。

本分支没有修改运行中的 FastGPT，也没有修改线上 N8N、Credential、App ID 或模型配置。workflow 中的 `REPLACE_FASTGPT_*` 均为必须由审核方后续人工绑定的占位符。导入后必须保持停用，不能把本文件视为已经上线的证明。

## 2. 共同安全边界

- FastGPT/N8N 只提供线索事实和公开搜索证据，不得指定 `assignedUserId`。
- 禁止直接生成或猜测 phone、email、contactName、province、city。
- Planner 每轮只能返回一条 Query；不能返回多个备选 Query。
- Verifier 只能从 N8N Code 节点提供的 `candidatePhones` / `candidateEmails` 中选择值。
- 无法证明联系方式属于目标企业时必须拒绝，宁可输出 `verified=false`。
- province/city 只能来自同一条可核查搜索证据；公司名称、原搜索关键词和模型常识不能单独作为地域依据。
- province 使用中国标准省级全称；city 使用标准地级市、自治州、地区或盟名称；国外企业的 province 使用 `国外`，city 为 `null`。

## 3. Contact Query Planner

### 3.1 输入

N8N 每次只传一个 JSON 对象，字段为：

```json
{
  "companyName": "目标企业全称",
  "industry": "行业或 null",
  "businessScope": ["业务范围或 null"],
  "province": "标准省级全称或 null",
  "city": "标准地级市名称或 null",
  "sourceUrl": "原始来源 URL 或 null",
  "searchKeyword": "原始获客关键词或 null",
  "previousQueries": ["已经执行过的 Query"],
  "previousResults": [
    {
      "title": "上一轮标题",
      "url": "上一轮 URL",
      "domain": "上一轮域名",
      "snippet": "上一轮摘要"
    }
  ],
  "contactSearchRound": 2
}
```

### 3.2 System Prompt（准确应用）

```text
你是大川机床高价值企业联系方式搜索规划器。你的唯一任务是根据输入事实和上一轮搜索证据，为当前目标企业生成下一条高精度百度搜索 Query。

只允许在 OFFICIAL_CONTACT、PHONE、EMAIL、BUSINESS_DIRECTORY、REGION_DISAMBIGUATION 五种 strategy 中选择一种。优先官网和联系我们页面；当上一轮策略已经无效时必须切换信息路径，禁止机械重复 previousQueries。存在同名企业时必须使用输入中已经存在且可信的标准 province/city 做消歧；没有可信地域时不得猜测。

禁止输出或猜测任何 phone、email、contactName、province、city。禁止返回多个 Query、解释、Markdown、代码围栏或额外字段。必须只返回符合 contact-query-plan-v1 JSON Schema 的一个 JSON 对象。
```

### 3.3 严格 JSON Schema

```json
{
  "name": "contact-query-plan-v1",
  "strict": true,
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["query", "strategy"],
    "properties": {
      "query": {
        "type": "string",
        "minLength": 1,
        "maxLength": 191
      },
      "strategy": {
        "type": "string",
        "enum": [
          "OFFICIAL_CONTACT",
          "PHONE",
          "EMAIL",
          "BUSINESS_DIRECTORY",
          "REGION_DISAMBIGUATION"
        ]
      }
    }
  }
}
```

建议使用 temperature `0`。Round 1 不调用本 Agent，由 N8N 确定性生成：

```text
{companyName} {可信 province} {可信 city} 电话 邮箱 联系方式 官网
```

## 4. Contact Verifier

### 4.1 输入

只有 N8N Code 节点已经找到至少一个候选 phone/email 时才调用。输入至少包含：

```json
{
  "targetCompanyName": "目标企业全称",
  "province": "已有可信省份或 null",
  "city": "已有可信城市或 null",
  "targetProfile": {},
  "candidatePhones": [
    {
      "value": "0537-1234567",
      "resultTitle": "页面标题",
      "resultUrl": "https://example.com/contact",
      "resultContent": "页面摘要"
    }
  ],
  "candidateEmails": [],
  "searchResults": [],
  "contactSearchRound": 1
}
```

### 4.2 System Prompt（准确应用）

```text
你是大川机床企业联系方式证据核验器。你只能根据输入中的目标企业、候选联系方式、页面标题、URL/域名和页面摘要判断候选是否明确属于 targetCompanyName。

verified=true 必须同时满足：目标企业名称或可唯一识别的官方主体与候选联系方式出现在同一条可信证据中；companyMatched=true；返回的 phone/email 必须逐字对应输入候选（允许仅格式化空格或横杠）；evidence 必须指出页面和归属依据。

以下证据必须拒绝：1688 聚合页中其他商家联系方式、新闻作者电话、平台客服电话、百度/1688/企业黄页客服电话、同名不同地区企业、上下游合作企业、经销商电话冒充厂家电话、没有企业名称上下文的孤立号码、仅凭常识或公司名称猜测的联系方式。

只有页面证据同时明确给出企业所在地时才可返回标准 province/city。不得仅凭公司名称、搜索词、区号或模型常识推断地域。不能证明时必须返回 verified=false、companyMatched=false，phone/email/province/city 全部为 null，并在 evidence 说明拒绝原因。

禁止输出解释、Markdown、代码围栏或额外字段。必须只返回符合 contact-verifier-v1 JSON Schema 的一个 JSON 对象。
```

### 4.3 严格 JSON Schema

```json
{
  "name": "contact-verifier-v1",
  "strict": true,
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "verified",
      "companyMatched",
      "phone",
      "email",
      "province",
      "city",
      "evidence"
    ],
    "properties": {
      "verified": { "type": "boolean" },
      "companyMatched": { "type": "boolean" },
      "phone": { "type": ["string", "null"] },
      "email": { "type": ["string", "null"] },
      "province": { "type": ["string", "null"] },
      "city": { "type": ["string", "null"] },
      "evidence": {
        "type": "string",
        "minLength": 1,
        "maxLength": 1000
      }
    }
  }
}
```

建议使用 temperature `0`。N8N 在 Agent 之后仍会做第二次确定性校验：选中的联系方式必须存在于候选数组；平台域名上的平台客服/热线会被拒绝；地域格式不符合标准全称时不会回填。

## 5. 搜索预算和失败语义

集中配置默认值：

```text
contact_search_enabled = true
contact_search_score_threshold = 90
contact_search_max_rounds = 3
contact_search_top_k = 5
```

判定是严格 `aiScore > contact_search_score_threshold`。workflow 显式展开三个 Round；每个百度 HTTP Request 前都有 `contactSearchRound < contactSearchMaxRounds` 预算门，且代码把最大轮数硬限制为 3。Round 2 成功后不会进入 Round 3。

单条 Lead 状态包括：

- `CONTACT_SEARCH_NOT_REQUIRED`
- `CONTACT_SEARCH_STARTED`
- `CONTACT_NOT_FOUND`
- `CONTACT_NOT_VERIFIED`
- `CONTACT_ENRICHMENT_EXHAUSTED`
- `CONTACT_SEARCH_API_ERROR`
- `CONTACT_QUERY_PLANNER_INVALID_OUTPUT`
- `CONTACT_VERIFIER_INVALID_OUTPUT`
- `CONTACT_SEARCH_VERIFIED`

这些状态只终止当前 Lead 的 enrichment 分支，不抛出错误终止整个 workflow。

## 6. 地域回填和自动分配衔接

Verifier 成功且证据明确时，N8N 合并而不是替换现有 profile：

```json
{
  "profile": {
    "existing": "保留",
    "province": "山东省",
    "city": "济宁市"
  }
}
```

该结构与 N5 `resolveLeadAssignee` 的消费契约一致。CRM 服务端仍会使用正式标准省市表再次校验；未知、简称或省市不一致的值不会触发自动分配。

## 7. 后续人工配置清单（本分支不执行）

1. 在 FastGPT UI 创建两个独立高级编排应用，分别应用本文件 Planner/Verifier Prompt 与 JSON Schema。
2. 将模型版本、temperature、最大 Token 和 App ID 记录到变更单。
3. 在目标 N8N 环境导入新 workflow，重新绑定百度、Planner、Verifier、原 Lead Agent 和 Lead Ingestor Credential。
4. 替换 `REPLACE_FASTGPT_LEAD_AGENT_APP_ID`、`REPLACE_FASTGPT_QUERY_PLANNER_APP_ID` 与 `REPLACE_FASTGPT_CONTACT_VERIFIER_APP_ID`。
5. 保持 workflow 停用，使用隔离测试数据完成 16 个验收用例后再单独申请启用。
