-- 回滚：删除小川知识库三张表（纯新增表，删除不影响任何业务数据）。
-- ⚠️ 执行前如需保留已导入的知识数据，请先用宝塔导出这三张表备份。
DROP TABLE IF EXISTS `nc_program_templates`;
DROP TABLE IF EXISTS `process_rule_cards`;
DROP TABLE IF EXISTS `machine_capabilities`;
