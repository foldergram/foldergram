-- migrate:up
-- Before 000011, local captions had no provenance. Preserve non-null captions
-- that have not been attributed to a sidecar or a later explicit edit. Use the
-- upgrade time as a conservative boundary, not an invented historical edit time.
UPDATE posts
SET caption_edited_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE caption IS NOT NULL
  AND caption_edited_at IS NULL
  AND companion_caption IS NULL
  AND source_id IN (SELECT id FROM media_sources WHERE kind = 'local');

-- migrate:down
-- Provenance cannot safely be distinguished from subsequent manual edits.
SELECT 1;
