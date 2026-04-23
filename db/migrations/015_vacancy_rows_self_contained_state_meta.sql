-- Make vacancy_rows self-contained for state/district metadata.
-- Removes runtime dependency on states/state_district_master for allocation/listing.

ALTER TABLE vacancy_rows
  ADD COLUMN IF NOT EXISTS state_name text;

-- Backfill state_name from existing states table when available.
UPDATE vacancy_rows v
SET state_name = s.state_name
FROM states s
WHERE v.state_name IS NULL
  AND v.state_code = s.state_code;

-- Ensure non-null for existing data.
UPDATE vacancy_rows
SET state_name = state_code
WHERE state_name IS NULL;

ALTER TABLE vacancy_rows
  ALTER COLUMN state_name SET NOT NULL;

-- Drop FK to states if it exists.
DO $$
DECLARE
  c_name text;
BEGIN
  SELECT conname INTO c_name
  FROM pg_constraint
  WHERE conrelid = 'vacancy_rows'::regclass
    AND contype = 'f'
    AND conname LIKE '%state_code%';

  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE vacancy_rows DROP CONSTRAINT %I', c_name);
  END IF;
END $$;
