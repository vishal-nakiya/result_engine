-- Create PST/PET stage tables (separate from candidates)

-- Ensure UUID helpers exist (best-effort)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS pst_results (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  exam_type text NOT NULL DEFAULT 'CAPF_GD_2025',
  status text,
  height numeric(6,2),
  chest_not_expanded numeric(6,2),
  chest_expanded numeric(6,2),
  weight numeric(6,2),
  ht_rlx_code text,
  chst_rlx_code text,
  height_relax boolean,
  chest_relax boolean,
  height_chest_relax boolean,
  final_pet_pst_status text,
  remarks text,
  pregnant boolean,
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(candidate_id, exam_type)
);

CREATE TABLE IF NOT EXISTS pet_results (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  exam_type text NOT NULL DEFAULT 'CAPF_GD_2025',
  status text,
  remarks text,
  pregnant boolean,
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(candidate_id, exam_type)
);

