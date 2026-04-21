-- Store per-candidate rule engine evaluation for explainability
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS candidate_rule_eval (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id uuid UNIQUE NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  qualified boolean NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now()
);

