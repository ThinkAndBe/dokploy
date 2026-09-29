import { db } from "@dokploy/server/db";
import { projects } from "@dokploy/server/db/schema";
import { eq, sql } from "drizzle-orm";
import { isGiteaIntegrationEnabled, provisionGiteaRepo } from "./gitea-integration";

// Serialize concurrent retries, and save the binding before reporting success.
export async function ensureProjectRepository(projectId: string) {
    return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`apphub-repository:${projectId}`}))`);
        const [project] = await tx.select().from(projects).where(eq(projects.projectId, projectId));
        if (!project) throw new Error("项目不存在");
        if (project.giteaRepoUrl && project.giteaCloneUrl) {
            return { repoUrl: project.giteaRepoUrl, cloneUrl: project.giteaCloneUrl };
        }
        if (!isGiteaIntegrationEnabled()) return null;
        try {
            const result = await provisionGiteaRepo(project);
            await tx.update(projects).set({giteaRepoUrl: result.repoUrl, giteaCloneUrl: result.cloneUrl, giteaRepoStatus: "ready"}).where(eq(projects.projectId, projectId));
            return result;
        } catch {
            await tx.update(projects).set({giteaRepoStatus: "failed"}).where(eq(projects.projectId, projectId));
            console.error(`[AppHub] Repository provisioning failed for project ${projectId}; check Gitea connection and credentials.`);
            return null;
        }
    });
}
