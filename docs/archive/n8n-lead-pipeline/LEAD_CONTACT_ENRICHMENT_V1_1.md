# Lead 联系方式反查 v1.1：目标补全与关联潜客派生契约

## 1. 版本范围

本文件对应默认停用的 `n8n/workflows/baidu-lead-contact-enrichment-v1.1.json`。v1.1 在 v1 的三轮搜索预算内增加关联潜在客户识别，不覆盖 N4 或 v1 归档。

本分支没有修改运行中的 FastGPT 或 N8N，没有绑定 Credential/App ID，也没有启用 workflow。所有 `REPLACE_*` 值必须在后续独立部署审批中人工配置。

## 2. 三分类定义

### `DIRECT_CONTACT`

联系方式明确属于原 `targetCompanyName`。只有该分类可以把 phone/email 回填到原 validatedLead。

必须满足：

- `matchedCompanyName` 与原目标企业一致；
- `relationshipType = TARGET`；
- phone/email 来自 N8N Code 节点实际提取的候选；
- 联系方式、目标企业名称和 `evidenceUrl` 属于同一条证据；
- 摘要必须且只能包含 1 条完整证据句，并严格匹配“目标企业全称 + 一个或多个（类型匹配的联系字段标签 + 已提取候选值）”；phone 只接受电话/手机标签，email 只接受邮箱/email 标签；合法二者可在同一句中按任意顺序同时出现，标签和值互换则拒绝；不接受无标签值，也不允许额外的获奖、澄清、停用或其他主体句；逗号不是安全句界，包含中英文问号时一律拒绝；
- 不得把其他企业、作者或平台联系方式写到原企业名下。

### `RELATED_OPPORTUNITY`

联系方式属于另一家明确命名的经销商、代理商、上下游或关联企业。摘要必须且只能包含 3 条完整受控事实句：关系、机会、联系方式；多出的停用、否定、澄清或第三方归属句会整条拒绝。`opportunityEvidence` 必须逐字等于机会句，机会句尾只允许受控机床、设备、生产线、车间等业务词汇，不允许任意尾部文本；逗号不作为安全句界，包含中英文问号时一律拒绝。

允许的关系类型：

- `DEALER`
- `AGENT`
- `UPSTREAM`
- `DOWNSTREAM`
- `RELATED_COMPANY`

允许的机会类型：

- `MANUFACTURING_CAPABILITY`：明确制造、生产、机加工或车间能力；
- `MACHINING_DEMAND`：明确切削、齿轮、金属、模具或零部件加工需求；
- `EQUIPMENT_PURCHASE`：明确采购、求购、招标、购置、询价或设备需求；
- `CAPACITY_EXPANSION`：明确扩产、扩建、新生产线、车间或产能增加；
- `TECHNICAL_UPGRADE`：明确技改、技术改造、设备升级或自动化改造。

不能仅因为是经销商或代理商就输出 RELATED_OPPORTUNITY。只有“经销/代理关系”而没有上述制造、加工、设备需求、扩产或技改证据时必须输出 `REJECT`。

### `REJECT`

以下情况必须丢弃：

- 平台客服电话或平台热线；
- 新闻记者、作者、编辑、通讯员或投稿联系方式；
- 无关企业；
- 同名但无法确认地区/主体的企业；
- 上下游、经销商或代理商只有关系证据，没有机床潜客价值证据；
- 联系方式无法与明确企业主体绑定；
- 任何依赖常识猜测而不是搜索证据的结论。

`REJECT` 的 phone/email/province/city/evidenceUrl/opportunityType/opportunityEvidence 必须全部为 `null`。

## 3. Contact Verifier v1.1 System Prompt

```text
你是大川机床企业联系方式与关联潜客证据核验器。你只能使用输入中的目标企业、候选 phone/email、搜索结果标题、URL/domain 和摘要做判断，不得凭常识猜测。

必须且只能返回 DIRECT_CONTACT、RELATED_OPPORTUNITY 或 REJECT：

DIRECT_CONTACT：联系方式明确属于原 targetCompanyName。matchedCompanyName 必须是原目标企业，relationshipType 必须为 TARGET。只有搜索证据中存在完整“目标企业全称 + 联系字段标签 + 具体 phone/email”分句时才允许补全原 Lead；contactEvidence 应引用该完整分句。

RELATED_OPPORTUNITY：联系方式属于另一家明确命名的企业。搜索证据必须包含一条完整、无多余澄清或否定语义、严格连接原 targetCompanyName 与该企业的受控关系分句；opportunityEvidence 必须逐字复制另一条以该企业全称开头的受控制造、采购、扩产或技改主动表达分句。relationshipType 只能为 DEALER、AGENT、UPSTREAM、DOWNSTREAM、RELATED_COMPANY；opportunityType 只能为 MANUFACTURING_CAPABILITY、MACHINING_DEMAND、EQUIPMENT_PURCHASE、CAPACITY_EXPANSION、TECHNICAL_UPGRADE。不能仅因为是经销商或代理商就输出 RELATED_OPPORTUNITY，也不能截取否定句局部或把第三方动作误认为该企业机会。

REJECT：平台客服、新闻作者/记者/编辑联系方式、无关企业、无法证明归属、同名主体不明确，或只有经销/关联关系但没有明确机床潜客证据。

phone/email 必须逐值来自输入候选；evidenceUrl 必须来自输入搜索结果。province/city 只有同一证据明确证明时才可返回标准全称。禁止输出解释、Markdown、额外字段或多个企业。每轮最多返回一个分类结果。
```

## 4. 严格 JSON Schema

```json
{
  "name": "contact-verifier-v1-1",
  "strict": true,
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "classification",
      "matchedCompanyName",
      "relationshipType",
      "opportunityType",
      "phone",
      "email",
      "province",
      "city",
      "evidenceUrl",
      "contactEvidence",
      "opportunityEvidence"
    ],
    "properties": {
      "classification": {
        "type": "string",
        "enum": ["DIRECT_CONTACT", "RELATED_OPPORTUNITY", "REJECT"]
      },
      "matchedCompanyName": { "type": ["string", "null"] },
      "relationshipType": {
        "type": "string",
        "enum": [
          "TARGET",
          "DEALER",
          "AGENT",
          "UPSTREAM",
          "DOWNSTREAM",
          "RELATED_COMPANY",
          "PLATFORM",
          "UNRELATED",
          "UNKNOWN"
        ]
      },
      "opportunityType": {
        "type": ["string", "null"],
        "enum": [
          "MANUFACTURING_CAPABILITY",
          "MACHINING_DEMAND",
          "EQUIPMENT_PURCHASE",
          "CAPACITY_EXPANSION",
          "TECHNICAL_UPGRADE",
          null
        ]
      },
      "phone": { "type": ["string", "null"] },
      "email": { "type": ["string", "null"] },
      "province": { "type": ["string", "null"] },
      "city": { "type": ["string", "null"] },
      "evidenceUrl": { "type": ["string", "null"] },
      "contactEvidence": { "type": "string", "minLength": 1, "maxLength": 1000 },
      "opportunityEvidence": { "type": ["string", "null"], "maxLength": 1000 }
    }
  }
}
```

建议 temperature 使用 `0`。

## 5. 派生 Lead 重新评分与事实锁定

派生 Lead 必须重新调用现有 Lead Agent 评分，不能直接继承原目标 Lead 的 aiScore。

评分输入包括：

- 关联企业明确全称；
- 已验证 phone/email；
- `evidenceUrl`、页面标题和摘要；
- `relationshipType`；
- `opportunityType`；
- `contactEvidence`；
- `opportunityEvidence`。

评分完成后 N8N 再次锁定事实：

- companyName 强制使用 Verifier 的 `matchedCompanyName`；
- phone/email 强制使用 Verifier 已验证候选；
- 模型不得用另一家公司或平台联系方式覆盖；
- `aiScore >= 80` 且至少一个有效 phone/email 才允许写入；
- profile 记录 `leadOrigin=RELATED_OPPORTUNITY`、原目标企业、关系类型、机会类型和两类证据。

评分低于门槛或输出非法时，不写派生 Lead，恢复原目标 Lead 的剩余搜索 Round。

## 6. 幂等、去重和预算

- 派生 Lead 继续使用既有 canonical payload、SHA-256、`lead-idempotency-v2`、Lead MCP 和服务端 company dedup；
- 幂等键使用派生企业证据 `sourceUrl`，不加入 contactSearchRound；
- 不创建 Customer，不修改正式 Customer；
- 不扩大 SERVICE 权限；
- 每个联系方式搜索 Round 最多派生一个候选 Lead；
- 百度联系方式搜索仍物理最多 3 次；
- 派生 Lead 只重新评分，不再启动百度联系方式反查；
- 派生写入或评分淘汰后继续原目标剩余 Round，最多处理三个关联机会，不会递归或无限扩散。

## 7. 后续人工配置（本分支不执行）

1. 在 FastGPT UI 新建 Contact Verifier v1.1，应用本文件 Prompt 和 Schema。
2. 在 v1.1 workflow 中绑定 `REPLACE_FASTGPT_CONTACT_VERIFIER_V11_APP_ID` 与对应 Credential。
3. 复用已审核 Lead Agent 完成派生企业独立评分。
4. 导入后保持 workflow 停用，先用隔离数据验证三分类、评分淘汰、dedup、REPLAY 和三轮预算，再另行申请部署。

## 8. 3013 MCP 写入结果判定（人工导入验收规格）

3013 返回 HTTP 200 只表示 JSON-RPC 请求到达 MCP，不代表 `lead_upsert` 业务成功。HTTP Request 节点不会自动把 `result` 解包；导入 workflow 后必须保留生成器加入的 `Validate Lead MCP Result`，以及三条 `Related Validate Lead MCP Result R1/R2/R3` 节点。

业务成功必须同时满足：

```text
$.result.isError !== true
AND $.result.structuredContent.ok === true
AND typeof $.result.structuredContent.data.items[0].id === "string"
```

业务失败满足任一条件：

```text
$.result.isError === true
OR $.result.structuredContent.ok === false
```

缺失 `structuredContent`、缺失 `data.items[0].id` 或形态异常也必须 fail closed。禁止只根据 HTTP 200、HTTP Request 节点执行完成或 `result` 对象存在判断 Lead 已写入。生产 N8N 的导入、Credential 绑定、启用和真实节点施工不在本分支执行。

## 9. sourceUrl、地区和写结果契约

- `sourceUrl` 只接受原样、无首尾空白的 HTTP(S) URL，最大 2048 字符；191、191～2048 和 2048 均原样保留，2049 或非法 URL 在 canonical payload/hash 之前以 `INVALID_ARGUMENT` 拒绝，禁止 `slice`、`substring` 或其他静默截断。
- 最终 `profile.province` / `profile.city` 必须通过 CRM `PROVINCE_CITY_MAP` 校验：province 使用标准全称；city 如存在必须属于 province；简称、缺 province 的 city 和跨省组合不得写入。
- `lead_upsert` 继续保留 `replay`，并新增向后兼容的 `writeDisposition`：真实 `lead.create()` 为 `CREATED`，同公司新 key 的 `lead.update()` 为 `MERGED`，同 key/hash 为 `REPLAY`。
- 新建 Lead 的响应新增 `routingOutcome`：`ASSIGNED`、`REGION_UNRESOLVED`、`NO_MATCHING_ASSIGNEE`、`MULTIPLE_MATCHING_ASSIGNEES`、`ROUTING_UNAVAILABLE`；merge/replay 不重新路由，因此返回 `null`。
- `lead_write_audits.outcome` 仍只表达写幂等结果 `CREATED/REPLAY/CONFLICT`；自动分配使用独立 nullable `routingOutcome`，不得把两类语义混在同一字段。

## 10. migration 执行顺序与回滚边界（本分支不执行）

后续只有在数据库/部署获得单独授权后才能执行：先备份数据库和项目目录，并只读核对生产 `leads.sourceUrl`、`lead_write_audits` 的真实 DDL；然后先应用 additive migration，再部署依赖 `routingOutcome` 的新代码。旧代码可兼容加宽列和额外 nullable 列，而新代码在列尚不存在时无法写 audit，因此禁止先切新代码、后迁移。N8N/FastGPT 导入与启用继续使用独立审批。

默认回滚采用无损兼容方案：回退应用代码，但保留 `VARCHAR(2048)` 和 nullable `routingOutcome`；旧代码会忽略新列，不需要收窄 URL。不要直接把 `sourceUrl` 改回 191，因为一旦已有合法长 URL，收窄会失败或造成数据损失。只有完成备份且只读确认所有 `CHAR_LENGTH(sourceUrl) <= 191` 后，才可另行审批结构收窄；删除 `routingOutcome` 前也必须先导出对应审计数据。仓库未提供自动破坏性 rollback，避免误执行丢失新 URL 或路由审计。
