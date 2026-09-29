CREATE TABLE apphub_project_owner (
 project_id text PRIMARY KEY REFERENCES project("projectId") ON DELETE CASCADE,
 organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES "user"(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE apphub_project_access_event (
 id bigserial PRIMARY KEY,
 organization_id text NOT NULL,
 project_id text NOT NULL,
 actor text NOT NULL,
 target text NOT NULL,
 action text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE apphub_publish_request (
 id text PRIMARY KEY,
 organization_id text NOT NULL,
 project_id text NOT NULL REFERENCES project("projectId") ON DELETE CASCADE,
 tested_plan_id text NOT NULL REFERENCES apphub_release_plan(id),
 created_by text NOT NULL REFERENCES "user"(id),
 description text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','rejected')),
 reviewed_by text,
 review_note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,tested_plan_id)
);
