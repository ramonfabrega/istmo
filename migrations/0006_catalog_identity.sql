-- UP publishes a rolling snapshot without immutable event IDs. Keep withdrawn
-- rows for audit, but omit them from the active catalog.
ALTER TABLE reports ADD COLUMN withdrawn_at INTEGER;
CREATE TABLE collection_leases (source TEXT PRIMARY KEY REFERENCES sources(id), token TEXT NOT NULL, expires_at INTEGER NOT NULL);
