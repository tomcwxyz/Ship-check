CREATE TABLE ship_check_cms_pairings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES ship_check_projects(id) ON DELETE CASCADE,
 account_id uuid NOT NULL,
 token_hash char(64) NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ship_check_cms_pairings_project ON ship_check_cms_pairings(project_id);
CREATE TABLE ship_check_cms_connectors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES ship_check_projects(id) ON DELETE CASCADE,
 account_id uuid NOT NULL,
 cms text NOT NULL CHECK(cms IN ('wordpress','drupal')),
 token_hash char(64) NOT NULL UNIQUE,
 last_seen_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
CREATE INDEX ship_check_cms_connectors_project ON ship_check_cms_connectors(project_id);
CREATE TABLE ship_check_cms_components (
 connector_id uuid NOT NULL REFERENCES ship_check_cms_connectors(id) ON DELETE CASCADE,
 project_id uuid NOT NULL REFERENCES ship_check_projects(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('wordpress-core','wordpress-plugin','wordpress-theme','drupal-package')),
 component_id varchar(160) NOT NULL,
 version varchar(80),
 active boolean NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(connector_id,kind,component_id)
);
CREATE INDEX ship_check_cms_components_project ON ship_check_cms_components(project_id);
