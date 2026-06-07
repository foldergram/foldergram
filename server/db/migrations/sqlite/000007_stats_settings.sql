-- migrate:up
INSERT OR REPLACE INTO app_settings (key, value)
VALUES
  ('stat.media_count', (SELECT COALESCE(SUM(image_count), 0) FROM folders WHERE role = 'normal')),
  ('stat.video_count', (SELECT COALESCE(SUM(video_count), 0) FROM folders WHERE role = 'normal')),
  ('stat.folder_count', (SELECT COUNT(*) FROM folders WHERE role = 'normal'));

-- migrate:down
DELETE FROM app_settings WHERE key IN ('stat.media_count', 'stat.video_count', 'stat.folder_count');
