-- Optional Cloudflare D1 schema for project metadata only.
-- Do NOT store video binaries in D1. Local IndexedDB/OPFS remains source of truth.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_owner_updated ON projects(owner_hash, updated_at DESC);
