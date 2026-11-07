-- N3 Lead 写能力紧急回收模板。
-- 先核实 __DATABASE__、__WRITER_HOST__；执行后写工具将不能正常工作。

REVOKE SELECT, INSERT ON `__DATABASE__`.`leads`
FROM 'dachuan_lead_writer'@'__WRITER_HOST__';

-- 与授权模板对称回收；dedupKey UPDATE 原本仅供 legacy 惰性迁移。
REVOKE UPDATE (`dedupKey`, `contactName`, `phone`, `email`, `sourceUrl`, `searchKeyword`, `aiScore`, `profile`, `sourceModelVersion`, `extractorVersion`, `updatedAt`)
ON `__DATABASE__`.`leads`
FROM 'dachuan_lead_writer'@'__WRITER_HOST__';

REVOKE SELECT, INSERT ON `__DATABASE__`.`lead_write_idempotencies`
FROM 'dachuan_lead_writer'@'__WRITER_HOST__';

REVOKE INSERT ON `__DATABASE__`.`lead_write_audits`
FROM 'dachuan_lead_writer'@'__WRITER_HOST__';

REVOKE SELECT (`id`, `role`, `territories`, `isActive`)
ON `__DATABASE__`.`users`
FROM 'dachuan_lead_writer'@'__WRITER_HOST__';

SHOW GRANTS FOR 'dachuan_lead_writer'@'__WRITER_HOST__';
