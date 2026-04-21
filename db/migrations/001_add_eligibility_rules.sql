-- Eligibility rules (insert or refresh by rule_key)
-- Run manually against your Postgres DB, e.g.:
--   psql "$DATABASE_URL" -f db/migrations/001_add_eligibility_rules.sql

INSERT INTO rules_config (id, rule_key, value, description, is_active, created_at, updated_at)
VALUES
  (
    uuid_generate_v4(),
    'eligibility.indianCitizenship',
    'true'::jsonb,
    'The candidate must be a citizen of India. Yes = Indian citizenship is required.',
    true,
    now(),
    now()
  ),
  (
    uuid_generate_v4(),
    'eligibility.matriculationByDate',
    to_jsonb('01/01/2025'::text),
    'Candidate must have passed Matriculation / 10th from a recognised Board or University on or before this date (DD/MM/YYYY).',
    true,
    now(),
    now()
  ),
  (
    uuid_generate_v4(),
    'eligibility.pwdNotEligible',
    'true'::jsonb,
    'Persons with Disabilities (PwD) are not eligible. Yes = exclusion applies.',
    true,
    now(),
    now()
  )
ON CONFLICT (rule_key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active,
  updated_at = now();
