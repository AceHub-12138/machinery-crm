-- N3 Lead 写账号最小权限模板。
-- 先在 phpMyAdmin 中把 __DATABASE__、__WRITER_HOST__ 替换为已核实的实际值。
-- 本模板不创建账号、不设置密码，也不授予任何全局、库级或其他表权限。

GRANT SELECT, INSERT ON `__DATABASE__`.`leads`
TO 'dachuan_lead_writer'@'__WRITER_HOST__';

-- dedupKey 的 UPDATE 仅供新版命中旧 company+phone+email 指纹时执行惰性迁移；
-- 其余列只用于同企业合并，仍不得获得表级 UPDATE。
GRANT UPDATE (`dedupKey`, `contactName`, `phone`, `email`, `sourceUrl`, `searchKeyword`, `aiScore`, `profile`, `sourceModelVersion`, `extractorVersion`, `updatedAt`)
ON `__DATABASE__`.`leads`
TO 'dachuan_lead_writer'@'__WRITER_HOST__';

GRANT SELECT, INSERT ON `__DATABASE__`.`lead_write_idempotencies`
TO 'dachuan_lead_writer'@'__WRITER_HOST__';

GRANT INSERT ON `__DATABASE__`.`lead_write_audits`
TO 'dachuan_lead_writer'@'__WRITER_HOST__';

-- 自动分配只读取启用状态、销售角色和既有 territories；不得读取密码或修改用户。
GRANT SELECT (`id`, `role`, `territories`, `isActive`)
ON `__DATABASE__`.`users`
TO 'dachuan_lead_writer'@'__WRITER_HOST__';

SHOW GRANTS FOR 'dachuan_lead_writer'@'__WRITER_HOST__';
