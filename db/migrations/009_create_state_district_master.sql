-- Master list: states and districts (import from state/district master CSV)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS state_district_master (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  state_id text NOT NULL,
  state_name text NOT NULL,
  state_code text NOT NULL,
  dist_id text NOT NULL,
  dist_code text,
  district_name text NOT NULL,
  description text,
  created_by_id text,
  created_by_role_id text,
  updated_by_id text,
  is_active boolean,
  ip_address text,
  is_naxal_district boolean NOT NULL DEFAULT false,
  is_border_district boolean NOT NULL DEFAULT false,
  present_active boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT state_district_master_dist_id_key UNIQUE (dist_id)
);

CREATE INDEX IF NOT EXISTS idx_state_district_master_state_id ON state_district_master (state_id);
CREATE INDEX IF NOT EXISTS idx_state_district_master_state_name ON state_district_master (state_name);
