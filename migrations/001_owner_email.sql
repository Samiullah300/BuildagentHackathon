-- 001: owner_email on commitments
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS owner_email VARCHAR(320);
