-- Minimal Wordfence change feed; no full source files or vendor payload storage.
-- Populated only after a signed, verified Wordfence Intelligence webhook.
CREATE TABLE ship_check_wordfence_advisories (
  advisory_id uuid PRIMARY KEY,
  component_kind text NOT NULL CHECK (component_kind IN ('wordpress-core','wordpress-plugin','wordpress-theme')),
  component_id varchar(160) NOT NULL CHECK (component_id ~ '^[a-z0-9._/-]+$'),
  title varchar(280) NOT NULL,
  published_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  affected_ranges jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(affected_ranges) = 'array'),
  source_url varchar(512) NOT NULL
);
CREATE INDEX ship_check_wordfence_component_idx
  ON ship_check_wordfence_advisories(component_kind,component_id);

COMMENT ON TABLE ship_check_wordfence_advisories IS
  'Minimal normalised Wordfence Intelligence webhook data, not raw copyrighted vulnerability payloads.';
