import crypto from "node:crypto";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { betterAuthSecret } from "../lib/auth-secret";
import * as schema from "../db/schema";

// atrust.ts — AppHub 二开：aTrust 反向 OAuth2 单点登录（协议同 new-api tokenhub 实现）
//
// 流程：
//   1. 浏览器 302 → {SSO_SERVER}/passport/v1/public/auth2ssoLogin?appid&redirectUrl&responseType=code&state
//   2. aTrust 登录态有效 → 302 回 redirectUrl?code&state
//   3. 服务端带 X-SDP-Signature 调 {API_SERVER}/passport/v1/user/getUserInfoByCode 换用户信息
//      签名 = hex(HMAC-SHA256(appSecret, "appid={appid}\ncode={code}"))
//
// 用户映射：工号(name) 合成唯一邮箱 {工号}@atrust.apphub → 复用 better-auth 的
// user/session/member 表（不动 schema，fork diff 最小）；姓名(displayName) → firstName。
// 会话：直插 session 表 + 设置 better-auth.session_token Cookie——与 better-auth
// 的 getSession/validateRequest 完全兼容（trpc 鉴权、API key 体系不受影响）。

export interface ATrustSSOConfig {
	enabled: boolean;
	ssoServer: string;
	apiServer: string;
	appId: string;
	appSecret: string;
}

export const getATrustConfig = (): ATrustSSOConfig => ({
	enabled: process.env.ATRUST_SSO_ENABLED === "true",
	ssoServer: (process.env.ATRUST_SSO_SERVER || "").replace(/\/+$/, ""),
	apiServer: (
		process.env.ATRUST_API_SERVER || process.env.ATRUST_SSO_SERVER || ""
	).replace(/\/+$/, ""),
	appId: process.env.ATRUST_APPID || "",
	appSecret: process.env.ATRUST_APPSECRET || "",
});

export const isATrustConfigured = (): boolean => {
	const c = getATrustConfig();
	return (
		c.enabled && c.ssoServer !== "" && c.appId !== "" && c.appSecret !== ""
	);
};

export function atrustAuthorizeUrl(redirectUri: string, state: string): string {
	const c = getATrustConfig();
	const q = new URLSearchParams({
		appid: c.appId,
		redirectUrl: redirectUri,
		responseType: "code",
		state,
	});
	return `${c.ssoServer}/passport/v1/public/auth2ssoLogin?${q.toString()}`;
}

export function atrustSign(appId: string, code: string, appSecret: string) {
	return crypto
		.createHmac("sha256", appSecret)
		.update(`appid=${appId}\ncode=${code}`)
		.digest("hex");
}

export interface ATrustUserInfo {
	name: string; // 工号（唯一标识）
	displayName: string; // 姓名
	email?: string;
	groupPath?: string;
}

interface ATrustAPIResponse {
	code: number | string;
	message?: string;
	data?: { name?: string; displayName?: string; email?: string; groupPath?: string };
}

export async function atrustGetUserByCode(code: string): Promise<ATrustUserInfo> {
	const c = getATrustConfig();
	const q = new URLSearchParams({ appid: c.appId, code });
	const url = `${c.apiServer}/passport/v1/user/getUserInfoByCode?${q.toString()}`;
	const res = await fetch(url, {
		headers: { "X-SDP-Signature": atrustSign(c.appId, code, c.appSecret) },
		signal: AbortSignal.timeout(10_000),
	});
	if (!res.ok) {
		throw new Error(`aTrust 接口 HTTP ${res.status}`);
	}
	const body = (await res.json()) as ATrustAPIResponse;
	// aTrust 约定：code 成功为 0（数字），失败非 0
	if (Number(body.code) !== 0) {
		throw new Error(`aTrust 错误 code=${body.code} msg=${body.message ?? ""}`);
	}
	if (!body.data?.name && !body.data?.displayName) {
		throw new Error("aTrust 返回用户信息为空");
	}
	return {
		name: (body.data?.name || "").trim(),
		displayName: (body.data?.displayName || "").trim(),
		email: body.data?.email,
		groupPath: body.data?.groupPath,
	};
}

export const atrustEmail = (employeeId: string) =>
	`${employeeId}@atrust.apphub`;

export const ATRUST_SESSION_COOKIE = "better-auth.session_token";

/**
 * better-auth 的会话 cookie 值带签名：`${token}.${base64(HMAC-SHA256(secret, token))}`
 * （better-auth crypto/makeSignature 同款算法；DB 存裸 token，cookie 携带签名值）
 */
export function atrustSignedSessionCookie(token: string): string {
	const sig = crypto
		.createHmac("sha256", betterAuthSecret)
		.update(token)
		.digest("base64");
	return `${token}.${sig}`;
}

export interface ATrustLoginResult {
	token: string;
	expiresAt: Date;
}

/**
 * 按零信任身份找/建用户并建立会话。
 * - 已有账号（按合成邮箱精确匹配）→ 直接发会话
 * - 无账号 → 建号；若系统尚无 owner（首位用户）则建默认组织并授 owner，
 *   否则加入既有默认组织为 member（仿 better-auth databaseHooks 的引导逻辑）
 */
export async function atrustLogin(u: ATrustUserInfo): Promise<ATrustLoginResult> {
	const email = atrustEmail(u.name);
	const now = new Date();

	let dbUser = await db.query.user.findFirst({
		where: eq(schema.user.email, email),
	});
	if (!dbUser) {
		const inserted = await db
			.insert(schema.user)
			.values({
				email,
				firstName: u.displayName || u.name,
				lastName: "",
				emailVerified: true,
				isRegistered: true,
				updatedAt: now,
			})
			.returning();
		dbUser = inserted[0];
	} else if (u.displayName && dbUser.firstName !== u.displayName) {
		await db
			.update(schema.user)
			.set({ firstName: u.displayName, updatedAt: now })
			.where(eq(schema.user.id, dbUser.id));
		dbUser.firstName = u.displayName;
	}

	// 组织归属
	let member = await db.query.member.findFirst({
		where: eq(schema.member.userId, dbUser.id),
	});
	if (!member) {
		const owner = await db.query.member.findFirst({
			where: eq(schema.member.role, "owner"),
			with: { organization: true },
		});
		if (owner) {
			const m = await db
				.insert(schema.member)
				.values({
					organizationId: owner.organizationId,
					userId: dbUser.id,
					role: "member",
					createdAt: now,
					isDefault: true,
				})
				.returning();
			member = m[0];
		} else {
			// 首位用户：建默认组织并成为 owner
			await db.transaction(async (tx) => {
				const org = await tx
					.insert(schema.organization)
					.values({
						name: "My Organization",
						ownerId: dbUser.id,
						createdAt: now,
					})
					.returning();
				const m = await tx
					.insert(schema.member)
					.values({
						organizationId: org[0].id,
						userId: dbUser.id,
						role: "owner",
						createdAt: now,
						isDefault: true,
					})
					.returning();
				member = m[0];
			});
		}
	}

	// 建会话（better-auth 兼容：直插 session 表，cookie 由调用方设置）
	const token = crypto.randomBytes(32).toString("hex");
	const sid = nanoid();
	const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 3);
	await db.insert(schema.session).values({
		id: sid,
		token,
		expiresAt,
		createdAt: now,
		updatedAt: now,
		userId: dbUser.id,
		activeOrganizationId: member?.organizationId || null,
	});

	return { token, expiresAt };
}
