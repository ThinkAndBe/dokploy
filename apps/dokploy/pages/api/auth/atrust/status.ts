import type { NextApiRequest, NextApiResponse } from "next";
import { isATrustConfigured } from "@dokploy/server/index";

// 登录页探测：零信任登录是否可用（控制按钮显隐）
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
	res.status(200).json({ enabled: isATrustConfigured() });
}
