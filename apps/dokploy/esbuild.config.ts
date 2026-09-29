import esbuild from "esbuild";

const define = { "process.env.NODE_ENV": JSON.stringify("production") };

try {
	esbuild
		.build({
			entryPoints: {
				server: "server/server.ts",
				migration: "migration.ts",
				"wait-for-postgres": "wait-for-postgres.ts",
				"reset-password": "reset-password.ts",
				"reset-2fa": "reset-2fa.ts",
				"migrate-auth-secret": "scripts/migrate-auth-secret.ts",
			},
			bundle: true,
			platform: "node",
			format: "esm",
			target: "node18",
			outExtension: { ".js": ".mjs" },
			minify: true,
			sourcemap: true,
			outdir: "dist",
			tsconfig: "tsconfig.server.json",
			define,
			packages: "external",
		})
		.catch(() => {
			return process.exit(1);
		});
} catch (error) {
	console.log(error);
}
