-- Initial catalog imports and older history are never new-report signals.
ALTER TABLE reports ADD COLUMN new_report_at INTEGER;
