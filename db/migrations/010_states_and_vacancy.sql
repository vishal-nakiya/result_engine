-- Canonical state codes for FKs (one row per state_code). Names come from state_district_master and/or vacancy CSV.
CREATE TABLE IF NOT EXISTS states (
  state_code text PRIMARY KEY,
  state_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Backfill from district master when present (distinct state_code).
INSERT INTO states (state_code, state_name)
SELECT DISTINCT ON (state_code)
  state_code,
  state_name
FROM state_district_master
ORDER BY state_code, district_name
ON CONFLICT (state_code) DO NOTHING;

-- Vacancy rows are self-contained for state/district metadata (no state table join needed at runtime).
CREATE TABLE IF NOT EXISTS vacancy_rows (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  state_code text NOT NULL,
  state_name text NOT NULL,
  gender smallint NOT NULL,
  post_code text NOT NULL,
  force text NOT NULL,
  area text NOT NULL,
  category text NOT NULL,
  category_code smallint,
  vacancies integer,
  initial integer,
  current_count integer,
  allocated integer,
  left_vacancy integer,
  allocated_hc integer,
  allocated_hc_prev integer,
  row_key text NOT NULL,
  min_marks_prev numeric(14, 5),
  min_marks_parta_prev numeric(14, 5),
  min_marks_partb_prev numeric(14, 5),
  min_marks_cand_dob_prev date,
  min_marks numeric(14, 5),
  min_marks_parta numeric(14, 5),
  min_marks_partb numeric(14, 5),
  min_marks_cand_dob date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vacancy_rows_row_key_key UNIQUE (row_key)
);

CREATE INDEX IF NOT EXISTS idx_vacancy_rows_state_code ON vacancy_rows (state_code);
CREATE INDEX IF NOT EXISTS idx_vacancy_rows_force ON vacancy_rows (force);
