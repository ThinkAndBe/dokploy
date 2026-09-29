ALTER TABLE "project" ADD COLUMN "giteaRepoUrl" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "giteaCloneUrl" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "giteaRepoStatus" text DEFAULT 'unconfigured' NOT NULL;