import {projectNameText,projectDescriptionText} from '../../services/project-profile-policy';
import { relations } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { organization } from "./account";
import { environments } from "./environment";
import { projectTags } from "./tag";
import { encryptedText } from "./utils";

export const projects = pgTable("project", {
	projectId: text("projectId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	name: text("name").notNull(),
	description: text("description"),
	giteaRepoUrl: text("giteaRepoUrl"),
	giteaCloneUrl: text("giteaCloneUrl"),
	giteaRepoStatus: text("giteaRepoStatus").notNull().default("unconfigured"),
	createdAt: text("createdAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),

	organizationId: text("organizationId")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	env: encryptedText("env").notNull().default(""),
});

export const projectRelations = relations(projects, ({ many, one }) => ({
	environments: many(environments),
	projectTags: many(projectTags),
	organization: one(organization, {
		fields: [projects.organizationId],
		references: [organization.id],
	}),
}));

const createSchema = createInsertSchema(projects, {
	projectId: z.string().min(1),
	name: projectNameText,
	description: projectDescriptionText.optional(),
	env: z.string().optional(),
});

export const apiCreateProject = createSchema.pick({
	name: true,
	description: true,
	env: true,
});

export const apiFindOneProject = z.object({
	projectId: z.string().min(1),
});
export const apiRemoveProject = createSchema
	.pick({
		projectId: true,
	})
	.required();

// export const apiUpdateProject = createSchema
// 	.pick({
// 		name: true,
// 		description: true,
// 		projectId: true,
// 		env: true,
// 	})
// 	.required();

export const apiUpdateProject = createSchema.omit({ giteaRepoUrl: true, giteaCloneUrl: true, giteaRepoStatus: true }).partial().extend({
	projectId: z.string().min(1),
});
// .omit({ serverId: true });
