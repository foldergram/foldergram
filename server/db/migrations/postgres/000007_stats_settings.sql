-- migrate:up
INSERT INTO app_settings (key, value)
VALUES
  ('stat.media_count', (SELECT COALESCE(SUM(image_count), 0)::text FROM folders WHERE role = 'normal')),
  ('stat.video_count', (SELECT COALESCE(SUM(video_count), 0)::text FROM folders WHERE role = 'normal')),
  ('stat.folder_count', (SELECT COUNT(*)::text FROM folders WHERE role = 'normal'))
ON CONFLICT (key) DO UPDATE SET value = excluded.value;

-- migrate:down
DELETE FROM app_settings WHERE key IN ('stat.media_count', 'stat.video_count', 'stat.folder_count');
