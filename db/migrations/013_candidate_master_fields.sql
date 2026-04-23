ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS registration_no text,
  ADD COLUMN IF NOT EXISTS part_c_marks numeric(8,3),
  ADD COLUMN IF NOT EXISTS part_d_english_marks numeric(8,3),
  ADD COLUMN IF NOT EXISTS part_d_hindi_marks numeric(8,3),
  ADD COLUMN IF NOT EXISTS ncc_bonus_marks numeric(8,3),
  ADD COLUMN IF NOT EXISTS age_years numeric(8,3),
  ADD COLUMN IF NOT EXISTS arc_code text,
  ADD COLUMN IF NOT EXISTS post_preference text,
  ADD COLUMN IF NOT EXISTS state_code text,
  ADD COLUMN IF NOT EXISTS district_code text,
  ADD COLUMN IF NOT EXISTS state_name text,
  ADD COLUMN IF NOT EXISTS naxal boolean,
  ADD COLUMN IF NOT EXISTS border boolean,
  ADD COLUMN IF NOT EXISTS pst_status text,
  ADD COLUMN IF NOT EXISTS pet_status text,
  ADD COLUMN IF NOT EXISTS dv_result text,
  ADD COLUMN IF NOT EXISTS med_result text,
  ADD COLUMN IF NOT EXISTS debarred boolean,
  ADD COLUMN IF NOT EXISTS withheld boolean;

CREATE INDEX IF NOT EXISTS idx_candidates_registration_no ON candidates(registration_no);
CREATE INDEX IF NOT EXISTS idx_candidates_state_code ON candidates(state_code);
