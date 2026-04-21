-- Eligibility: minimum education dropdown rule
-- This will be auto-run on backend start (app_migrations) if enabled.

INSERT INTO rules_config (id, rule_key, value, description, is_active, created_at, updated_at)
VALUES
  (
    uuid_generate_v4(),
    'eligibility.minEducationLevel',
    to_jsonb('10th'::text),
    'Minimum education required for eligibility (10th/12th/Degree/Master/PhD).',
    true,
    now(),
    now()
  )
ON CONFLICT (rule_key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active,
  updated_at = now();

