CREATE TABLE push_subscriptions (id TEXT PRIMARY KEY, subscription TEXT NOT NULL, token_hash TEXT NOT NULL, source TEXT NOT NULL, min_magnitude REAL NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE push_outbox (id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id), payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', last_error TEXT);
CREATE INDEX push_due ON push_outbox(status,next_attempt);
