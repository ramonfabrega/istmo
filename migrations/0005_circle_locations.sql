ALTER TABLE checkins ADD COLUMN latitude REAL;
ALTER TABLE checkins ADD COLUMN longitude REAL;
ALTER TABLE checkins ADD COLUMN accuracy REAL;
ALTER TABLE checkins ADD COLUMN located_at INTEGER;
CREATE TABLE gathering_places (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES family_groups(id),
  name TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX gathering_places_group ON gathering_places(group_id);
