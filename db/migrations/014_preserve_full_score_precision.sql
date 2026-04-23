-- Preserve exact score precision from uploaded CSV/Excel values.
-- Previous numeric(8,3) columns rounded values to 3 decimals.

ALTER TABLE candidates
  ALTER COLUMN marks_cbe TYPE numeric,
  ALTER COLUMN normalized_marks TYPE numeric,
  ALTER COLUMN part_a_marks TYPE numeric,
  ALTER COLUMN part_b_marks TYPE numeric,
  ALTER COLUMN part_c_marks TYPE numeric,
  ALTER COLUMN part_d_english_marks TYPE numeric,
  ALTER COLUMN part_d_hindi_marks TYPE numeric,
  ALTER COLUMN ncc_bonus_marks TYPE numeric,
  ALTER COLUMN age_years TYPE numeric,
  ALTER COLUMN final_marks TYPE numeric;
