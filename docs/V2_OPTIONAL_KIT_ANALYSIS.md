# DachuanPro 2.0 选配项与齐套检查审计

## 现有源码事实

- 合同明细 `ContractItem` 以 `itemType: MAIN | OPTIONAL` 保存产品、数量、报价/合同价和产品名称/型号快照；产品也有 `ProductType: MAIN | OPTIONAL`。
- 生产工单 `ProductionOrder` 保存单一 `productId`、主产品快照、`bomId/bomVersionSnapshot`、`quantity` 与可空 `configuration Json`；工单创建和齐套逻辑以该 BOM 为基础。
- `BomHeader` 按产品与版本维护，现有源码没有证明 OPTIONAL 产品已绑定 BOM，`configuration` 的 JSON shape 也没有可执行的选配物料口径。
- `KitCheckResult` 保存 status、shortageCount、totalMaterials、detail JSON 和 BOM 版本快照；没有 `includesOptional` 或选配来源快照字段。
- 采购需求由齐套结果生成并追溯到工单/齐套结果/物料；把未结构化选配备注直接混入会造成需求重复和历史不可复算。

## 结论与推荐方案

本次不实现“选配项自动参与齐套”，也不修改 schema。当前齐套结果 UI 应在阶段 3/4 显式显示“是否包含选配项：否”，并提示“本次齐套检查未包含非结构化选配备注”。

后续若业务确认，推荐以**工单创建时冻结的结构化选配配置快照**为唯一来源：合同 OPTIONAL 明细 → 受版本控制的选配 BOM → 按合同/工单数量折算 → 与主产品 BOM 按 materialId 合并 → 写入工单物料快照 → 齐套和采购需求只读取快照。数量采用 Decimal，合并前保留主/选配来源以便追溯；缺料采购需求沿用现有 source allocation，不能按备注重复生成。

## 必须先确认的业务问题

1. 哪些选配产品具有可维护 BOM，哪些仅为文本服务/附件？
2. 选配数量是每台设备、合同总量还是可独立拆分？
3. 同一物料同时出现在主/选配 BOM 时，是否相加，是否允许替代料？
4. 历史合同与既有齐套结果是否只保留“未包含”标记，而不回填重算？
5. 选配采购需求是否需要独立责任人、交期或审批？

这些问题未确认前，禁止新增选配齐套表、批量重算历史结果或改变现有采购来源分摊。
