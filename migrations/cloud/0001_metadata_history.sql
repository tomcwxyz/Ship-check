-- Ship Check Cloud metadata-history foundation.
-- This schema stores assurance-metadata only. It intentionally has no source,
-- finding-detail, evidence-excerpt, repository URL, deployment URL or email columns.

CREATE TABLE ship_check_accounts (
  id uuid PRIMARY KEY,
  auth_subject_hash char(64) NOT NULL UNIQUE
    CHECK (auth_subject_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL
);

CREATE TABLE ship_check_projects (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES ship_check_accounts(id) ON DELETE CASCADE,
  project_identity char(64) NOT NULL
    CHECK (project_identity ~ '^[a-f0-9]{64}$'),
  identity_basis text NOT NULL
    CHECK (identity_basis IN ('primary-evidence', 'caller-provided')),
  display_name varchar(120),
  retention_policy text NOT NULL
    CHECK (retention_policy IN (
      '30-days',
      '90-days',
      '180-days',
      '365-days',
      'until-deleted'
    )),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT ship_check_projects_account_identity_unique
    UNIQUE (account_id, project_identity),
  CONSTRAINT ship_check_projects_display_name_nonempty
    CHECK (display_name IS NULL OR length(btrim(display_name)) > 0)
);

CREATE INDEX ship_check_projects_account_idx
  ON ship_check_projects(account_id);

CREATE TABLE ship_check_history_events (
  project_id uuid NOT NULL REFERENCES ship_check_projects(id) ON DELETE CASCADE,
  scan_identity char(64) NOT NULL
    CHECK (scan_identity ~ '^[a-f0-9]{64}$'),
  generated_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL,
  expires_at timestamptz,
  payload jsonb NOT NULL,
  PRIMARY KEY (project_id, scan_identity),
  CONSTRAINT ship_check_history_expiry_after_ingest
    CHECK (expires_at IS NULL OR expires_at > ingested_at),
  CONSTRAINT ship_check_history_payload_shape
    CHECK (
      payload->>'schemaVersion' = '0.1'
      AND payload->>'type' = 'assurance-metadata'
      AND payload->>'provider' = 'ship-check'
      AND payload#>>'{project,identity,value}' ~ '^[a-f0-9]{64}$'
      AND payload#>>'{scan,identity,value}' = scan_identity
    )
);

CREATE INDEX ship_check_history_project_generated_idx
  ON ship_check_history_events(project_id, generated_at, scan_identity);

CREATE INDEX ship_check_history_expiry_idx
  ON ship_check_history_events(expires_at)
  WHERE expires_at IS NOT NULL;

COMMENT ON TABLE ship_check_accounts IS
  'Opaque hosted account identity only; auth subjects are SHA-256 hashed before persistence.';

COMMENT ON TABLE ship_check_projects IS
  'Account-scoped Ship Check project identity and explicit metadata-history retention policy.';

COMMENT ON TABLE ship_check_history_events IS
  'Source-free assurance-metadata envelopes only; full scan reports and source evidence do not belong here.';
