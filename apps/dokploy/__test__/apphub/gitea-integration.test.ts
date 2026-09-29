import { afterEach, describe, expect, it, vi } from "vitest";
import { repoSlug, giteaToken, isGiteaIntegrationEnabled, provisionGiteaRepo } from "../../../../packages/server/src/services/gitea-integration";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("AppHub repository isolation", () => {
 it("same display names in different projects do not share repositories", () => {
  expect(repoSlug("销售报表", "project-a")).not.toBe(repoSlug("销售报表", "project-b"));
 });
 it("Chinese project names produce a repeatable ASCII repository name", () => {
  expect(repoSlug("销售报表", "project-a")).toMatch(/^project-[a-f0-9]{20}$/);
  expect(repoSlug("销售报表", "project-a")).toBe(repoSlug("销售报表", "project-a"));
 });
 it("requires a stable project identity", () => { expect(() => repoSlug("demo", "")).toThrow(); });
 it("bounds repository name length", () => { expect(repoSlug("a".repeat(200), "id").length).toBeLessThanOrEqual(56); });
 it("accepts a Docker secret file configuration", () => {
  vi.stubEnv("GITEA_API_URL", "http://gitea:3000"); vi.stubEnv("GITEA_TOKEN", ""); vi.stubEnv("GITEA_TOKEN_FILE", "/run/secrets/gitea");
  expect(isGiteaIntegrationEnabled()).toBe(true);
 });
 it("rejects a missing or multiline token", () => {
  vi.stubEnv("GITEA_TOKEN_FILE", ""); vi.stubEnv("GITEA_TOKEN", "bad\nheader"); expect(() => giteaToken()).toThrow();
  vi.stubEnv("GITEA_TOKEN", ""); expect(() => giteaToken()).toThrow();
 });
 it("does not include Gitea response bodies in user-visible errors", async () => {
  vi.stubEnv("GITEA_API_URL", "http://gitea:3000"); vi.stubEnv("GITEA_TOKEN_FILE", ""); vi.stubEnv("GITEA_TOKEN", "test-only");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("{}", {status:200})).mockResolvedValueOnce(new Response("sensitive upstream detail", {status:500})));
  await expect(provisionGiteaRepo({name:"demo",projectId:"one"})).rejects.toThrow("创建仓库失败 HTTP 500");
 });
});
