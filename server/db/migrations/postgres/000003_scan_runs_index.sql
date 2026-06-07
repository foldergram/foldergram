-- migrate:up
CREATE INDEX IF NOT EXISTS idx_scan_runs_finished_at ON scan_runs (finished_at) WHERE finished_at IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS idx_scan_runs_finished_at;
