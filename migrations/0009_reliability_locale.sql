ALTER TABLE push_subscriptions ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';
ALTER TABLE push_outbox ADD COLUMN claim_token TEXT;
ALTER TABLE push_outbox ADD COLUMN claim_until INTEGER;
CREATE INDEX push_retention ON push_outbox(expires_at);
CREATE TABLE runtime_health (id TEXT PRIMARY KEY, checked_at INTEGER NOT NULL, state TEXT NOT NULL);
