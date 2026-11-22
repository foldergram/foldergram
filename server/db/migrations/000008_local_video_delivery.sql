-- migrate:up
ALTER TABLE images ADD COLUMN video_delivery_policy TEXT
  CHECK (video_delivery_policy IN ('legacy', 'streaming', 'previews'));
ALTER TABLE images ADD COLUMN video_metadata_json TEXT;

UPDATE images SET video_delivery_policy = 'legacy'
WHERE media_type = 'video'
  AND source_id IN (SELECT id FROM media_sources WHERE kind = 'local');

-- migrate:down
-- The policy is part of the indexed video's playback history.
SELECT local_video_delivery_requires_backup_restore();
