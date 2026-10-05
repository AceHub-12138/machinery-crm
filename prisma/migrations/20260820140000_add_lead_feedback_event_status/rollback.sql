-- Roll back only the field introduced by this migration.
ALTER TABLE `lead_feedback_events`
    DROP COLUMN `reviewStatus`;
