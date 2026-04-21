-- Traceability to uploaded vacancy CSV rows + optional ESM category on allocation

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'Category'
      AND e.enumlabel = 'ESM'
  ) THEN
    ALTER TYPE "Category" ADD VALUE 'ESM';
  END IF;
END
$$;

ALTER TABLE allocation
  ADD COLUMN IF NOT EXISTS vacancy_row_key text,
  ADD COLUMN IF NOT EXISTS state_code text,
  ADD COLUMN IF NOT EXISTS area text,
  ADD COLUMN IF NOT EXISTS post_code text;

CREATE INDEX IF NOT EXISTS idx_allocation_vacancy_row_key ON allocation (vacancy_row_key);
