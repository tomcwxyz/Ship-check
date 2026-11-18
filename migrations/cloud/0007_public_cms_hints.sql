-- CMS identification from an ordinary public website scan is a hint, not a
-- verified installed core/plugin inventory. Store no URLs, HTML or secrets.
CREATE TABLE IF NOT EXISTS ship_check_cms_site_hints (
  project_id uuid NOT NULL REFERENCES ship_check_technology_monitoring(project_id) ON DELETE CASCADE,
  cms text NOT NULL CHECK (cms IN ('wordpress', 'drupal')),
  confidence text NOT NULL CHECK (confidence IN ('likely', 'possible')),
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, cms)
);
