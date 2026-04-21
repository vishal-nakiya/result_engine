-- Transparency: snapshot of domicile resolution, vacancy match, and PDF ordering context at allocation time.

ALTER TABLE allocation
  ADD COLUMN IF NOT EXISTS allocation_meta jsonb;

CREATE INDEX IF NOT EXISTS idx_allocation_meta_gin ON allocation USING gin (allocation_meta);
