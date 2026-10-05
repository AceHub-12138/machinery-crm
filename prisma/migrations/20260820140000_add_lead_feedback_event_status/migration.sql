-- Preserve the status of each immutable human feedback event.
-- Nullable keeps pre-existing events valid without inventing historical state.
ALTER TABLE `lead_feedback_events`
    ADD COLUMN `reviewStatus` ENUM('PENDING', 'HIGH_INTENT', 'MID_INTENT', 'LOW_INTENT', 'INVALID') NULL;
