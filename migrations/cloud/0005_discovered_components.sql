-- Opt-in automated inventory is stored separately from manual entries.
-- Existing metadata-only history contract remains unchanged.
ALTER TABLE ship_check_technology_monitoring
  ADD COLUMN auto_discovery_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE ship_check_discovered_components (
  project_id uuid NOT NULL REFERENCES ship_check_technology_monitoring(project_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('ai-model','wordpress-core','wordpress-plugin','wordpress-theme','drupal-package')),
  component_id varchar(160) NOT NULL CHECK (component_id ~ '^[A-Za-z0-9._/-]+$'),
  version varchar(80),
  evidence text NOT NULL DEFAULT 'source-declared' CHECK (evidence = 'source-declared'),
  scanned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id,kind,component_id)
);
CREATE INDEX ship_check_discovered_components_lookup
  ON ship_check_discovered_components(kind,component_id);

COMMENT ON TABLE ship_check_discovered_components IS
  'Explicitly opted-in source-derived component identifiers only. No repository URL, source path, code or scan payload is stored.';
