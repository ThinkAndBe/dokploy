import { useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { ZH_DICT } from "./dictionary-zh";

// ChineseLocalizer — AppHub 运行时汉化层（M2）
// 策略：在 _app 挂载后对 DOM 文本与常见属性做词典替换；MutationObserver
// 防抖监听增量渲染。优点：零页面级 diff（fork 维护成本最小）、上游新页面
// 自动覆盖；未命中词条保持英文（优雅降级）。
//
// 防死循环要点：
// 1) 替换只发生在"原文命中词典"时，译文不含英文键，二次遍历零写入；
// 2) observer 回调置脏标记，rAF 批处理，遍历期间断开 observer。

const ATTRS = ["placeholder", "aria-label", "title"];

function translateNode(node: Node) {
	if (node.nodeType === Node.TEXT_NODE) {
		const raw = (node.nodeValue || "").trim();
		if (raw && ZH_DICT[raw]) {
			node.nodeValue = (node.nodeValue || "").replace(raw, ZH_DICT[raw]);
		}
		return;
	}
	if (node.nodeType !== Node.ELEMENT_NODE) return;
	const el = node as HTMLElement;
	if (["SCRIPT", "STYLE", "CODE", "PRE", "TEXTAREA"].includes(el.tagName)) return;
	for (const attr of ATTRS) {
		const v = el.getAttribute(attr);
		if (v && ZH_DICT[v]) el.setAttribute(attr, ZH_DICT[v]);
	}
}

function walk(root: Node) {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
	// 两遍：先文本后元素属性（TreeWalker 组合过滤时元素也会经过，translateNode 自行分流）
	while (walker.nextNode()) translateNode(walker.currentNode);
}

export function ChineseLocalizer() {
	const router = useRouter();
	const observerRef = useRef<MutationObserver | null>(null);
	const dirtyRef = useRef(false);
	const rafRef = useRef<number | null>(null);

	useEffect(() => {
		let active = true;

		const scheduleWalk = () => {
			if (dirtyRef.current) return;
			dirtyRef.current = true;
			rafRef.current = requestAnimationFrame(() => {
				dirtyRef.current = false;
				if (!active) return;
				observerRef.current?.disconnect();
				try {
					walk(document.body);
				} finally {
					attach();
				}
			});
		};

		const attach = () => {
			observerRef.current = new MutationObserver(scheduleWalk);
			observerRef.current.observe(document.body, {
				childList: true,
				subtree: true,
				characterData: true,
			});
		};

		scheduleWalk();

		// 生产构建水合竞态兜底：SSR 英文 HTML 在水合期间可能把过早的翻译
		// 还原（React 检测文本不一致后按客户端渲染修复）。水合稳定后延迟
		// 多轮补翻，覆盖登录后跳转/慢渲染的极端时序。
		const RETRY_DELAYS = [400, 1200, 3000];
		const timers = RETRY_DELAYS.map((d) =>
			setTimeout(() => {
				if (active) scheduleWalk();
			}, d),
		);

		const onRouteChange = () => scheduleWalk();
		router.events.on("routeChangeComplete", onRouteChange);

		return () => {
			active = false;
			router.events.off("routeChangeComplete", onRouteChange);
			if (rafRef.current) cancelAnimationFrame(rafRef.current);
			for (const t of timers) clearTimeout(t);
			observerRef.current?.disconnect();
		};
	}, [router.events]);

	return null;
}
