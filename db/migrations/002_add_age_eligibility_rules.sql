-- Age eligibility (born not before / not later than)
-- Run manually against your Postgres DB, e.g.:
--   psql "$DATABASE_URL" -f db/migrations/002_add_age_eligibility_rules.sql

INSERT INTO rules_config (id, rule_key, value, description, is_active, created_at, updated_at)
VALUES
  (
    uuid_generate_v4(),
    'age.dobNotBefore',
    to_jsonb('02/01/2002'::text),
    'Age group 18 to 23 years — Born not before (DD/MM/YYYY)',
    true,
    now(),
    now()
  ),
  (
    uuid_generate_v4(),
    'age.dobNotLaterThan',
    to_jsonb('01/01/2007'::text),
    'Age group 18 to 23 years — Born not later than (DD/MM/YYYY)',
    true,
    now(),
    now()
  )
ON CONFLICT (rule_key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active,
  updated_at = now();

