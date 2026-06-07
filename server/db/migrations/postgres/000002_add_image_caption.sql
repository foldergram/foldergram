-- migrate:up

ALTER TABLE images ADD COLUMN caption TEXT NULL;

-- migrate:down

-- Forward-only. Foldergram does not automatically roll back local user data migrations.
