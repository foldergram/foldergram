-- migrate:up
ALTER TABLE images ADD COLUMN companion_caption TEXT NULL;
ALTER TABLE posts ADD COLUMN companion_caption TEXT NULL;
ALTER TABLE posts ADD COLUMN caption_edited_at TEXT NULL;

-- migrate:down
ALTER TABLE posts DROP COLUMN caption_edited_at;
ALTER TABLE posts DROP COLUMN companion_caption;
ALTER TABLE images DROP COLUMN companion_caption;
