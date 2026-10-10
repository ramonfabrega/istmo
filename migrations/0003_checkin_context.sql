ALTER TABLE family_groups ADD COLUMN incident_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE checkins ADD COLUMN incident_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE checkins ADD COLUMN meeting_point TEXT NOT NULL DEFAULT '';
UPDATE checkins SET meeting_point = COALESCE((SELECT meeting_point FROM family_groups WHERE id=checkins.group_id), '');
