-- Circles persist. Check-ins are a timeline, not an incident-scoped board.
ALTER TABLE checkins RENAME COLUMN incident TO context;
ALTER TABLE checkins DROP COLUMN incident_version;
ALTER TABLE family_groups DROP COLUMN incident;
ALTER TABLE family_groups DROP COLUMN incident_version;
ALTER TABLE members ADD COLUMN person_id TEXT REFERENCES people(id);
ALTER TABLE members ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
UPDATE members SET role='owner' WHERE id=(SELECT m.id FROM members m WHERE m.group_id=members.group_id ORDER BY m.created_at,m.id LIMIT 1);
UPDATE members SET person_id=(SELECT p.id FROM people p WHERE p.group_id=members.group_id AND p.name=members.name ORDER BY p.id LIMIT 1);
INSERT INTO people(id,group_id,name) SELECT 'member-'||id,group_id,name FROM members WHERE person_id IS NULL;
UPDATE members SET person_id='member-'||id WHERE person_id IS NULL;
CREATE TABLE circle_invites (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES family_groups(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX circle_invites_group ON circle_invites(group_id,created_at DESC);
INSERT INTO circle_invites(id,group_id,token_hash,created_by,created_at,expires_at)
  SELECT 'legacy-'||g.id,g.id,g.invite_hash,m.id,g.created_at,unixepoch('now')*1000+604800000
  FROM family_groups g JOIN members m ON m.group_id=g.id AND m.role='owner';
CREATE INDEX checkins_person_latest ON checkins(group_id,person_id,kind,contacted_at DESC,created_at DESC);
