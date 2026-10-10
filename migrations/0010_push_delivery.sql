-- Old jobs deliberately retain NULL timings: we cannot reconstruct delivery.
ALTER TABLE push_outbox ADD COLUMN queued_at INTEGER;
ALTER TABLE push_outbox ADD COLUMN first_attempt_at INTEGER;
ALTER TABLE push_outbox ADD COLUMN last_attempt_at INTEGER;
ALTER TABLE push_outbox ADD COLUMN accepted_at INTEGER;
ALTER TABLE push_outbox ADD COLUMN receipt_token TEXT;
ALTER TABLE push_outbox ADD COLUMN receipt_at INTEGER;
ALTER TABLE push_outbox ADD COLUMN device_received_at INTEGER;
ALTER TABLE push_outbox ADD COLUMN device_shown_at INTEGER;
ALTER TABLE push_outbox ADD COLUMN device_kind TEXT;
