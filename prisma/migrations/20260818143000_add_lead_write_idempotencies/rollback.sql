-- Destructive to post-migration idempotency receipts.
-- Production code rollback should normally leave this additive table in place.
DROP TABLE `lead_write_idempotencies`;
