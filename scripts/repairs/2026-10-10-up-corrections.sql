-- One-time audited repair; see docs/catalog-audit-2026-10-10.md.
-- Execute as ONE atomic D1 command/import, never statement by statement.
-- Guards reject changed records, repeat application, or an active UP collector.
-- The original export must be backed up before running this file.
CREATE TABLE _up_repair_pairs (
  old_id TEXT PRIMARY KEY, keep_id TEXT UNIQUE, first_seen INTEGER,
  replaced_at INTEGER, old_fingerprint TEXT, keep_fingerprint TEXT,
  old_revision INTEGER, keep_revision INTEGER
);
INSERT INTO _up_repair_pairs VALUES
('up:1791613634000','up:1791613631000',1791613769177,1791613829393,'9fa58a73f374129a06d8cb6b88d62fb68f05a3084d8308abadb9c93f3dbf4622','1496fad5b02b51d5cc3088270eb875ec3564e83118300deb7442bf451451ab3a',1,2),
('up:1791613792000','up:1791613801000',1791614185979,1791614542278,'78556bf741f6cb9c68a99415e915ca4b0097e940a21eb5a0c7a319d99f391640','b02062a3df506a06e150f5447ce19529e3ca0069ce9f7d3021dd0bca3ac60d1b',1,1),
('up:1791614870000','up:1791614869000',1791615082073,1791615502090,'07a556c9c17b596d7a58fb33bcce42e2516181bd88ebfa4389a6ca9e81b6a9e9','b46ad7e9f3f3e0fefc91bfb38e4f8fa0810ea02939d0f3b8d5a2b7d710b4d981',1,1);
CREATE TABLE _up_repair_guard (ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO _up_repair_guard SELECT NOT EXISTS (
  SELECT 1 FROM collection_leases WHERE source='up' AND expires_at >= unixepoch()*1000
);
INSERT INTO _up_repair_guard SELECT count(*)=3
FROM _up_repair_pairs p
JOIN reports a ON a.id=p.old_id JOIN reports b ON b.id=p.keep_id
WHERE a.source='up' AND b.source='up'
  AND a.first_seen=p.first_seen AND a.withdrawn_at=p.replaced_at
  AND b.first_seen=p.replaced_at AND b.withdrawn_at IS NULL
  AND a.fingerprint=p.old_fingerprint AND b.fingerprint=p.keep_fingerprint
  AND a.revision=p.old_revision AND b.revision=p.keep_revision
  AND (SELECT count(*) FROM report_revisions WHERE report_id=a.id)=a.revision
  AND (SELECT count(*) FROM report_revisions WHERE report_id=b.id)=b.revision;
CREATE TABLE _up_repair_history AS
SELECT p.keep_id AS report_id,
  row_number() OVER (PARTITION BY p.keep_id ORDER BY r.observed_at,r.report_id,r.revision) AS revision,
  r.observed_at,r.payload
FROM _up_repair_pairs p JOIN report_revisions r ON r.report_id IN (p.old_id,p.keep_id);
-- Preserve every payload and its original observation time; keep the active ID.
DELETE FROM report_revisions WHERE report_id IN (
  SELECT old_id FROM _up_repair_pairs UNION SELECT keep_id FROM _up_repair_pairs
);
INSERT INTO report_revisions SELECT report_id,revision,observed_at,payload FROM _up_repair_history;
UPDATE reports AS b SET
  first_seen=(SELECT a.first_seen FROM _up_repair_pairs p JOIN reports a ON a.id=p.old_id WHERE p.keep_id=b.id),
  new_report_at=(SELECT a.new_report_at FROM _up_repair_pairs p JOIN reports a ON a.id=p.old_id WHERE p.keep_id=b.id),
  revision=(SELECT count(*) FROM report_revisions WHERE report_id=b.id)
WHERE id IN (SELECT keep_id FROM _up_repair_pairs);
DELETE FROM reports WHERE id IN (SELECT old_id FROM _up_repair_pairs);
DROP TABLE _up_repair_history;
DROP TABLE _up_repair_guard;
DROP TABLE _up_repair_pairs;
