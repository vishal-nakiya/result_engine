-- Merit computation method (normalized only vs normalized + NCC)

INSERT INTO rules_config (id, rule_key, value, description, is_active, created_at, updated_at)
VALUES
  (
    uuid_generate_v4(),
    'merit.computationMethod',
    to_jsonb('normalized_plus_ncc'::text),
    'Final merit formula: normalized_only OR normalized_plus_ncc',
    true,
    now(),
    now()
  )
ON CONFLICT (rule_key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active,
  updated_at = now();

