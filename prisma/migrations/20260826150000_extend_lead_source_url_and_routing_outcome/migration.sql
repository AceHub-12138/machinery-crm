-- Lead source URL and routing observability hardening. Additive/compatible with existing rows.
ALTER TABLE `leads`
    MODIFY COLUMN `sourceUrl` VARCHAR(2048) NULL;

ALTER TABLE `lead_write_audits`
    ADD COLUMN `routingOutcome` ENUM(
        'ASSIGNED',
        'REGION_UNRESOLVED',
        'NO_MATCHING_ASSIGNEE',
        'MULTIPLE_MATCHING_ASSIGNEES',
        'ROUTING_UNAVAILABLE'
    ) NULL;

CREATE INDEX `lead_write_audits_routingOutcome_createdAt_idx`
    ON `lead_write_audits`(`routingOutcome`, `createdAt`);
