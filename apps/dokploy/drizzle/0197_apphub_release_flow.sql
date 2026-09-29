CREATE TABLE IF NOT EXISTS apphub_release_plan (
 id text PRIMARY KEY,
 organization_id text NOT NULL,
 project_id text NOT NULL,
 environment_id text NOT NULL,
 service_id text,
 created_by text NOT NULL,
 title text NOT NULL,
 tier text NOT NULL CHECK(tier IN ('test','formal')),
 status text NOT NULL CHECK(status IN ('awaiting_confirmation','awaiting_approval','queued','deploying','deployed','failed','needs_review','rejected','cancelled')),
 plan_hash text NOT NULL,
 base_hash text NOT NULL,
 idempotency_key text NOT NULL,
 payload jsonb NOT NULL,
 approved_by text,
 approved_hash text,
 worker_id text,
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,created_by,idempotency_key)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS apphub_release_environment_idx ON apphub_release_plan(organization_id,environment_id,created_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS apphub_release_event (
 id bigserial PRIMARY KEY,
 plan_id text NOT NULL REFERENCES apphub_release_plan(id),
 actor text NOT NULL,
 action text NOT NULL,
 note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
