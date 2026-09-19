-- Ship Check Cloud scoped API credentials.
-- Raw API tokens are never stored. Only a domain-separated SHA-256 digest and
-- a short non-secret display prefix are persisted.

CREATE TABLE ship_check_api_tokens (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES ship_check_accounts(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE
    CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  token_prefix varchar(18) NOT NULL
    CHECK (token_prefix ~ '^shipcheck_[A-Za-z0-9_-]{8}$'),
  label varchar(80),
  scopes text[] NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  CONSTRAINT ship_check_api_tokens_label_nonempty
    CHECK (label IS NULL OR length(btrim(label)) > 0),
  CONSTRAINT ship_check_api_tokens_expiry_after_create
    CHECK (expires_at > created_at),
  CONSTRAINT ship_check_api_tokens_revocation_after_create
    CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CONSTRAINT ship_check_api_tokens_scopes_nonempty
    CHECK (cardinality(scopes) BETWEEN 1 AND 3),
  CONSTRAINT ship_check_api_tokens_scopes_known
    CHECK (
      scopes <@ ARRAY[
        'history:read',
        'history:sync',
        'project:manage'
      ]::text[]
    )
);

CREATE INDEX ship_check_api_tokens_account_idx
  ON ship_check_api_tokens(account_id, created_at DESC, id DESC);

CREATE INDEX ship_check_api_tokens_active_hash_idx
  ON ship_check_api_tokens(token_hash)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE ship_check_api_tokens IS
  'Account-scoped expiring API credentials; only SHA-256 token digests and non-secret prefixes are persisted.';

COMMENT ON COLUMN ship_check_api_tokens.token_prefix IS
  'Short non-secret identifier used to distinguish credentials in account UI; not sufficient for authentication.';
