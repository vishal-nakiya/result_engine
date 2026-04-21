-- Special Provisions rules from source HTML

INSERT INTO rules_config (id, rule_key, value, description, is_active, created_at, updated_at)
VALUES
  (uuid_generate_v4(), 'special.pwdPolicy', to_jsonb('REJECT'::text), 'PwD policy action', true, now(), now()),
  (uuid_generate_v4(), 'special.esmPstPetPolicy', to_jsonb('EXEMPT'::text), 'ESM PST/PET exemption policy', true, now(), now()),
  (uuid_generate_v4(), 'special.esmQuotaPercent', to_jsonb('10%'::text), 'ESM quota percent per category', true, now(), now()),
  (uuid_generate_v4(), 'special.pregnancyTuPolicy', to_jsonb('TU'::text), 'Pregnancy temporary unfit policy code', true, now(), now()),
  (uuid_generate_v4(), 'special.areaAllocationSequence', to_jsonb('SEQ'::text), 'Area allocation sequence policy', true, now(), now()),
  (uuid_generate_v4(), 'special.debarredDbCheck', to_jsonb('ACTIVE'::text), 'Debarred DB check policy', true, now(), now()),
  (uuid_generate_v4(), 'special.ssfAllIndia', to_jsonb('ALL-IN'::text), 'SSF all-India basis marker', true, now(), now()),
  (uuid_generate_v4(), 'special.domicileMismatchAction', to_jsonb('CANCEL'::text), 'Domicile mismatch action', true, now(), now())
ON CONFLICT (rule_key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active,
  updated_at = now();

