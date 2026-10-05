-- 回滚 AI 获客助手两张新表（先删子表再删主表；不影响任何既有表）
DROP TABLE IF EXISTS `lead_hunt_candidates`;
DROP TABLE IF EXISTS `lead_hunt_tasks`;
