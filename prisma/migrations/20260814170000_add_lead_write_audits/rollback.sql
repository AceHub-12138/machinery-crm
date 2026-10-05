-- DESTRUCTIVE: export lead_write_audits first. Normal code rollback keeps this table and its audit evidence.
DROP TABLE `lead_write_audits`;
