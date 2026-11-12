-- Separate opt-in technology monitoring. Legacy assurance-metadata/0.1 remains unchanged.
-- No source files, source excerpts, credentials, repository URLs or arbitrary payload JSON.
CREATE TABLE ship_check_technology_monitoring (
  project_id uuid PRIMARY KEY REFERENCES ship_check_projects(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES ship_check_accounts(id) ON DELETE CASCADE,
  enabled_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ship_check_technology_monitoring_account_idx ON ship_check_technology_monitoring(account_id);

CREATE TABLE ship_check_technology_components (
  project_id uuid NOT NULL REFERENCES ship_check_technology_monitoring(project_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('ai-model','wordpress-core','wordpress-plugin','wordpress-theme','drupal-package')),
  component_id varchar(160) NOT NULL CHECK (component_id ~ '^[A-Za-z0-9._/-]+$'),
  version varchar(80),
  evidence text NOT NULL DEFAULT 'source-declared' CHECK (evidence IN ('source-declared','runtime-verified')),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, kind, component_id)
);
CREATE INDEX ship_check_technology_components_kind_idx ON ship_check_technology_components(kind, component_id);

CREATE TABLE ship_check_technology_alerts (
  project_id uuid NOT NULL REFERENCES ship_check_technology_monitoring(project_id) ON DELETE CASCADE,
  match_identity char(64) NOT NULL CHECK (match_identity ~ '^[a-f0-9]{64}$'),
  notice_id varchar(200) NOT NULL,
  provider text NOT NULL CHECK (provider IN ('openai','anthropic','wordpress','drupal')),
  component_kind text NOT NULL CHECK (component_kind IN ('ai-model','wordpress-core','wordpress-plugin','wordpress-theme','drupal-package')),
  component_id varchar(160) NOT NULL,
  component_version varchar(80),
  status text NOT NULL CHECK (status IN ('upcoming','urgent','past-due','needs-verification')),
  scope text NOT NULL CHECK (scope IN ('source-only','runtime-confirmed')),
  source_url varchar(512) NOT NULL,
  summary varchar(500) NOT NULL,
  effective_date date,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (project_id,match_identity)
);
CREATE INDEX ship_check_technology_alerts_project_active_idx
  ON ship_check_technology_alerts(project_id, active, first_seen_at DESC);

CREATE TABLE ship_check_technology_feed_status (
  provider text PRIMARY KEY CHECK (provider IN ('openai','anthropic','wordpress','drupal')),
  checked_at timestamptz NOT NULL,
  success_at timestamptz,
  last_error_code varchar(80),
  notice_count integer NOT NULL DEFAULT 0 CHECK (notice_count >= 0)
);
COMMENT ON TABLE ship_check_technology_monitoring IS 'Project-specific explicit opt-in; deleting disables alerts and cascades all component/alert records.';
COMMENT ON TABLE ship_check_technology_components IS 'Minimal consented component identifiers; not source code, not a deployment verification.';
COMMENT ON TABLE ship_check_technology_alerts IS 'Deduplicated notice matches with source provenance; no external notifications are sent.';
