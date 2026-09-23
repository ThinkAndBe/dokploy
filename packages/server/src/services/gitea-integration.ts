
// gitea-integration.ts — AppHub 二开（M3）：项目创建时自动开 Gitea 仓库
// 「版本管理与发布一体化」：平台建项目 → Gitea 自动出现对应 org/repo。
//
// 配置（env，全部可选——未配置即禁用，不影响原流程）：
//   GITEA_API_URL     如 http://gitea.apps.erke.com（不带 /api/v1）
//   GITEA_TOKEN       管理员 PAT（建组织/建仓库权限）
//   GITEA_DEFAULT_ORG 仓库存放组织名（默认 apphub）
//
// 失败策略：软失败——开仓失败只记日志/审计，绝不阻断项目创建。

export const isGiteaIntegrationEnabled = (): boolean => {
	return Boolean(
		process.env.GITEA_API_URL &&
			process.env.GITEA_TOKEN &&
			process.env.GITEA_INTEGRATION_ENABLED !== "false",
	);
};

const giteaApi = () =>
	(process.env.GITEA_API_URL || "").replace(/\/+$/, "") + "/api/v1";

const authHeaders = () => ({
	Authorization: `token ${process.env.GITEA_TOKEN}`,
	"Content-Type": "application/json",
});

const orgName = () => process.env.GITEA_DEFAULT_ORG || "apphub-apps";

export const repoSlug = (name: string) =>
	name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9-_]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60) || `project-${Date.now()}`;

async function ensureOrg(): Promise<string> {
	const org = orgName();
	const res = await fetch(`${giteaApi()}/orgs/${org}`, {
		headers: authHeaders(),
		signal: AbortSignal.timeout(10_000),
	});
	if (res.ok) return org;
	if (res.status !== 404) {
		throw new Error(`查询组织失败 HTTP ${res.status}`);
	}
	const created = await fetch(`${giteaApi()}/orgs`, {
		method: "POST",
		headers: authHeaders(),
		body: JSON.stringify({ username: org }),
		signal: AbortSignal.timeout(10_000),
	});
	if (!created.ok && created.status !== 422) {
		throw new Error(`创建组织失败 HTTP ${created.status}`);
	}
	return org;
}

export interface ProvisionResult {
	repoUrl: string;
	cloneUrl: string;
}

export async function provisionGiteaRepo(opts: {
	name: string;
	description?: string | null;
}): Promise<ProvisionResult> {
	if (!isGiteaIntegrationEnabled()) {
		throw new Error("Gitea 集成未配置");
	}
	const org = await ensureOrg();
	const repo = repoSlug(opts.name);
	const res = await fetch(`${giteaApi()}/orgs/${org}/repos`, {
		method: "POST",
		headers: authHeaders(),
		body: JSON.stringify({
			name: repo,
			description: opts.description || "",
			private: true,
			auto_init: false,
		}),
		signal: AbortSignal.timeout(15_000),
	});
	if (!res.ok && res.status !== 409) {
		// 409=已存在（幂等重试）
		throw new Error(`创建仓库失败 HTTP ${res.status}: ${await res.text()}`);
	}
	const base = (process.env.GITEA_API_URL || "").replace(/\/+$/, "");
	return {
		repoUrl: `${base}/${org}/${repo}`,
		cloneUrl: `${base}/${org}/${repo}.git`,
	};
}

/**
 * 建项目后调用：自动开仓并落库记录（projects.giteaRepoUrl）。
 * 软失败：任何异常记审计日志后吞掉，不影响项目创建主流程。
 */
export async function provisionGiteaForProject(project: {
	projectId: string;
	name: string;
	description?: string | null;
	organizationId?: string | null;
}): Promise<ProvisionResult | null> {
	if (!isGiteaIntegrationEnabled()) return null;
	try {
		const result = await provisionGiteaRepo({
			name: project.name,
			description: project.description,
		});
		console.log(
			`[gitea-integration] 项目「${project.name}」已开仓：${result.repoUrl}`,
		);
		return result;
	} catch (e) {
		console.error(
			`[gitea-integration] 项目「${project.name}」开仓失败（不影响项目创建）：`,
			e instanceof Error ? e.message : e,
		);
		return null;
	}
}
