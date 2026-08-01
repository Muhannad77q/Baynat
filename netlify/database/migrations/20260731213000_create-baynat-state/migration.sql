CREATE TABLE baynat_state (
  singleton_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
  state JSON NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE baynat_consumed_proofs (
  proof_hash VARCHAR(64) PRIMARY KEY CHECK (proof_hash ~ '^[a-f0-9]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX baynat_consumed_proofs_expires_at_idx
  ON baynat_consumed_proofs (expires_at);
