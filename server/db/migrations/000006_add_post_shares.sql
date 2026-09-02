-- migrate:up

CREATE TABLE IF NOT EXISTS post_share_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NULL,
  expires_at TEXT NULL,
  revoked_at TEXT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT NULL,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_post_share_links_post_id
  ON post_share_links(post_id);

CREATE INDEX IF NOT EXISTS idx_post_share_links_expires_at
  ON post_share_links(expires_at);

-- migrate:down

-- Forward-only. Foldergram does not automatically roll back local user data migrations.
