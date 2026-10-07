-- 002: nudge tracking + inbox dedupe
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS nudged_at TIMESTAMP;
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS nudge_count INT DEFAULT 0;

CREATE TABLE IF NOT EXISTS seen_messages (
  message_id TEXT PRIMARY KEY,
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
