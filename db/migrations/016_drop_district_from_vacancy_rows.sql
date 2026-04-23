-- District is no longer used for vacancy_rows/allocation logic (state-only allocation).
ALTER TABLE vacancy_rows
  DROP COLUMN IF EXISTS district_code,
  DROP COLUMN IF EXISTS district_name;
