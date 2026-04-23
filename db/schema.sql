-- Result processing system (PostgreSQL schema)
-- Note: Prisma is the source of truth (`backend/prisma/schema.prisma`).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$ BEGIN
  CREATE TYPE "Category" AS ENUM ('UR','OBC','SC','ST','EWS','ESM');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CandidateStatus" AS ENUM ('cleared','rejected','debarred','withheld','TU');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "Stage" AS ENUM ('CBE','PST','PET','DME','DV');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "StageStatus" AS ENUM ('pass','fail','TU','exempt');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ForceCode" AS ENUM ('A','B','C','D','E','F','G','H');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "LogLevel" AS ENUM ('debug','info','warn','error');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS candidates (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  roll_no text UNIQUE NOT NULL,
  name text NOT NULL,
  father_name text,
  dob date NOT NULL,
  gender text NOT NULL,
  category "Category" NOT NULL,
  is_esm boolean NOT NULL DEFAULT false,
  domicile_state text,
  district text,
  height numeric(6,2),
  chest numeric(6,2),
  weight numeric(6,2),
  is_pwd boolean NOT NULL DEFAULT false,
  ncc_cert text,
  marks_cbe numeric(8,3),
  normalized_marks numeric(8,3),
  part_a_marks numeric(8,3),
  part_b_marks numeric(8,3),
  part_c_marks numeric(8,3),
  part_d_english_marks numeric(8,3),
  part_d_hindi_marks numeric(8,3),
  ncc_bonus_marks numeric(8,3),
  registration_no text,
  age_years numeric(8,3),
  arc_code text,
  post_preference text,
  state_code text,
  district_code text,
  state_name text,
  naxal boolean,
  border boolean,
  pst_status text,
  pet_status text,
  dv_result text,
  med_result text,
  debarred boolean,
  withheld boolean,
  status "CandidateStatus" NOT NULL DEFAULT 'withheld',
  final_marks numeric(8,3),
  merit_rank integer,
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exam_stages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  stage "Stage" NOT NULL,
  status "StageStatus" NOT NULL,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(candidate_id, stage)
);

CREATE TABLE IF NOT EXISTS vacancy (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  force_code "ForceCode" NOT NULL,
  force_name text NOT NULL,
  state text NOT NULL,
  district text NOT NULL,
  category "Category" NOT NULL,
  gender text NOT NULL,
  total_posts integer NOT NULL,
  esm_reserved integer NOT NULL
);

CREATE TABLE IF NOT EXISTS allocation (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id uuid UNIQUE NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  force_code "ForceCode" NOT NULL,
  category_allocated "Category" NOT NULL,
  state_allocated text NOT NULL,
  district_allocated text NOT NULL,
  merit_rank integer NOT NULL,
  vacancy_row_key text,
  state_code text,
  area text,
  post_code text,
  allocation_meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rules_config (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_key text UNIQUE NOT NULL,
  value jsonb NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cutoff_marks (
  category "Category" PRIMARY KEY,
  min_percentage numeric(5,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  timestamp timestamptz NOT NULL DEFAULT now(),
  level "LogLevel" NOT NULL,
  message text NOT NULL,
  meta jsonb
);

