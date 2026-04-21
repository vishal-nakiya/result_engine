-- Physical Standards (PST/PET) rules from source HTML

INSERT INTO rules_config (id, rule_key, value, description, is_active, created_at, updated_at)
VALUES
  (uuid_generate_v4(), 'pst.height.maleUrCm', to_jsonb(170::numeric), 'Male UR height (cm)', true, now(), now()),
  (uuid_generate_v4(), 'pst.height.femaleUrCm', to_jsonb(157::numeric), 'Female UR height (cm)', true, now(), now()),
  (uuid_generate_v4(), 'pst.height.stMaleCm', to_jsonb(162.5::numeric), 'ST male height (cm) (excluding NE ST sub-category)', true, now(), now()),
  (uuid_generate_v4(), 'pst.height.neStatesMalePolicy', to_jsonb('NORM'::text), 'NE states male height standard policy label', true, now(), now()),
  (uuid_generate_v4(), 'pst.height.gtaMaleCm', to_jsonb(157::numeric), 'GTA (Darjeeling) male height (cm)', true, now(), now()),
  (uuid_generate_v4(), 'pst.chest.maleUnexpandedMinCm', to_jsonb(80::numeric), 'Male chest unexpanded minimum (cm)', true, now(), now()),
  (uuid_generate_v4(), 'pst.chest.expansionMinCm', to_jsonb(5::numeric), 'Chest minimum expansion (cm)', true, now(), now()),
  (uuid_generate_v4(), 'pet.race.maleStandard', to_jsonb('5km/24m'::text), 'PET race male standard (outside Ladakh)', true, now(), now()),
  (uuid_generate_v4(), 'pet.race.femaleStandard', to_jsonb('1.6km/8.5m'::text), 'PET race female standard (outside Ladakh)', true, now(), now()),
  (uuid_generate_v4(), 'pst.chest.femalePolicy', to_jsonb('VISUAL'::text), 'Female chest policy label', true, now(), now())
ON CONFLICT (rule_key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active,
  updated_at = now();

