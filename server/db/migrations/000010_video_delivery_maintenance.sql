-- migrate:up
CREATE TABLE local_hls_windows (
  id TEXT PRIMARY KEY,
  root TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  image_id INTEGER NOT NULL,
  revision TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  reserved_bytes INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('encoding', 'ready')),
  accessed_at INTEGER NOT NULL,
  UNIQUE (root, cache_key)
);
CREATE INDEX idx_hls_windows_access ON local_hls_windows (root, accessed_at);

CREATE TABLE video_preview_reclamation (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_video_preview_reclamation_created ON video_preview_reclamation (created_at);

CREATE TABLE video_preview_reclamation_items (
  job_id TEXT NOT NULL REFERENCES video_preview_reclamation(id) ON DELETE CASCADE,
  image_id INTEGER NOT NULL,
  revision TEXT NOT NULL,
  preview_path TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  reason TEXT,
  pending_bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (job_id, image_id)
);

-- migrate:down
DROP TABLE video_preview_reclamation_items;
DROP TABLE video_preview_reclamation;
DROP TABLE local_hls_windows;
