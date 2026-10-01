import {productionWebConfig} from '@dokploy/server/lib/production-mode';
import type { NextApiRequest, NextApiResponse } from "next";
import {
	ATRUST_SESSION_COOKIE,
	atrustGetUserByCode,
	atrustSignedSessionCookie,
	atrustLogin,
	isATrustConfigured,
} from "@dokploy/server/index";

// aTrust SSO 回调：/api/auth/atrust/callback?aTrust 302 回来带 code&state
// 校验 state → 换用户信息 → 找/建用户+会话 → 落控制台。
// 失败一律 302 回登录页带 atrust_error（与 tokenhub 同款语义）。
const STATE_COOKIE = "atrust_sso_state";

const fail = (res: NextApiResponse, msg: string) => {
 res.setHeader("Set-Cookie",`atrust_sso_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${productionWebConfig().cookieSuffix}`);
	res.redirect(302, "/?error=" + encodeURIComponent(msg));
};

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	if (!isATrustConfigured()) {
		fail(res, "管理员未启用零信任单点登录");
		return;
	}
	const state = typeof req.query.state==="string"?req.query.state:"";
	const cookieState =
		req.headers.cookie
			?.split(";")
			.map((s) => s.trim())
			.find((s) => s.startsWith(`${STATE_COOKIE}=`))
			?.split("=")[1] || "";
	if (!state || !cookieState || state !== cookieState) {
		fail(res, "登录状态校验失败，请重试");
		return;
	}
	const code = typeof req.query.code==="string"?req.query.code:"";
	if (!code) {
		fail(res, "未获取到授权码");
		return;
	}

	try {
		const info = await atrustGetUserByCode(code);
		if (!info.name) {
			fail(res, "aTrust 返回的用户工号为空");
			return;
		}
		const { token, expiresAt } = await atrustLogin(info);
		const maxAge = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
		res.setHeader("Set-Cookie", [
			`${ATRUST_SESSION_COOKIE}=${encodeURIComponent(atrustSignedSessionCookie(token))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${productionWebConfig().cookieSuffix}`,
			`${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${productionWebConfig().cookieSuffix}`,
		]);
		res.redirect(302, "/dashboard/home");
	} catch (e) {
		fail(res, e instanceof Error ? e.message : "零信任登录失败");
	}
}
