import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "node:crypto";
import {
	atrustAuthorizeUrl,
	isATrustConfigured,
} from "@dokploy/server/index";

// aTrust SSO 发起：/api/auth/atrust/start
// 生成 state 写 Cookie（CSRF 防护），302 到 aTrust 换 code。
const STATE_COOKIE = "atrust_sso_state";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
	if (!isATrustConfigured()) {
		res.redirect(302, "/?error=" + encodeURIComponent("管理员未启用零信任单点登录"));
		return;
	}

	const state = crypto.randomBytes(12).toString("hex");
	const proto =
		process.env.ATRUST_CALLBACK_URL?.split("://")[0] ||
		(req.headers["x-forwarded-proto"] as string) ||
		"http";
	const host =
		process.env.ATRUST_CALLBACK_URL?.split("://")[1] ||
		(req.headers["x-forwarded-host"] as string) ||
		req.headers.host ||
		"localhost:3000";
	const redirectUri =
		process.env.ATRUST_CALLBACK_URL ||
		`${proto}://${host}/api/auth/atrust/callback`;

	res.setHeader("Set-Cookie", [
		`${STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=300`,
	]);
	res.redirect(302, atrustAuthorizeUrl(redirectUri, state));
}
